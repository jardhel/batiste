/**
 * Session Monitor
 *
 * Tracks active sessions and resource usage in real-time.
 */

export interface MonitoredSession {
  id: string;
  agentId: string;
  startedAt: string;
  toolCalls: number;
  errors: number;
  totalDurationMs: number;
}

export class SessionMonitor {
  private readonly sessions = new Map<string, MonitoredSession>();

  /** Start monitoring a session. */
  start(sessionId: string, agentId: string): void {
    this.sessions.set(sessionId, {
      id: sessionId,
      agentId,
      startedAt: new Date().toISOString(),
      toolCalls: 0,
      errors: 0,
      totalDurationMs: 0,
    });
  }

  /** Record a tool call on a session. */
  recordCall(sessionId: string, durationMs: number, isError: boolean): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.toolCalls++;
    session.totalDurationMs += durationMs;
    if (isError) session.errors++;
  }

  /** Stop monitoring a session. */
  stop(sessionId: string): MonitoredSession | undefined {
    const session = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    return session;
  }

  /** Get a session's stats. */
  get(sessionId: string): MonitoredSession | undefined {
    return this.sessions.get(sessionId);
  }

  /** List all monitored sessions. */
  list(): MonitoredSession[] {
    return Array.from(this.sessions.values());
  }

  /** Get count of active sessions. */
  get size(): number {
    return this.sessions.size;
  }
}
