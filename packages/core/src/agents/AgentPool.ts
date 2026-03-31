/**
 * Agent Pool Manager
 *
 * Manages a pool of agents with Kubernetes-inspired semantics:
 * - Declarative desired state (replicas, capabilities)
 * - Automatic scaling and load balancing
 * - Health monitoring and recovery
 *
 * Worker paradigm improvements:
 * - Event-driven dispatch: agent idle → immediately pull next queued task
 * - Priority queue: critical > high > normal > low
 * - Proper result correlation via correlationId
 * - Per-task retry with exponential backoff
 * - Dead letter queue for exhausted tasks
 * - Graceful drain: waits for in-flight tasks before shutdown
 */

import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { Agent } from './Agent.js';
import { CoderAgent } from './specialized/CoderAgent.js';
import { ReviewerAgent } from './specialized/ReviewerAgent.js';
import type {
  AgentRole,
  AgentPoolSpec,
  AgentPoolCRD,
  TaskAssignment,
  AgentMessage,
  AgentIdentity,
  MessagePriority,
} from './types.js';

// ============================================================================
// Internal types
// ============================================================================

const PRIORITY_ORDER: Record<MessagePriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

interface QueuedTask {
  assignment: TaskAssignment;
  retries: number;
  enqueuedAt: number;
}

export interface DLQEntry {
  assignment: TaskAssignment;
  error: string;
  attempts: number;
  failedAt: number;
}

export interface PoolMetrics {
  totalAgents: number;
  availableAgents: number;
  busyAgents: number;
  queuedTasks: number;
  inFlightTasks: number;
  completedTasks: number;
  failedTasks: number;
  deadLetterCount: number;
  averageTaskTimeMs: number;
}

export interface LoadBalancingStrategy {
  type: 'round-robin' | 'least-busy' | 'capability-match' | 'random';
}

// ============================================================================
// AgentPool
// ============================================================================

export class AgentPool extends EventEmitter {
  private agents: Map<string, Agent> = new Map();
  private taskQueue: QueuedTask[] = [];
  private inFlight: Map<string, { agentId: string; startTime: number }> = new Map();
  private taskHistory: Map<string, { success: boolean; timeMs: number }> = new Map();
  private deadLetterQueue: DLQEntry[] = [];
  private spec: AgentPoolSpec;
  private readonly poolId: string;
  private loadBalancingStrategy: LoadBalancingStrategy = { type: 'capability-match' };
  private isRunning = false;
  private draining = false;

  constructor(spec: AgentPoolSpec) {
    super();
    this.poolId = randomUUID();
    this.spec = spec;
  }

  // ============================================================================
  // Structured Logging
  // ============================================================================

  private log(
    level: 'info' | 'warn' | 'error',
    event: string,
    data: Record<string, unknown> = {}
  ): void {
    const entry = {
      ts: new Date().toISOString(),
      level,
      pool: this.spec.role,
      poolId: this.poolId.slice(0, 8),
      event,
      ...data,
    };
    process.stderr.write(JSON.stringify(entry) + '\n');
  }

  // ============================================================================
  // Lifecycle Management
  // ============================================================================

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    for (let i = 0; i < this.spec.replicas; i++) {
      await this.spawnAgent();
    }

    this.log('info', 'pool.started', { replicas: this.spec.replicas });
    this.emit('started', { poolId: this.poolId, replicas: this.spec.replicas });
  }

  /**
   * Drain in-flight tasks then shut down all agents.
   * @param timeoutMs Max time to wait for in-flight tasks (default 30s).
   */
  async stop(timeoutMs = 30_000): Promise<void> {
    this.draining = true;

    this.log('info', 'pool.draining', { inFlight: this.inFlight.size, queued: this.taskQueue.length });

    // Wait for all in-flight tasks to finish, up to timeoutMs
    const deadline = Date.now() + timeoutMs;
    while (this.inFlight.size > 0 && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }

    if (this.inFlight.size > 0) {
      this.log('warn', 'pool.drain_timeout', { remaining: this.inFlight.size });
    }

    this.isRunning = false;
    this.draining = false;

    const terminationPromises = Array.from(this.agents.values()).map((agent) =>
      agent.stop()
    );
    await Promise.all(terminationPromises);

    this.agents.clear();
    this.log('info', 'pool.stopped');
    this.emit('stopped', { poolId: this.poolId });
  }

  // ============================================================================
  // Agent Management
  // ============================================================================

  private async spawnAgent(): Promise<Agent> {
    const agent = this.createAgentForRole(this.spec.role);
    await agent.start();

    this.agents.set(agent.id, agent);

    agent.on('stateChange', (event: { agentId: string; from: string; to: string }) => {
      this.emit('agentStateChange', { poolId: this.poolId, ...event });
      this.checkAutoscaling();

      // Event-driven dispatch: agent became idle → pull next task immediately
      if (event.to === 'idle') {
        this.dispatchNext();
      }
    });

    agent.on('messageSent', (message: AgentMessage) => {
      this.routeMessage(message);
    });

    this.log('info', 'agent.spawned', { agentId: agent.id.slice(0, 8), role: this.spec.role });
    this.emit('agentSpawned', { poolId: this.poolId, agentId: agent.id });
    return agent;
  }

  private createAgentForRole(role: AgentRole): Agent {
    const baseName = `${role}-${this.agents.size + 1}`;

    switch (role) {
      case 'coder':
        return new CoderAgent({
          name: baseName,
          languages: this.spec.capabilities.languages,
          frameworks: this.spec.capabilities.frameworks,
        });
      case 'reviewer':
        return new ReviewerAgent({
          name: baseName,
          strictness: 'normal',
        });
      default:
        return new CoderAgent({ name: baseName });
    }
  }

  async terminateAgent(agentId: string): Promise<boolean> {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    await agent.stop();
    this.agents.delete(agentId);

    this.emit('agentTerminated', { poolId: this.poolId, agentId });
    return true;
  }

  // ============================================================================
  // Task Submission & Dispatch
  // ============================================================================

  async submitTask(assignment: TaskAssignment): Promise<string> {
    if (this.draining) {
      throw new Error('Pool is draining — not accepting new tasks');
    }

    this.enqueue({ assignment, retries: 0, enqueuedAt: Date.now() });
    this.log('info', 'task.queued', {
      taskId: assignment.taskId,
      priority: assignment.priority ?? 'normal',
      queueDepth: this.taskQueue.length,
    });
    this.emit('taskQueued', { poolId: this.poolId, taskId: assignment.taskId });

    // Try to dispatch immediately
    this.dispatchNext();

    return assignment.taskId;
  }

  /**
   * Core dispatch: pick the highest-priority queued task and assign it to an
   * available agent. Called on every submit and every time an agent goes idle.
   */
  private dispatchNext(): void {
    if (!this.isRunning || this.taskQueue.length === 0) return;

    const task = this.dequeue();
    if (!task) return;

    const agent = this.selectAgent(task.assignment);
    if (!agent) {
      // No agent available right now — put back and wait for next idle event
      this.taskQueue.unshift(task);
      return;
    }

    this.inFlight.set(task.assignment.taskId, {
      agentId: agent.id,
      startTime: Date.now(),
    });

    this.log('info', 'task.dispatched', {
      taskId: task.assignment.taskId,
      agentId: agent.id.slice(0, 8),
      priority: task.assignment.priority ?? 'normal',
      attempt: task.retries + 1,
    });

    this.assignTaskToAgent(agent, task).catch((err) => {
      this.inFlight.delete(task.assignment.taskId);
      this.log('error', 'task.dispatch_error', { taskId: task.assignment.taskId, error: String(err) });
      this.emit('dispatchError', { poolId: this.poolId, taskId: task.assignment.taskId, error: err });
    });
  }

  private enqueue(task: QueuedTask): void {
    this.taskQueue.push(task);
    this.sortQueue();
  }

  private dequeue(): QueuedTask | undefined {
    return this.taskQueue.shift();
  }

  /** Sort by priority (critical first), then FIFO within the same priority. */
  private sortQueue(): void {
    this.taskQueue.sort((a, b) => {
      const pa = PRIORITY_ORDER[a.assignment.priority ?? 'normal'];
      const pb = PRIORITY_ORDER[b.assignment.priority ?? 'normal'];
      if (pa !== pb) return pa - pb;
      return a.enqueuedAt - b.enqueuedAt;
    });
  }

  private selectAgent(task: TaskAssignment): Agent | null {
    const availableAgents = Array.from(this.agents.values()).filter(
      (agent) => agent.isAvailable() && agent.canHandle(task)
    );

    if (availableAgents.length === 0) return null;

    switch (this.loadBalancingStrategy.type) {
      case 'round-robin':
        return availableAgents[0] ?? null;

      case 'random':
        return availableAgents[Math.floor(Math.random() * availableAgents.length)] ?? null;

      case 'capability-match': {
        const exactMatch = availableAgents.find((agent) => {
          const caps = agent.getIdentity().capabilities;
          const required = task.requiredCapabilities;
          if (!required) return true;
          return required.languages?.every((l) => caps.languages?.includes(l)) ?? true;
        });
        return exactMatch ?? availableAgents[0] ?? null;
      }

      case 'least-busy':
      default:
        return availableAgents[0] ?? null;
    }
  }

  private async assignTaskToAgent(agent: Agent, queued: QueuedTask): Promise<void> {
    const { assignment, retries } = queued;
    const messageId = randomUUID();
    const startTime = Date.now();

    // Listen for the result that correlates with this specific message
    const handler = (resultMessage: AgentMessage) => {
      if (resultMessage.correlationId !== messageId) return;
      agent.off('messageSent', handler);

      const timeMs = Date.now() - startTime;
      this.inFlight.delete(assignment.taskId);

      const result = resultMessage.payload as { success: boolean; error?: string };

      if (!result.success) {
        const maxRetries = assignment.retryPolicy?.maxRetries ?? 0;
        if (retries < maxRetries) {
          const backoff = (assignment.retryPolicy?.backoffMs ?? 1000) * (retries + 1);
          this.log('warn', 'task.retrying', {
            taskId: assignment.taskId,
            attempt: retries + 1,
            maxRetries,
            backoffMs: backoff,
            error: result.error,
          });
          this.emit('taskRetrying', {
            poolId: this.poolId,
            taskId: assignment.taskId,
            attempt: retries + 1,
            backoffMs: backoff,
          });
          setTimeout(() => {
            this.enqueue({ assignment, retries: retries + 1, enqueuedAt: Date.now() });
            this.dispatchNext();
          }, backoff);
        } else {
          this.log('error', 'task.dead_letter', {
            taskId: assignment.taskId,
            attempts: retries + 1,
            error: result.error,
          });
          this.deadLetterQueue.push({
            assignment,
            error: result.error ?? 'Unknown error',
            attempts: retries + 1,
            failedAt: Date.now(),
          });
          this.taskHistory.set(assignment.taskId, { success: false, timeMs });
          this.emit('taskFailed', {
            poolId: this.poolId,
            taskId: assignment.taskId,
            error: result.error,
            attempts: retries + 1,
          });
        }
      } else {
        this.log('info', 'task.completed', { taskId: assignment.taskId, timeMs });
        this.taskHistory.set(assignment.taskId, { success: true, timeMs });
        this.emit('taskCompleted', {
          poolId: this.poolId,
          taskId: assignment.taskId,
          success: true,
          timeMs,
        });
      }
    };

    agent.on('messageSent', handler);

    const message: AgentMessage = {
      id: messageId,
      type: 'task_assignment',
      priority: assignment.priority ?? 'normal',
      senderId: this.poolId,
      recipientId: agent.id,
      timestamp: new Date().toISOString(),
      payload: assignment as unknown as Record<string, unknown>,
    };

    await agent.receiveMessage(message);
  }

  // ============================================================================
  // Message Routing
  // ============================================================================

  private routeMessage(message: AgentMessage): void {
    const recipient = this.agents.get(message.recipientId);
    if (recipient) {
      recipient.receiveMessage(message).catch((err) => {
        this.emit('routingError', { message, error: err });
      });
      return;
    }

    this.emit('externalMessage', message);
  }

  // ============================================================================
  // Autoscaling (ARK pattern)
  // ============================================================================

  private checkAutoscaling(): void {
    if (!this.spec.autoscaling?.enabled) return;

    const metrics = this.getMetrics();
    const utilization = metrics.busyAgents / Math.max(metrics.totalAgents, 1) * 100;

    if (
      utilization > this.spec.autoscaling.targetUtilization &&
      metrics.totalAgents < this.spec.autoscaling.maxReplicas
    ) {
      this.spawnAgent().then(() => {
        this.emit('scaledUp', { poolId: this.poolId, newSize: this.agents.size });
      });
    } else if (
      utilization < this.spec.autoscaling.targetUtilization / 2 &&
      metrics.totalAgents > this.spec.autoscaling.minReplicas
    ) {
      const idleAgent = Array.from(this.agents.values()).find((a) => a.isAvailable());
      if (idleAgent) {
        this.terminateAgent(idleAgent.id).then(() => {
          this.emit('scaledDown', { poolId: this.poolId, newSize: this.agents.size });
        });
      }
    }
  }

  // ============================================================================
  // Metrics & Status
  // ============================================================================

  getMetrics(): PoolMetrics {
    const agents = Array.from(this.agents.values());
    const history = Array.from(this.taskHistory.values());

    const successfulTasks = history.filter((t) => t.success);
    const avgTime =
      successfulTasks.length > 0
        ? successfulTasks.reduce((sum, t) => sum + t.timeMs, 0) / successfulTasks.length
        : 0;

    return {
      totalAgents: agents.length,
      availableAgents: agents.filter((a) => a.isAvailable()).length,
      busyAgents: agents.filter((a) => a.state === 'busy').length,
      queuedTasks: this.taskQueue.length,
      inFlightTasks: this.inFlight.size,
      completedTasks: successfulTasks.length,
      failedTasks: history.filter((t) => !t.success).length,
      deadLetterCount: this.deadLetterQueue.length,
      averageTaskTimeMs: avgTime,
    };
  }

  getAgents(): AgentIdentity[] {
    return Array.from(this.agents.values()).map((a) => a.getIdentity());
  }

  getDeadLetterQueue(): DLQEntry[] {
    return [...this.deadLetterQueue];
  }

  getSpec(): AgentPoolSpec {
    return { ...this.spec };
  }

  // ============================================================================
  // Kubernetes CRD Generation
  // ============================================================================

  toCRD(name: string, namespace = 'default'): AgentPoolCRD {
    const metrics = this.getMetrics();

    return {
      apiVersion: 'batiste.io/v1',
      kind: 'AgentPool',
      metadata: {
        name,
        namespace,
        labels: {
          'app.kubernetes.io/name': 'batiste',
          'app.kubernetes.io/component': 'agent-pool',
          'batiste.io/role': this.spec.role,
        },
      },
      spec: this.spec,
      status: {
        readyReplicas: metrics.availableAgents,
        availableReplicas: metrics.totalAgents,
        conditions: [
          {
            type: 'Ready',
            status: metrics.availableAgents > 0 ? 'True' : 'False',
            reason: metrics.availableAgents > 0 ? 'AgentsAvailable' : 'NoAgentsAvailable',
            lastTransitionTime: new Date().toISOString(),
          },
        ],
      },
    };
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  setLoadBalancingStrategy(strategy: LoadBalancingStrategy): void {
    this.loadBalancingStrategy = strategy;
  }

  async updateSpec(newSpec: Partial<AgentPoolSpec>): Promise<void> {
    const oldReplicas = this.spec.replicas;
    this.spec = { ...this.spec, ...newSpec };

    if (newSpec.replicas !== undefined && newSpec.replicas !== oldReplicas) {
      const diff = newSpec.replicas - oldReplicas;
      if (diff > 0) {
        for (let i = 0; i < diff; i++) {
          await this.spawnAgent();
        }
      } else {
        const toRemove = Math.abs(diff);
        const idleAgents = Array.from(this.agents.values())
          .filter((a) => a.isAvailable())
          .slice(0, toRemove);
        for (const agent of idleAgents) {
          await this.terminateAgent(agent.id);
        }
      }
    }

    this.emit('specUpdated', { poolId: this.poolId, spec: this.spec });
  }
}
