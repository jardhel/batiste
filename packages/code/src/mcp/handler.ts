/**
 * MCP Tool Handler for @batiste-aidk/code
 *
 * Implements the logic for each MCP tool.
 * Uses @batiste-aidk/core for tasks, context, sandbox, and agents.
 */

import { join, isAbsolute } from 'path';
import { mkdir } from 'fs/promises';
import type { z } from 'zod';
import {
  type ToolName,
  AnalyzeDependencyInput,
  ValidateCodeInput,
  ExecuteSandboxInput,
  ManageTaskInput,
  RunTDDInput,
  FindSymbolInput,
  IndexCodebaseInput,
  SummarizeCodebaseInput,
  ContextBudgetInput,
  AutoFixInput,
  OrchestrateAgentsInput,
  VaultValidateInput,
  VaultIndexInput,
} from './tools.js';
import { loadVault, validateVault, AXES, type Axis } from '@batiste-aidk/gvs';
import {
  SQLiteTaskStore,
  TaskManager,
  TaskReconciler,
  SQLiteReconcileMarkerStore,
  type Task,
  type TaskNode,
  type ReconcileAuditSink,
} from '@batiste-aidk/core/tasks';
import { EventLog } from '@batiste-aidk/audit';
import { ContextBudgetMonitor, type BudgetCategory, type BudgetConfig } from '@batiste-aidk/core/context';
import { ProcessSandbox } from '@batiste-aidk/core/sandbox';
import { Orchestrator } from '@batiste-aidk/core/agents';
import { RecursiveScout } from '../analysis/RecursiveScout.js';
import { TreeSitterAdapter } from '../parsers/TreeSitterAdapter.js';
import { Gatekeeper } from '../validation/Gatekeeper.js';
import { HypothesisEngine } from '../tdd/HypothesisEngine.js';
import { SymbolResolver } from '../lsp/symbol-resolver.js';
import { GitAwareIndexer } from '../indexer/git-aware-indexer.js';
import { FileIndex } from '../indexer/file-index.js';
import { loadConfig } from '../utils/config.js';
import { AutoFixer } from '../autofix/AutoFixer.js';
import { GraphQuerier } from './graph-querier.js';
import type { Graph } from '@batiste-aidk/graph';
import {
  TASK_ACTIONS, TaskInputError, normalizeTaskArgs, checkTransition, triage, burnReport,
  filterTasks, compactTask, labelPrefix, isOpen, isObsolete, metaOf, RENEW_WARN_COUNT, similarOpen, relatedSuggestions, type TaskAction,
} from './task-actions.js';
import { must } from './safe.js';
import { planMerge } from './task-merge.js';
import { THRESHOLD_SAME, THRESHOLD_RELATED, mergeCommand, phaseRank } from './task-similarity.js';

/**
 * Per-tool input schemas, enforced at `handleTool` dispatch time.
 *
 * Every MCP tool call traverses this map before reaching the handler
 * body: if the args fail validation, the call is rejected with a
 * structured error and never touches the underlying analyser. This is
 * the "Validate" step that complements the zero-trust chain
 * (Scope → Auth → Audit) at the protocol boundary — see E3-B05 and
 * `compliance/policies/ai-governance-policy.md` §4 ("input validation
 * is a first-class control").
 *
 * Design:
 *   - Schemas are imported from `./tools.ts` so the MCP advertised
 *     schema and the runtime validator are the **same source**.
 *   - Errors are wrapped in `ValidationError` with a stable error code
 *     so callers (and the audit layer) can distinguish an input-shape
 *     failure from a handler failure.
 *   - Validation happens **before** any side effect (no partial mutation).
 */
export class ValidationError extends Error {
  public readonly code = 'INPUT_VALIDATION_FAILED';
  constructor(public readonly tool: string, public readonly issues: z.ZodIssue[]) {
    super(`Input validation failed for tool '${tool}': ${issues.map(i => `${i.path.join('.') || '(root)'} ${i.message}`).join('; ')}`);
    this.name = 'ValidationError';
  }
}

const INPUT_SCHEMAS: Record<ToolName, z.ZodTypeAny> = {
  analyze_dependency: AnalyzeDependencyInput,
  validate_code: ValidateCodeInput,
  execute_sandbox: ExecuteSandboxInput,
  manage_task: ManageTaskInput,
  run_tdd: RunTDDInput,
  find_symbol: FindSymbolInput,
  index_codebase: IndexCodebaseInput,
  summarize_codebase: SummarizeCodebaseInput,
  context_budget: ContextBudgetInput,
  auto_fix: AutoFixInput,
  orchestrate_agents: OrchestrateAgentsInput,
  vault_validate: VaultValidateInput,
  vault_index: VaultIndexInput,
};

function validateInput(name: ToolName, args: unknown): Record<string, unknown> {
  if (!Object.hasOwn(INPUT_SCHEMAS, name)) throw new Error(`Unknown tool: ${name}`);
  const schema = INPUT_SCHEMAS[name];
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    throw new ValidationError(name, parsed.error.issues);
  }
  // Zod returns the narrowed type; we hand back Record<string, unknown>
  // because downstream handlers still take the un-typed bag. The type
  // system here is a boundary, not a rewrite.
  return parsed.data as Record<string, unknown>;
}

const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  totalBudget: 150000,
  categoryBudgets: {
    code: 80000,
    summary: 30000,
    messages: 40000,
  },
  warningThreshold: 0.8,
};

export class ToolHandler {
  private projectRoot: string;
  private dataDir: string;
  private taskManager: TaskManager | null = null;
  private store: SQLiteTaskStore | null = null;
  private reconcileMarkerStore: SQLiteReconcileMarkerStore | null = null;
  private auditEventLog: EventLog | null = null;
  private symbolResolver: SymbolResolver | null = null;
  private contextBudget: ContextBudgetMonitor | null = null;
  private orchestrator: Orchestrator | null = null;
  /**
   * Phase 3 — optional graph-backed querier. When set, `find_symbol`
   * and `summarize_codebase` prefer the graph path (cluster-aware,
   * deterministic) over the tree-sitter scan. When null, every tool
   * keeps its pre-Phase-3 behaviour.
   */
  private graphQuerier: GraphQuerier | null = null;

  constructor(projectRoot: string, dataDir: string) {
    this.projectRoot = projectRoot;
    this.dataDir = dataDir;
  }

  /**
   * Phase 3 — attach a built {@link Graph} so MCP tools can use it
   * opportunistically. Call this after `Indexer.index()` resolves.
   * Passing `null` reverts to tree-sitter / LSP behaviour.
   */
  setGraph(graph: Graph | null): void {
    this.graphQuerier = graph ? new GraphQuerier(graph) : null;
  }

  /** Test/inspection hook — exposes the active GraphQuerier (if any). */
  getGraphQuerier(): GraphQuerier | null {
    return this.graphQuerier;
  }

  async handleTool(name: ToolName, args: Record<string, unknown>): Promise<unknown> {
    // E3-B05: validate every tool invocation at the MCP dispatch
    // boundary. If the input shape is wrong we fail **before** any
    // side effect, so the audit ledger sees a single tamper-evident
    // INPUT_VALIDATION_FAILED entry instead of a half-applied handler.
    let warnings: string[] = [];
    if (name === 'manage_task') {
      const n = normalizeTaskArgs(args);
      args = n.args;
      warnings = n.warnings;
    }
    const validated = validateInput(name, args);
    if (name === 'manage_task' && warnings.length) validated.__warnings = warnings;
    switch (name) {
      case 'analyze_dependency': return this.analyzeDependency(validated);
      case 'validate_code': return this.validateCode(validated);
      case 'execute_sandbox': return this.executeSandbox(validated);
      case 'manage_task': return this.manageTask(validated);
      case 'run_tdd': return this.runTDD(validated);
      case 'find_symbol': return this.findSymbol(validated);
      case 'index_codebase': return this.indexCodebase(validated);
      case 'summarize_codebase': return this.summarizeCodebase(validated);
      case 'context_budget': return this.contextBudgetAction(validated);
      case 'auto_fix': return this.autoFix(validated);
      case 'orchestrate_agents': return this.orchestrateAgents(validated);
      case 'vault_validate': return this.vaultValidate(validated);
      case 'vault_index': return this.vaultIndex(validated);
      default: throw new Error(`Unknown tool: ${String(name)}`);
    }
  }

  private async analyzeDependency(args: Record<string, unknown>): Promise<unknown> {
    if (!Array.isArray(args.entryPoints) || args.entryPoints.length === 0) {
      throw new Error('analyze_dependency requires entryPoints: a non-empty array of file paths');
    }
    const entryPoints = (args.entryPoints as string[]).map(p =>
      p.startsWith('/') ? p : join(this.projectRoot, p)
    );
    const maxDepth = args.maxDepth as number | undefined;
    const includeNodeModules = args.includeNodeModules as boolean | undefined;

    const adapter = new TreeSitterAdapter();
    const scout = new RecursiveScout(adapter, { maxDepth, includeNodeModules });
    const graph = await scout.buildDependencyGraph(entryPoints);
    const stats = scout.getGraphStats(graph);

    const nodes: Record<string, unknown> = {};
    for (const [path, node] of graph.nodes) {
      nodes[path] = {
        imports: node.imports,
        dependencies: node.dependencies,
        dependents: node.dependents,
        symbolCount: node.symbols.length,
        symbols: node.symbols.slice(0, 20).map(s => ({
          name: s.name,
          type: s.type,
          line: s.startLine,
        })),
      };
    }

    return { stats, roots: graph.roots, leaves: graph.leaves, circularDeps: graph.circularDeps, nodes };
  }

  private async validateCode(args: Record<string, unknown>): Promise<unknown> {
    const paths = (args.paths as string[]).map(p =>
      p.startsWith('/') ? p : join(this.projectRoot, p)
    );
    const fix = args.fix as boolean | undefined;
    const maxIssues = (args.maxIssues as number | undefined) ?? 10;

    const gatekeeper = new Gatekeeper();
    const result = await gatekeeper.preflightCheck(paths, { fix });

    const validatorResults: Record<string, unknown> = {};
    for (const [id, vResult] of result.validatorResults) {
      const totalErrors = vResult.errors.length;
      const totalWarnings = vResult.warnings.length;

      validatorResults[id] = {
        passed: vResult.passed,
        durationMs: vResult.durationMs,
        errorCount: totalErrors,
        warningCount: totalWarnings,
        errors: vResult.errors.slice(0, maxIssues).map(e => ({
          file: e.file.replace(this.projectRoot + '/', ''),
          line: e.line,
          message: e.message,
          rule: e.rule,
        })),
        warnings: vResult.warnings.slice(0, maxIssues).map(w => ({
          file: w.file.replace(this.projectRoot + '/', ''),
          line: w.line,
          message: w.message,
          rule: w.rule,
        })),
        truncated: totalErrors > maxIssues || totalWarnings > maxIssues,
      };
    }

    return {
      passed: result.passed,
      totalErrors: result.totalErrors,
      totalWarnings: result.totalWarnings,
      durationMs: result.durationMs,
      validators: validatorResults,
      hint: result.totalErrors > 0
        ? `Use maxIssues parameter to see more (showing ${String(maxIssues)} per validator)`
        : undefined,
    };
  }

  private async executeSandbox(args: Record<string, unknown>): Promise<unknown> {
    const command = args.command as string;
    const cmdArgs = args.args as string[] | undefined;
    const timeout = args.timeout as number | undefined;
    const workingDir = args.workingDir as string | undefined;

    const sandbox = new ProcessSandbox();
    await sandbox.initialize();

    try {
      const result = await sandbox.execute({
        command,
        args: cmdArgs,
        timeout,
        workingDir: workingDir ? join(this.projectRoot, workingDir) : this.projectRoot,
      });

      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
      };
    } finally {
      await sandbox.destroy();
    }
  }

  /** Best-effort audit trail: a failure to write the event must never block the task mutation. */
  private emitTaskEvent(event: string, payload: Record<string, unknown>): void {
    try {
      this.auditEventLog ??= new EventLog(join(this.dataDir, 'audit.db'));
      this.auditEventLog.append({
        ts: new Date().toISOString(),
        event,
        generator: 'batiste manage_task',
        payload: { actor: process.env.BATISTE_ACTOR ?? process.env.USER ?? 'unknown', ...payload },
      });
    } catch {
      /* fail-soft */
    }
  }

  private async manageTask(rawArgs: Record<string, unknown>): Promise<unknown> {
    const args = rawArgs;
    const action = args.action as TaskAction;
    const warnings = (args.__warnings as string[] | undefined) ?? [];
    const manager = await this.getTaskManager();
    const nowSec = Math.floor(Date.now() / 1000);
    const nowIso = new Date().toISOString();
    const withWarnings = <T extends object>(r: T): T | (T & { warnings: string[] }) =>
      warnings.length ? { ...r, warnings } : r;
    const need = async (taskId: string): Promise<Task> => {
      const t = await manager.getTask(taskId);
      if (!t) {
        throw new TaskInputError(
          `tarefa nao encontrada: ${taskId}. Liste com {"action":"list","compact":true,"labelPrefix":"..."} e use o campo id.`
        );
      }
      return t;
    };
    /** state/links/phase/tags/note -> metadata patch (note is append-only). */
    const structured = (task: Task | null): Record<string, unknown> => {
      const meta: Record<string, unknown> = {};
      const old = task ? metaOf(task) : {};
      if (args.state) meta.state = { ...((old.state) ?? {}), ...(args.state) };
      if (args.links) meta.links = { ...((old.links) ?? {}), ...(args.links) };
      if (args.phase) meta.phase = args.phase;
      // progressAt: so avanco real (fase, estado next/gate, status). nota/touch NAO conta; o gate mede idade por aqui.
      if ((args.phase && args.phase !== old.phase) || (args.state && JSON.stringify(meta.state) !== JSON.stringify(old.state ?? {}))) meta.progressAt = nowSec;
      if (args.tags) meta.tags = args.tags;
      if (typeof args.note === 'string') {
        meta.notes = [...(((old.notes as unknown[] | undefined) ?? [])), { at: nowIso, text: args.note }];
      }
      return meta;
    };

    switch (action) {
      case 'create': {
        const label = args.label as string;
        const parentId = args.parentId as string | undefined;
        const dedupeKey = args.dedupeKey as string | undefined;
        const all = await manager.recoverState();
        const normLabel = (x: string) => x.trim().toLowerCase();
        const existing = dedupeKey
          ? all.find((t) => isOpen(t) && metaOf(t).dedupeKey === dedupeKey)
          : args.allowDuplicate === true
            ? undefined
            : all.find((t) => isOpen(t) && normLabel(t.label) === normLabel(label));
        if (existing) {
          const porChave = !!dedupeKey;
          const reason = porChave
            ? `ja existe tarefa aberta com dedupeKey '${dedupeKey}' (taskId ${existing.id}); nada criado, devolvi a existente. Atualize-a com {"action":"update","taskId":"${existing.id}",...}.`
            : `ja existe tarefa aberta com o mesmo label (taskId ${existing.id}); nada criado, devolvi a existente. Atualize-a, ou passe "allowDuplicate":true se duplicar for intencional.`;
          return withWarnings({ created: false, duplicate: true, deduped: true, taskId: existing.id, reason, task: existing });
        }
        // correlatas (nao so label identico): similaridade contra as ABERTAS. dedupeKey explicita = identidade escolhida
        // pelo chamador, entao so sugere (nunca mescla sozinha); allowDuplicate pula tudo.
        let related: { taskId: string; label: string; score: number }[] = [];
        let similarHits: ReturnType<typeof similarOpen>;
        if (args.allowDuplicate !== true) {
          const ancestors = new Set<string>();
          for (let cur = parentId; cur && !ancestors.has(cur); ) {
            ancestors.add(cur);
            cur = all.find((t) => t.id === cur)?.parentId;
          }
          const probe = {
            id: '__novo__', label, status: 'pending',
            context: { metadata: { ...(args.state ? { state: args.state } : {}), ...(args.links ? { links: args.links } : {}), ...(args.tags ? { tags: args.tags } : {}), ...(typeof args.note === 'string' ? { notes: [{ text: args.note }] } : {}) } },
          };
          similarHits = similarOpen(probe, all.filter(isOpen), { excludeIds: ancestors });
          const top = similarHits[0];
          if (top && top.score >= THRESHOLD_SAME && !dedupeKey) {
            const host = must(all.find((t) => t.id === top.taskId), `tarefa ${top.taskId} ausente do estado`);
            const hm = metaOf(host);
            const text = `[create correlato ${nowIso}, score ${String(top.score)}] ${label}${typeof args.note === 'string' && args.note ? ` — ${args.note}` : ''}`;
            const patch: Record<string, unknown> = { notes: [...((hm.notes as unknown[] | undefined) ?? []), { at: nowIso, text, via: 'create' }] };
            if (args.links) patch.links = { ...(args.links), ...((hm.links) ?? {}) };
            if (args.tags) patch.tags = [...new Set([...((hm.tags as string[] | undefined) ?? []), ...(args.tags as string[])])];
            const updated = await manager.patchTask(host.id, { metadata: patch });
            this.emitTaskEvent('task.deduped', { task_id: host.id, label, score: top.score, via: 'similarity' });
            return withWarnings({
              created: false, duplicate: true, merged: true, deduped: true, taskId: host.id, score: top.score,
              reason: `tarefa correlata ja aberta (score ${String(top.score)} >= ${String(THRESHOLD_SAME)}; taskId ${host.id}); nada criado, a descricao nova foi anexada como note na existente. Passe "allowDuplicate":true se forem mesmo tarefas distintas.`,
              task: updated,
            });
          }
          related = similarHits.map((h) => ({ taskId: h.taskId, label: h.label, score: h.score }));
        }
        const task = parentId
          ? await manager.spawnSubtask(parentId, label)
          : await manager.createRootGoal(label);
        const meta = { ...structured(null), ...(dedupeKey ? { dedupeKey } : {}) };
        const saved = Object.keys(meta).length ? await manager.patchTask(task.id, { metadata: meta }) : task;
        const prefix = labelPrefix(label);
        const siblings = all.filter((t) => isOpen(t) && labelPrefix(t.label) === prefix).length;
        const extra = [...warnings];
        if (siblings >= 5) {
          extra.push(`ja existem ${String(siblings)} tarefas abertas com prefixo '${prefix}': considere uma tarefa-pai com filhas (parentId) ou dedupeKey`);
        }
        this.emitTaskEvent('task.created', { task_id: saved.id, label });
        const relatedOut = related.slice(0, 5).map((r) => {
          const other = must(all.find((t) => t.id === r.taskId), `tarefa ${r.taskId} ausente do estado`);
          // a existente e sempre mais antiga que a recem-criada (createdAt tem resolucao de 1 s): so perde se a nova ja nasce em fase maior
          const target = phaseRank(saved) > phaseRank(other) ? saved : other;
          const source = target.id === saved.id ? other.id : saved.id;
          return { ...r, merge: mergeCommand(source, target.id) };
        });
        return {
          created: true, task: saved,
          ...(relatedOut.length ? { related: relatedOut, relatedHint: `tarefas correlatas (score ${String(THRESHOLD_RELATED)}-${(THRESHOLD_SAME - 0.01).toFixed(2)}): se for a mesma entrega, mescle com o comando em related[].merge` } : {}),
          ...(extra.length ? { warnings: extra } : {}),
        };
      }
      case 'update': {
        const taskId = args.taskId as string;
        const before = await need(taskId);
        const status = args.status as Task['status'] | undefined;
        const toolOutput = args.toolOutput as { toolName: string; output: unknown } | undefined;
        const meta = structured(before);
        if (status && status !== before.status) {
          meta.progressAt = nowSec;
          checkTransition(before, status, { reopen: args.reopen as boolean | undefined, reason: args.reason as string | undefined });
          if (status === 'completed') {
            const proof = (args.proof as string | undefined) ?? (args.reason as string | undefined);
            if (!proof) {
              throw new TaskInputError(
                `completed exige proof ou reason (ou use a acao close). Exemplo: {"action":"close","taskId":"${taskId}","proof":"commit abc1234"}`
              );
            }
            meta.closed = { proof, at: nowSec };
          }
          if (before.status === 'completed' || (before.status === 'failed' && isObsolete(before))) {
            meta.reopened = { reason: args.reason, at: nowSec };
            if (isObsolete(before)) meta.obsolete = null;
          }
        }
        let task: Task = before;
        if (status || args.label !== undefined || Object.keys(meta).length) {
          task = await manager.patchTask(taskId, {
            ...(status ? { status } : {}),
            ...(args.label !== undefined ? { label: args.label as string } : {}),
            ...(Object.keys(meta).length ? { metadata: meta } : {}),
          });
        }
        if (toolOutput) {
          await manager.cacheToolOutput(taskId, toolOutput.toolName, toolOutput.output);
          task = (await manager.getTask(taskId)) ?? task;
        }
        this.emitTaskEvent('task.updated', {
          task_id: taskId, from_status: before.status, to_status: task.status,
          ...(args.reason ? { reason: args.reason } : {}), ...(args.proof ? { proof: args.proof } : {}),
        });
        return withWarnings({ updated: true, task });
      }
      case 'close': {
        const taskId = args.taskId as string;
        const before = await need(taskId);
        if (before.status === 'completed') {
          return withWarnings({ closed: false, alreadyClosed: true, task: before });
        }
        checkTransition(before, 'completed', { reopen: before.status === 'failed' && isObsolete(before) ? false : undefined });
        const meta = { ...structured(before), closed: { proof: args.proof, at: nowSec }, phase: (args.phase as string | undefined) ?? 'verified' };
        const task = await manager.patchTask(taskId, { status: 'completed', metadata: meta });
        this.emitTaskEvent('task.closed', { task_id: taskId, from_status: before.status, proof: args.proof });
        return withWarnings({ closed: true, task });
      }
      case 'archive': {
        const taskId = args.taskId as string;
        const before = await need(taskId);
        if (before.status === 'completed') {
          throw new TaskInputError(`tarefa ${taskId} ja esta completed (terminal); arquivar so vale para abertas.`);
        }
        const meta = { ...structured(before), obsolete: { reason: args.reason, at: nowSec } };
        const task = await manager.patchTask(taskId, { status: 'failed', metadata: meta });
        this.emitTaskEvent('task.archived', { task_id: taskId, from_status: before.status, reason: args.reason });
        return withWarnings({ archived: true, task });
      }
      case 'merge': {
        const source = await need(args.sourceId as string);
        const target = await need(args.targetId as string);
        const all = await manager.recoverState();
        const byId = new Map(all.map((t) => [t.id, t]));
        const result = await this.applyMerge(manager, source, target, all, byId, { reason: args.reason as string | undefined, nowSec, nowIso, via: 'merge' });
        return withWarnings(result);
      }
      case 'renew': {
        const taskId = args.taskId as string;
        const before = await need(taskId);
        if (!isOpen(before)) throw new TaskInputError(`renew so vale para tarefa aberta (esta ${before.status}).`);
        const prev = metaOf(before).renewedUntil as { count?: number } | undefined;
        const count = (prev?.count ?? (prev ? 1 : 0)) + 1;
        const renewedUntil = { until: args.until, reason: args.reason, at: nowSec, count };
        const task = await manager.patchTask(taskId, { metadata: { ...structured(before), renewedUntil } });
        if (count > RENEW_WARN_COUNT) warnings.push(`renovacao #${String(count)} desta tarefa: renovar sem andar e arquivo disfarcado; feche ou arquive.`);
        this.emitTaskEvent('task.renewed', { task_id: taskId, until: args.until, reason: args.reason });
        return withWarnings({ renewed: true, task });
      }
      case 'get': {
        const task = await need(args.taskId as string);
        return withWarnings({ task });
      }
      case 'list': {
        const tasks = await manager.recoverState();
        const filtered = filterTasks(tasks, {
          status: args.status as string | undefined,
          olderThanDays: args.olderThanDays as number | undefined,
          labelPrefix: args.labelPrefix as string | undefined,
          limit: args.limit as number | undefined,
        }, nowSec);
        return withWarnings({
          total: tasks.length,
          pending: tasks.filter(t => t.status === 'pending').length,
          running: tasks.filter(t => t.status === 'running').length,
          completed: tasks.filter(t => t.status === 'completed').length,
          failed: tasks.filter(t => t.status === 'failed').length,
          matched: filtered.length,
          tasks: args.compact ? filtered.map(compactTask) : filtered,
        });
      }
      case 'tree': {
        const tree = await manager.getTaskTree();
        return { tree: this.serializeTree(tree) };
      }
      case 'clear': {
        const count = (await manager.recoverState()).length;
        const expected = `APAGAR ${String(count)} TAREFAS`;
        if (args.confirm !== expected) {
          throw new TaskInputError(
            `clear apaga TODAS as ${String(count)} tarefas. Para confirmar envie confirm exatamente "${expected}". ` +
              `Para limpar so uma parte use archive (uma tarefa) ou triage. Exemplo: {"action":"clear","confirm":"${expected}"}`
          );
        }
        const backupPath = join(this.dataDir, 'backups', `tasks-${nowIso.replace(/[:.]/g, '-')}.db`);
        await mkdir(join(this.dataDir, 'backups'), { recursive: true });
        this.store?.backupTo(backupPath);
        const deletedCount = await manager.clearAll();
        this.emitTaskEvent('task.cleared', { deleted: deletedCount, backup: backupPath });
        return { cleared: true, deletedCount, backup: backupPath };
      }
      case 'reconcile': {
        const reconciler = await this.getTaskReconciler();
        const since = args.since as string | undefined;
        const staleDays = args.staleDays as number | undefined;
        const result = await reconciler.reconcileFromGit({
          ...(since !== undefined ? { since } : {}),
          ...(staleDays !== undefined ? { staleDays } : {}),
        });
        return { reconciled: true, ...result };
      }
      case 'stale': {
        const reconciler = await this.getTaskReconciler();
        const staleDays = args.staleDays as number | undefined;
        const runningStaleHours = args.runningStaleHours as number | undefined;
        const result = await reconciler.staleCheck({
          ...(staleDays !== undefined ? { staleDays } : {}),
          ...(runningStaleHours !== undefined ? { runningStaleHours } : {}),
        });
        return result;
      }
      case 'triage': {
        const tasks = await manager.recoverState();
        const candidates = triage(tasks, {
          now: nowSec,
          ...(args.staleDays !== undefined ? { staleDays: args.staleDays as number } : {}),
          ...(args.minGroup !== undefined ? { minGroup: args.minGroup as number } : {}),
        });
        const byKind: Record<string, number> = {};
        for (const c of candidates) byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
        const suggestions = relatedSuggestions(tasks);
        if (!args.apply) {
          const clusters: Record<string, string[]> = {};
          for (const c of candidates) if (c.kind === 'merge' && c.mergeInto) (clusters[c.mergeInto] ??= []).push(c.taskId);
          return {
            dryRun: true, candidates: candidates.length, byKind, items: candidates,
            mergeClusters: Object.entries(clusters).map(([targetId, sources]) => ({
              targetId, sources, commands: sources.map((sourceId) => mergeCommand(sourceId, targetId)),
            })),
            suggestions,
            next: 'para aplicar archive/merge: {"action":"triage","apply":true,"confirm":"TRIAGE"}',
          };
        }
        if (args.confirm !== 'TRIAGE') {
          throw new TaskInputError('triage apply exige confirm "TRIAGE". Exemplo: {"action":"triage","apply":true,"confirm":"TRIAGE"}');
        }
        const applied: string[] = [];
        const merged: { sourceId: string; targetId: string }[] = [];
        const errors: { taskId: string; error: string }[] = [];
        for (const c of candidates) {
          if (c.kind === 'close-parent-done') continue; // fechar exige prova humana
          if (c.kind === 'merge' && c.mergeInto) {
            try {
              const fresh = await manager.recoverState();
              const byId2 = new Map(fresh.map((t) => [t.id, t]));
              const src = byId2.get(c.taskId);
              const tgt = byId2.get(c.mergeInto);
              if (!src || !tgt || !isOpen(src) || !isOpen(tgt)) continue; // um lado ja foi tratado neste lote
              await this.applyMerge(manager, src, tgt, fresh, byId2, { reason: `triage: ${c.reason}`, nowSec, nowIso, via: 'triage' });
              merged.push({ sourceId: c.taskId, targetId: c.mergeInto });
              applied.push(c.taskId);
            } catch (e) {
              errors.push({ taskId: c.taskId, error: e instanceof Error ? e.message : String(e) });
            }
            continue;
          }
          const reason = `triage: ${c.reason}`;
          await manager.patchTask(c.taskId, { status: 'failed', metadata: { obsolete: { reason, at: nowSec } } });
          this.emitTaskEvent('task.archived', { task_id: c.taskId, reason, via: 'triage' });
          applied.push(c.taskId);
        }
        return { dryRun: false, archived: applied.length - merged.length, merged: merged.length, mergedPairs: merged, skipped: candidates.length - applied.length, ids: applied, ...(errors.length ? { errors } : {}) };
      }
      case 'report': {
        const tasks = await manager.recoverState();
        return burnReport(tasks, nowSec, (args.months as number | undefined) ?? 6);
      }
      default:
        throw new TaskInputError(`Unknown task action: ${String(action)}. Acoes: ${TASK_ACTIONS.join(', ')}`);
    }
  }

  /** Aplica um MergePlan: alvo absorve a origem; filhos reparentados; origem arquivada; eventos no audit.db. */
  private async applyMerge(
    manager: TaskManager,
    source: Task,
    target: Task,
    all: Task[],
    byId: Map<string, Task>,
    o: { reason?: string | undefined; nowSec: number; nowIso: string; via: string }
  ): Promise<Record<string, unknown>> {
    const children = all.filter((t) => t.parentId === source.id);
    const plan = planMerge({ source, target, sourceChildren: children, getById: (id) => byId.get(id), ...(o.reason ? { reason: o.reason } : {}), nowSec: o.nowSec, nowIso: o.nowIso });
    if (plan.alreadyMerged) {
      return { merged: false, alreadyMerged: true, sourceId: source.id, targetId: target.id, task: target };
    }
    const savedTarget = await manager.patchTask(target.id, { metadata: plan.targetPatch });
    // reparent direto no store: patchTask nao mexe em parentId
    const store = must(this.store, 'store de tarefas nao inicializado');
    for (const cid of plan.reparent) {
      const child = await store.get(cid);
      if (child) await store.save({ ...child, parentId: target.id });
    }
    const savedSource = await manager.patchTask(source.id, { status: 'failed', metadata: plan.sourcePatch });
    this.emitTaskEvent('task.merged', {
      source_id: source.id, target_id: target.id, reparented: plan.reparent.length, notes: plan.notesAppended,
      ...(o.reason ? { reason: o.reason } : {}), via: o.via,
    });
    this.emitTaskEvent('task.archived', { task_id: source.id, from_status: source.status, reason: `mesclada em ${target.id}`, via: o.via });
    return {
      merged: true, sourceId: source.id, targetId: target.id, reparented: plan.reparent, notesAppended: plan.notesAppended,
      target: savedTarget, source: savedSource,
    };
  }

  /**
   * Build a {@link TaskReconciler} bound to the project's git repo and the
   * persistent reconcile marker. The audit sink is backed by the same
   * `.batiste/audit.db` EventLog the rest of the CLI uses, so each closure
   * lands as a `task.reconciled` event with the commit SHA as evidence.
   */
  private async getTaskReconciler(): Promise<TaskReconciler> {
    const manager = await this.getTaskManager();
    this.reconcileMarkerStore ??= new SQLiteReconcileMarkerStore(
      join(this.dataDir, 'reconcile.db')
    );
    this.auditEventLog ??= new EventLog(join(this.dataDir, 'audit.db'));
    const eventLog = this.auditEventLog;
    const auditSink: ReconcileAuditSink = {
      recordClosure: ({ taskId, label, commitSha, matchedBy }) => {
        eventLog.append({
          ts: new Date().toISOString(),
          event: 'task.reconciled',
          generator: 'batiste manage_task reconcile',
          payload: { task_id: taskId, subject: label, commit_sha: commitSha, matched_by: matchedBy },
        });
      },
    };
    return new TaskReconciler(
      manager,
      this.projectRoot,
      this.reconcileMarkerStore,
      auditSink
    );
  }

  private serializeTree(nodes: TaskNode[]): unknown[] {
    return nodes.map(node => ({
      id: node.task.id,
      label: node.task.label,
      status: node.task.status,
      children: this.serializeTree(node.children),
    }));
  }

  /** Resolve a path relative to projectRoot, or return it unchanged if already absolute. */
  private resolvePath(p: string): string {
    return isAbsolute(p) ? p : join(this.projectRoot, p);
  }

  private async runTDD(args: Record<string, unknown>): Promise<unknown> {
    const engine = new HypothesisEngine();
    const hypothesis = engine.createHypothesis(
      args.description as string,
      args.testCode as string,
      args.implementationCode as string,
      this.resolvePath(args.testFilePath as string),
      this.resolvePath(args.implementationFilePath as string)
    );

    const options = {
      ...(args.testTimeout !== undefined && { testTimeout: args.testTimeout as number }),
      ...(args.autoFix !== undefined && { autoFix: args.autoFix as boolean }),
    };

    const result = await engine.runTDDCycle(hypothesis, options);

    return {
      phase: result.phase,
      passed: result.phase === 'complete',
      suggestions: result.suggestions,
      error: result.error,
      testResult: result.testResult
        ? {
            exitCode: result.testResult.exitCode,
            stdout: result.testResult.stdout.slice(0, 2000),
            stderr: result.testResult.stderr.slice(0, 2000),
          }
        : undefined,
    };
  }

  private async findSymbol(args: Record<string, unknown>): Promise<unknown> {
    const symbolName = args.symbolName as string;
    const language = args.language as string | undefined;
    const cluster = args.cluster as string | undefined;
    const entryPoints = (args.entryPoints as string[]).map(p =>
      p.startsWith('/') ? p : join(this.projectRoot, p)
    );

    // Phase 3 graph-backed path. Activates only when (a) a graph has
    // been attached via `setGraph` and (b) the caller actually asked
    // for cluster-aware behaviour OR the graph already covers the
    // requested symbol. The legacy tree-sitter / LSP path stays the
    // default so unattached deployments keep working unchanged.
    if (this.graphQuerier) {
      const findOpts = language ? { language } : undefined;
      const hits = cluster
        ? this.graphQuerier.findSymbolInCluster(symbolName, cluster, findOpts)
        : this.graphQuerier.findSymbol(symbolName, findOpts);
      if (hits.length > 0) {
        return {
          symbolName,
          language: language ?? null,
          cluster: cluster ?? null,
          source: 'graph',
          definitions: hits.map((h) => ({
            file: h.node.path ?? null,
            line: null,
            type: h.node.kind,
            name: h.node.label,
            cluster: h.cluster?.label ?? null,
          })),
          callSites: [],
          definitionCount: hits.length,
          callSiteCount: 0,
        };
      }
      // Empty graph hits when the caller pinned a cluster: respect the
      // pin and return empty rather than falling back to a non-cluster-
      // aware scan that would defeat the user's intent.
      if (cluster) {
        return {
          symbolName,
          language: language ?? null,
          cluster,
          source: 'graph',
          definitions: [],
          callSites: [],
          definitionCount: 0,
          callSiteCount: 0,
        };
      }
      // Otherwise fall through to the tree-sitter / LSP path.
    }

    const resolver = await this.getSymbolResolver();
    const result = await resolver.findSymbol(symbolName, entryPoints);

    // Phase 2a — optional language filter. We resolve a file's language
    // by asking a one-shot adapter for the strategy that owns its
    // extension, then drop hits whose host language does not match.
    let definitions = result.definitions;
    let references = result.references;
    if (language) {
      const adapter = new TreeSitterAdapter();
      const inLanguage = (file: string): boolean => {
        const strategy = adapter.getStrategyForFile(file);
        return strategy?.languageId === language;
      };
      definitions = definitions.filter(d => inLanguage(d.file));
      references = references.filter(r => inLanguage(r.file));
    }

    return {
      symbolName: result.symbolName,
      language: language ?? null,
      definitions: definitions.map(d => ({
        file: d.file,
        line: d.line,
        type: d.type,
        name: d.name,
        source: d.source,
      })),
      callSites: references.map(r => ({
        file: r.file,
        line: r.line,
        source: r.source,
      })),
      definitionCount: definitions.length,
      callSiteCount: references.length,
      source: result.source,
      lspAvailable: resolver.isLSPAvailable(),
    };
  }

  private async getSymbolResolver(): Promise<SymbolResolver> {
    if (!this.symbolResolver) {
      this.symbolResolver = new SymbolResolver(this.projectRoot);
      await this.symbolResolver.initialize();
    }
    return this.symbolResolver;
  }

  private async getTaskManager(): Promise<TaskManager> {
    if (!this.taskManager) {
      await mkdir(this.dataDir, { recursive: true });
      this.store = new SQLiteTaskStore(join(this.dataDir, 'tasks.db'));
      this.taskManager = new TaskManager(this.store);
    }
    return this.taskManager;
  }

  private async indexCodebase(args: Record<string, unknown>): Promise<unknown> {
    const mode = (args.mode as string | undefined) ?? 'incremental';
    const includeUncommitted = args.includeUncommitted !== false;

    const config = loadConfig({
      projectRoot: this.projectRoot,
      dataDir: this.dataDir,
    });

    const indexer = new GitAwareIndexer(config);
    await indexer.initialize();

    if (mode === 'full') {
      await indexer.saveState({
        lastIndexedCommit: null,
        lastIndexedAt: 0,
        branch: '',
        totalFiles: 0,
        includesUncommitted: false,
      });
    }

    const plan = await indexer.planIncrementalIndex(includeUncommitted);

    // Execute the plan: update file index entries
    for (const file of plan.filesToIndex) {
      indexer.updateFileIndex(file.relativePath, {
        hash: file.hash,
        mtime: file.modifiedAt.getTime(),
        indexedAt: Date.now(),
        chunkCount: 1,
      });
    }

    // Remove deleted files from index
    for (const removedPath of plan.filesToRemove) {
      indexer.removeFromFileIndex(removedPath);
    }

    // Persist the file index and record success
    await indexer.saveFileIndex();
    await indexer.recordIndexSuccess(
      plan.stats.totalFilesInRepo,
      includeUncommitted
    );

    return {
      mode,
      isFullReindex: plan.isFullReindex,
      reason: plan.reason,
      stats: plan.stats,
      filesToIndex: plan.filesToIndex.map(f => f.relativePath),
      filesToRemove: plan.filesToRemove,
      gitAvailable: !!plan.gitDiff,
      currentState: indexer.getState(),
    };
  }

  private async summarizeCodebase(args: Record<string, unknown>): Promise<unknown> {
    const scope = (args.scope as string | undefined) ?? '';
    const depth = (args.depth as string | undefined) ?? 'overview';
    const focus = (args.focus as string[] | undefined) ?? ['architecture', 'entry-points'];
    const maxTokens = (args.maxTokens as number | undefined) ?? 2000;
    const cluster = args.cluster as string | undefined;

    // Phase 3 graph-backed path. When a graph is attached, we layer
    // cluster-level statistics onto the response. The tree-sitter
    // dependency-graph path still runs underneath so structural metrics
    // (totalFiles, circularDependencies) keep the same shape — this is
    // pure enrichment, not a replacement.
    let graphLayer: Record<string, unknown> | null = null;
    if (this.graphQuerier) {
      const rows = this.graphQuerier.clusterSummary();
      const filtered = cluster ? rows.filter((r) => r.label === cluster) : rows;
      graphLayer = {
        source: 'graph',
        cluster: cluster ?? null,
        clusterCount: filtered.length,
        clusters: filtered.slice(0, 10),
        // The graph's own stable summary is byte-stable across runs, so
        // including it keeps the response reproducible for audit.
        graphSummary: this.graphQuerier.summarize(maxTokens, cluster),
      };
    }

    const scopePath = scope ? join(this.projectRoot, scope) : this.projectRoot;

    const adapter = new TreeSitterAdapter();
    const scout = new RecursiveScout(adapter, { maxDepth: 10 });

    // Try loading indexed files first, fall back to glob discovery
    const fileIndex = new FileIndex(this.dataDir, this.projectRoot);
    await fileIndex.load();

    let limitedEntryPoints: string[];
    let allIndexedFiles: string[] = [];

    if (fileIndex.size > 0) {
      // Use indexed files — filter to scope and pick entry points
      allIndexedFiles = fileIndex.getAllFiles()
        .map(f => join(this.projectRoot, f.relativePath))
        .filter(p => p.startsWith(scopePath));

      // Look for common entry point names across all languages
      const entryNames = ['main', 'app', 'index', '__init__', 'mod', 'lib'];
      const entryFiles = allIndexedFiles.filter(p => {
        const base = p.replace(/\.[^.]+$/, '').split('/').pop() ?? '';
        return entryNames.includes(base);
      });

      limitedEntryPoints = (entryFiles.length > 0 ? entryFiles : allIndexedFiles).slice(0, 5);
    } else {
      // Fallback: glob discovery with multi-language entry patterns
      const entryPatterns = [
        'index.ts', 'index.js', 'main.ts', 'main.js', 'app.ts', 'app.js',
        'main.py', 'app.py', '__init__.py',
        'main.go', 'main.rs', 'lib.rs',
      ];
      const fg = (await import('fast-glob')).default;
      const entryPoints = await fg(entryPatterns.map(p => join(scopePath, '**', p)), {
        ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/.venv/**', '**/venv/**'],
      });
      limitedEntryPoints = entryPoints.slice(0, 5);

      if (limitedEntryPoints.length === 0) {
        // Broader fallback: any source file
        const fallbackFiles = await fg([
          join(scopePath, 'src/**/*.{ts,js,py,rs,go}'),
          join(scopePath, '**/*.{ts,js,py,rs,go}'),
        ], {
          ignore: [
            '**/*.test.*', '**/*.spec.*', '**/test_*',
            '**/node_modules/**', '**/.venv/**', '**/venv/**',
          ],
        });
        limitedEntryPoints.push(...fallbackFiles.slice(0, 5));
      }
    }

    const summary: Record<string, unknown> = { scope: scope || '/', depth, focus };

    if (limitedEntryPoints.length > 0) {
      let graph = await scout.buildDependencyGraph(limitedEntryPoints);
      let stats = scout.getGraphStats(graph);

      // Coverage fallback: if entry-name files (e.g., __init__.py in Python) didn't
      // import their siblings, the graph misses most of the indexed corpus.
      // Retry with all indexed files as roots, capped for performance.
      if (allIndexedFiles.length > 5 && stats.totalFiles < allIndexedFiles.length * 0.5) {
        const allRoots = allIndexedFiles.slice(0, 50);
        graph = await scout.buildDependencyGraph(allRoots);
        stats = scout.getGraphStats(graph);
      }

      summary.architecture = {
        totalFiles: stats.totalFiles,
        totalSymbols: stats.totalSymbols,
        totalImports: stats.totalImports,
        circularDependencies: graph.circularDeps.length,
        entryPoints: graph.roots,
        leafFiles: graph.leaves.slice(0, 10),
      };

      if (depth === 'detailed') {
        const exports: { file: string; symbols: string[] }[] = [];
        for (const entryPoint of limitedEntryPoints.slice(0, 3)) {
          const node = graph.nodes.get(entryPoint);
          if (node) {
            exports.push({
              file: entryPoint.replace(this.projectRoot, ''),
              symbols: node.symbols
                .filter(s => s.type === 'function' || s.type === 'class')
                .slice(0, 10)
                .map(s => `${s.type}:${s.name}`),
            });
          }
        }
        summary.exports = exports;
      }

      const summaryJson = JSON.stringify(summary);
      const estimatedTokens = Math.ceil(summaryJson.length / 4);
      summary.estimatedTokens = estimatedTokens;
      summary.withinBudget = estimatedTokens <= maxTokens;
    } else {
      summary.error = 'No source files found in scope';
    }

    if (graphLayer) {
      summary.graph = graphLayer;
    }

    return summary;
  }

  private getContextBudget(): ContextBudgetMonitor {
    this.contextBudget ??= new ContextBudgetMonitor(DEFAULT_BUDGET_CONFIG);
    return this.contextBudget;
  }

  private contextBudgetAction(args: Record<string, unknown>): unknown {
    const action = args.action as string;
    const monitor = this.getContextBudget();

    switch (action) {
      case 'status': {
        const categories: BudgetCategory[] = ['code', 'summary', 'messages', 'other'];
        const categoryStatus = categories.map(cat => monitor.checkBudget(cat));
        return {
          categories: categoryStatus.filter(s => s.used > 0 || s.limit > 0),
          total: monitor.checkTotalBudget(),
          suggestions: monitor.getSuggestions(),
          summary: monitor.getSummary(),
        };
      }
      case 'add': {
        const category = (args.category as BudgetCategory | undefined) ?? 'other';
        let tokens: number;
        if (args.content) {
          tokens = monitor.addContent(category, args.content as string);
        } else if (args.tokens) {
          tokens = args.tokens as number;
          monitor.addTokens(category, tokens);
        } else {
          throw new Error('Either tokens or content must be provided for add action');
        }
        const status = monitor.checkBudget(category);
        return {
          added: tokens,
          category,
          status,
          suggestions: status.warning || !status.withinBudget ? monitor.getSuggestions() : [],
        };
      }
      case 'reset': {
        const category = args.category as BudgetCategory | undefined;
        monitor.reset(category);
        return { reset: true, category: category ?? 'all' };
      }
      case 'configure': {
        const config = args.config as Partial<BudgetConfig> | undefined;
        if (config) {
          this.contextBudget = new ContextBudgetMonitor({
            totalBudget: config.totalBudget ?? DEFAULT_BUDGET_CONFIG.totalBudget,
            categoryBudgets: {
              ...DEFAULT_BUDGET_CONFIG.categoryBudgets,
              ...config.categoryBudgets,
            },
            warningThreshold: config.warningThreshold ?? DEFAULT_BUDGET_CONFIG.warningThreshold,
          });
        }
        return {
          configured: true,
          config: { totalBudget: this.getContextBudget().checkTotalBudget().limit },
        };
      }
      default:
        throw new Error(`Unknown context_budget action: ${action}`);
    }
  }

  private async autoFix(args: Record<string, unknown>): Promise<unknown> {
    const paths = (args.paths as string[]).map(p =>
      p.startsWith('/') ? p : join(this.projectRoot, p)
    );
    const dryRun = args.dryRun !== false;
    const maxFixes = (args.maxFixes as number | undefined) ?? 20;
    const minConfidence = (args.confidence as 'high' | 'medium' | 'low' | undefined) ?? 'high';
    const maxIterations = (args.maxIterations as number | undefined) ?? 5;

    const fixer = new AutoFixer({ projectRoot: this.projectRoot });
    const result = await fixer.fix(paths, {
      dryRun,
      maxFixesPerIteration: maxFixes,
      minConfidence,
      maxIterations,
    });

    return {
      status: result.status,
      dryRun: result.dryRun,
      iterations: result.iterations,
      converged: result.converged,
      initialErrors: result.initialErrors,
      remainingErrors: result.remainingErrors,
      totalFixesApplied: result.totalFixesApplied,
      fixes: result.allFixes.slice(0, 20).map(fix => ({
        file: fix.file.replace(this.projectRoot + '/', ''),
        line: fix.line,
        action: fix.action,
        description: fix.description,
        confidence: fix.confidence,
      })),
      diffSummary: result.diffSummary,
      diffs: result.diffs.map(d => ({
        file: d.file.replace(this.projectRoot + '/', ''),
        changes: d.changes.length,
        additions: d.additions,
        deletions: d.deletions,
      })),
      iterationDetails: result.iterationDetails,
      hint: dryRun
        ? "Set dryRun: false to apply these fixes"
        : result.status === 'partial'
          ? `Fixed some errors but ${String(result.remainingErrors)} remain`
          : undefined,
    };
  }

  private getOrchestrator(): Orchestrator {
    this.orchestrator ??= new Orchestrator();
    return this.orchestrator;
  }

  private async orchestrateAgents(args: Record<string, unknown>): Promise<unknown> {
    const action = args.action as string;
    const orch = this.getOrchestrator();

    switch (action) {
      case 'create_pool': {
        const role = args.role as Parameters<Orchestrator['createPool']>[0];
        const poolSpec = (args.poolSpec ?? {}) as Parameters<Orchestrator['createPool']>[1];
        await orch.createPool(role, poolSpec);
        return { created: true, role };
      }
      case 'remove_pool': {
        const role = args.role as Parameters<Orchestrator['createPool']>[0];
        const removed = await orch.removePool(role);
        return { removed, role };
      }
      case 'submit_task': {
        const role = args.role as Parameters<Orchestrator['createPool']>[0];
        const task = args.task as {
          description: string;
          context?: Record<string, unknown>;
          files?: string[];
          priority?: 'low' | 'normal' | 'high' | 'critical';
          retryPolicy?: { maxRetries: number; backoffMs: number };
        };
        const pool = orch.getPool(role);
        if (!pool) throw new Error(`No pool for role: ${role}. Create a pool first.`);
        const taskId = await pool.submitTask({
          taskId: `task-${String(Date.now())}`,
          description: task.description,
          context: task.context,
          priority: task.priority ?? 'normal',
          retryPolicy: task.retryPolicy,
        });
        return { submitted: true, taskId };
      }
      case 'get_status': {
        return orch.getStatus();
      }
      case 'get_dead_letter_queue': {
        const role = args.role as Parameters<Orchestrator['createPool']>[0];
        const pool = orch.getPool(role);
        if (!pool) throw new Error(`No pool for role: ${role}`);
        return { deadLetterQueue: pool.getDeadLetterQueue() };
      }
      case 'execute_workflow': {
        const workflowId = args.workflowId as string;
        const workflowInput = (args.workflowInput ?? {}) as Record<string, unknown>;
        const execution = await orch.executeWorkflow(workflowId, workflowInput);
        return {
          executionId: execution.id,
          status: execution.status,
          currentStage: execution.currentStage,
          completedAt: execution.completedAt,
          error: execution.error,
        };
      }
      case 'create_checkpoint': {
        const executionId = args.executionId as string;
        const checkpoint = orch.createCheckpoint(executionId);
        return { checkpointId: checkpoint.id, phase: checkpoint.phase, timestamp: checkpoint.timestamp };
      }
      case 'restore_checkpoint': {
        const executionId = args.executionId as string;
        const checkpointId = args.checkpointId as string;
        await orch.restoreFromCheckpoint(executionId, checkpointId);
        return { restored: true, executionId, checkpointId };
      }
      case 'shutdown': {
        await orch.shutdown();
        this.orchestrator = null;
        return { shutdown: true };
      }
      default:
        throw new Error(`Unknown orchestrate_agents action: ${action}`);
    }
  }

  async close(): Promise<void> {
    if (this.store) {
      this.store.close();
      this.store = null;
      this.taskManager = null;
    }
    if (this.reconcileMarkerStore) {
      this.reconcileMarkerStore.close();
      this.reconcileMarkerStore = null;
    }
    if (this.auditEventLog) {
      this.auditEventLog.close();
      this.auditEventLog = null;
    }
    if (this.symbolResolver) {
      await this.symbolResolver.stop();
      this.symbolResolver = null;
    }
    if (this.orchestrator) {
      await this.orchestrator.shutdown();
      this.orchestrator = null;
    }
  }

  private async vaultValidate(args: Record<string, unknown>): Promise<unknown> {
    const vaultPath = this.resolvePath(args.path as string);
    const repoRootArg = args.repoRoot as string | undefined;
    const skipCanonical = (args.skipCanonical as boolean | undefined) ?? false;
    const maxIssues = (args.maxIssues as number | undefined) ?? 50;

    const vault = await loadVault(vaultPath);
    const report = await validateVault(vault, {
      repoRoot: repoRootArg ? this.resolvePath(repoRootArg) : undefined,
      skipCanonical,
    });

    const errors = report.issues.filter((i) => i.severity === 'error').slice(0, maxIssues);
    const warnings = report.issues.filter((i) => i.severity === 'warning').slice(0, maxIssues);

    return {
      vault: report.vault,
      gvsVersion: report.gvsVersion,
      conforming: report.conforming,
      counts: report.counts,
      truncated: {
        errors: report.counts.errors > errors.length,
        warnings: report.counts.warnings > warnings.length,
      },
      errors,
      warnings,
    };
  }

  private async vaultIndex(args: Record<string, unknown>): Promise<unknown> {
    const vaultPath = this.resolvePath(args.path as string);
    const axisFilter = args.axis as Axis | undefined;

    const vault = await loadVault(vaultPath);
    const axesToReturn = axisFilter ? [axisFilter] : [...AXES];

    const byAxis: Record<string, unknown[]> = {};
    for (const axis of axesToReturn) {
      byAxis[axis] = vault.notesByAxis[axis].map((n) => ({
        title: n.title,
        path: n.relativePath,
        status: n.frontmatter.status ?? null,
        tags: n.frontmatter.tags ?? [],
        canonical: n.frontmatter.canonical ?? null,
        wikilinks: n.wikilinks,
      }));
    }

    return {
      root: vault.root,
      gvsVersion: vault.gvsVersion,
      home: vault.home?.relativePath ?? null,
      totals: {
        notes: vault.all.length,
        templates: vault.templates.length,
        attachments: vault.attachments.length,
      },
      byAxis,
    };
  }
}
