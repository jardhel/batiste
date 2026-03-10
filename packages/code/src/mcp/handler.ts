/**
 * MCP Tool Handler for @batiste/code
 *
 * Implements the logic for each MCP tool.
 * Uses @batiste/core for tasks, context, sandbox, and agents.
 */

import { join } from 'path';
import { mkdir } from 'fs/promises';
import type { ToolName } from './tools.js';
import { SQLiteTaskStore, TaskManager, type TaskNode } from '@batiste/core/tasks';
import { ContextBudgetMonitor, type BudgetCategory, type BudgetConfig } from '@batiste/core/context';
import { ProcessSandbox } from '@batiste/core/sandbox';
import { RecursiveScout } from '../analysis/RecursiveScout.js';
import { TreeSitterAdapter } from '../parsers/TreeSitterAdapter.js';
import { Gatekeeper } from '../validation/Gatekeeper.js';
import { HypothesisEngine } from '../tdd/HypothesisEngine.js';
import { SymbolResolver } from '../lsp/symbol-resolver.js';
import { GitAwareIndexer } from '../indexer/git-aware-indexer.js';
import { loadConfig } from '../utils/config.js';
import { AutoFixer } from '../autofix/AutoFixer.js';

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

  constructor(projectRoot: string, dataDir: string) {
    this.projectRoot = projectRoot;
    this.dataDir = dataDir;
  }

  async handleTool(name: ToolName, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'analyze_dependency': return this.analyzeDependency(args);
      case 'validate_code': return this.validateCode(args);
      case 'execute_sandbox': return this.executeSandbox(args);
      case 'manage_task': return this.manageTask(args);
      case 'run_tdd': return this.runTDD(args);
      case 'find_symbol': return this.findSymbol(args);
      case 'index_codebase': return this.indexCodebase(args);
      case 'summarize_codebase': return this.summarizeCodebase(args);
      case 'context_budget': return this.contextBudgetAction(args);
      case 'auto_fix': return this.autoFix(args);
      default: throw new Error(`Unknown tool: ${name}`);
    }
  }

  private async analyzeDependency(args: Record<string, unknown>): Promise<unknown> {
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

  private async runTDD(args: Record<string, unknown>): Promise<unknown> {
    const engine = new HypothesisEngine();
    const hypothesis = engine.createHypothesis(
      args.description as string,
      args.testCode as string,
      args.implementationCode as string,
      join(this.projectRoot, args.testFilePath as string),
      join(this.projectRoot, args.implementationFilePath as string)
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

    const entryPatterns = ['index.ts', 'index.js', 'main.ts', 'main.js', 'app.ts', 'app.js'];
    const fg = (await import('fast-glob')).default;
    const entryPoints = await fg(entryPatterns.map(p => join(scopePath, '**', p)), {
      ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
    });
    const limitedEntryPoints = entryPoints.slice(0, 5);

    if (limitedEntryPoints.length === 0) {
      const fallbackFiles = await fg([join(scopePath, 'src/**/*.ts'), join(scopePath, '*.ts')], {
        ignore: ['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**'],
      });
      limitedEntryPoints.push(...fallbackFiles.slice(0, 3));
    }

    const summary: Record<string, unknown> = { scope: scope || '/', depth, focus };

    if (limitedEntryPoints.length > 0) {
      const graph = await scout.buildDependencyGraph(limitedEntryPoints);
      const stats = scout.getGraphStats(graph);

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
  }
}
