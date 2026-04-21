/**
 * MCP Tool Handler for @batiste-aidk/code
 *
 * Implements the logic for each MCP tool.
 * Uses @batiste-aidk/core for tasks, context, sandbox, and agents.
 */

import { join, isAbsolute } from 'path';
import { mkdir } from 'fs/promises';
import { z } from 'zod';
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
import { SQLiteTaskStore, TaskManager, type TaskNode } from '@batiste-aidk/core/tasks';
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
  const schema = INPUT_SCHEMAS[name];
  if (!schema) throw new Error(`Unknown tool: ${String(name)}`);
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
  private symbolResolver: SymbolResolver | null = null;
  private contextBudget: ContextBudgetMonitor | null = null;
  private orchestrator: Orchestrator | null = null;

  constructor(projectRoot: string, dataDir: string) {
    this.projectRoot = projectRoot;
    this.dataDir = dataDir;
  }

  async handleTool(name: ToolName, args: Record<string, unknown>): Promise<unknown> {
    // E3-B05: validate every tool invocation at the MCP dispatch
    // boundary. If the input shape is wrong we fail **before** any
    // side effect, so the audit ledger sees a single tamper-evident
    // INPUT_VALIDATION_FAILED entry instead of a half-applied handler.
    const validated = validateInput(name, args);
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
      default: throw new Error(`Unknown tool: ${name}`);
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
    const maxIssues = (args.maxIssues as number) ?? 10;

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
        ? `Use maxIssues parameter to see more (showing ${maxIssues} per validator)`
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

  private async manageTask(args: Record<string, unknown>): Promise<unknown> {
    const action = args.action as string;
    const manager = await this.getTaskManager();

    switch (action) {
      case 'create': {
        const label = args.label as string;
        const parentId = args.parentId as string | undefined;
        const task = parentId
          ? await manager.spawnSubtask(parentId, label)
          : await manager.createRootGoal(label);
        return { created: true, task };
      }
      case 'update': {
        const taskId = args.taskId as string;
        const status = args.status as 'pending' | 'running' | 'completed' | 'failed' | undefined;
        const toolOutput = args.toolOutput as { toolName: string; output: unknown } | undefined;
        if (status) await manager.updateStatus(taskId, status);
        if (toolOutput) await manager.cacheToolOutput(taskId, toolOutput.toolName, toolOutput.output);
        const task = await manager.getTask(taskId);
        return { updated: true, task };
      }
      case 'get': {
        const task = await manager.getTask(args.taskId as string);
        return { task };
      }
      case 'list': {
        const tasks = await manager.recoverState();
        return {
          total: tasks.length,
          pending: tasks.filter(t => t.status === 'pending').length,
          running: tasks.filter(t => t.status === 'running').length,
          completed: tasks.filter(t => t.status === 'completed').length,
          failed: tasks.filter(t => t.status === 'failed').length,
          tasks,
        };
      }
      case 'tree': {
        const tree = await manager.getTaskTree();
        return { tree: this.serializeTree(tree) };
      }
      case 'clear': {
        const deletedCount = await manager.clearAll();
        return { cleared: true, deletedCount };
      }
      default:
        throw new Error(`Unknown task action: ${action}`);
    }
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
    const entryPoints = (args.entryPoints as string[]).map(p =>
      p.startsWith('/') ? p : join(this.projectRoot, p)
    );

    const resolver = await this.getSymbolResolver();
    const result = await resolver.findSymbol(symbolName, entryPoints);

    return {
      symbolName: result.symbolName,
      definitions: result.definitions.map(d => ({
        file: d.file,
        line: d.line,
        type: d.type,
        name: d.name,
        source: d.source,
      })),
      callSites: result.references.map(r => ({
        file: r.file,
        line: r.line,
        source: r.source,
      })),
      definitionCount: result.definitionCount,
      callSiteCount: result.referenceCount,
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
    const mode = (args.mode as string) ?? 'incremental';
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
    const scope = (args.scope as string) ?? '';
    const depth = (args.depth as string) ?? 'overview';
    const focus = (args.focus as string[]) ?? ['architecture', 'entry-points'];
    const maxTokens = (args.maxTokens as number) ?? 2000;

    const scopePath = scope ? join(this.projectRoot, scope) : this.projectRoot;

    const adapter = new TreeSitterAdapter();
    const scout = new RecursiveScout(adapter, { maxDepth: 10 });

    // Try loading indexed files first, fall back to glob discovery
    const fileIndex = new FileIndex(this.dataDir, this.projectRoot);
    await fileIndex.load();

    let limitedEntryPoints: string[] = [];
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
        const exports: Array<{ file: string; symbols: string[] }> = [];
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

    return summary;
  }

  private getContextBudget(): ContextBudgetMonitor {
    if (!this.contextBudget) {
      this.contextBudget = new ContextBudgetMonitor(DEFAULT_BUDGET_CONFIG);
    }
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
        const category = (args.category as BudgetCategory) ?? 'other';
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
    const maxFixes = (args.maxFixes as number) ?? 20;
    const minConfidence = (args.confidence as 'high' | 'medium' | 'low') ?? 'high';
    const maxIterations = (args.maxIterations as number) ?? 5;

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
          ? `Fixed some errors but ${result.remainingErrors} remain`
          : undefined,
    };
  }

  private getOrchestrator(): Orchestrator {
    if (!this.orchestrator) {
      this.orchestrator = new Orchestrator();
    }
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
          taskId: `task-${Date.now()}`,
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
    const vaultPath = this.resolvePath(args['path'] as string);
    const repoRootArg = args['repoRoot'] as string | undefined;
    const skipCanonical = (args['skipCanonical'] as boolean | undefined) ?? false;
    const maxIssues = (args['maxIssues'] as number | undefined) ?? 50;

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
    const vaultPath = this.resolvePath(args['path'] as string);
    const axisFilter = args['axis'] as Axis | undefined;

    const vault = await loadVault(vaultPath);
    const axesToReturn = axisFilter ? [axisFilter] : [...AXES];

    const byAxis: Record<string, unknown[]> = {};
    for (const axis of axesToReturn) {
      byAxis[axis] = vault.notesByAxis[axis].map((n) => ({
        title: n.title,
        path: n.relativePath,
        status: n.frontmatter['status'] ?? null,
        tags: n.frontmatter['tags'] ?? [],
        canonical: n.frontmatter['canonical'] ?? null,
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
