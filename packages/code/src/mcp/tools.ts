/**
 * MCP Tool Definitions for @batiste-aidk/code
 *
 * Defines all available tools and their input schemas.
 */

import { z } from 'zod';
import type { ToolDefinition } from '@batiste-aidk/core/mcp';

export const AnalyzeDependencyInput = z.object({
  entryPoints: z.array(z.string()).describe('File paths to analyze'),
  maxDepth: z.number().optional().describe('Maximum dependency depth'),
  includeNodeModules: z.boolean().optional().describe('Include node_modules'),
});

export const ValidateCodeInput = z.object({
  paths: z.array(z.string()).describe('Files to validate'),
  fix: z.boolean().optional().describe('Auto-fix issues if possible'),
  maxIssues: z.number().optional().describe('Max issues to return per validator (default: 10)'),
});

export const ExecuteSandboxInput = z.object({
  command: z.string().describe('Command to execute'),
  args: z.array(z.string()).optional().describe('Command arguments'),
  timeout: z.number().optional().describe('Timeout in milliseconds'),
  workingDir: z.string().optional().describe('Working directory'),
});

export const ManageTaskInput = z.object({
  action: z
    .enum(['create', 'update', 'get', 'list', 'tree', 'clear', 'reconcile', 'stale', 'close', 'archive', 'renew', 'merge', 'triage', 'report'])
    .describe('Task action'),
  taskId: z.string().optional().describe('Task ID for update/get/close/archive/renew (alias: id)'),
  sourceId: z.string().optional().describe('merge: task absorbed (archived as "mesclada em <targetId>")'),
  targetId: z.string().optional().describe('merge: task that stays and absorbs notes/links/tags/children'),
  label: z.string().optional().describe('Task label for create (short title, max 120 chars)'),
  parentId: z.string().optional().describe('Parent task ID'),
  status: z.enum(['pending', 'running', 'completed', 'failed']).optional(),
  toolOutput: z.object({
    toolName: z.string().default('manual'),
    output: z.any(),
  }).optional().describe('Cache tool output (toolName optional)'),
  since: z
    .string()
    .optional()
    .describe('reconcile: git revision lower bound (default: persisted marker / recent window)'),
  staleDays: z
    .number()
    .optional()
    .describe('reconcile/stale: days untouched before a pending task is flagged stale (default 14)'),
  runningStaleHours: z.number().optional().describe('stale: hours without update before a running task is flagged (default 48)'),
  proof: z.string().optional().describe('close/update completed: evidence (commit, url, deploy id, prova-no-ar)'),
  reason: z.string().optional().describe('archive/renew/reopen/merge: why'),
  until: z.string().optional().describe('renew: YYYY-MM-DD or +Nd'),
  reopen: z.boolean().optional().describe('update: allow leaving a terminal status (needs reason)'),
  confirm: z.string().optional().describe('clear: "APAGAR <N> TAREFAS"; triage apply: "TRIAGE"'),
  apply: z.boolean().optional().describe('triage: execute archive/merge candidates (default dry-run)'),
  minGroup: z.number().optional().describe('triage: min open tasks sharing a prefix to flag the group'),
  olderThanDays: z.number().optional().describe('list: only tasks untouched for more than N days'),
  labelPrefix: z.string().optional().describe('list: label prefix filter'),
  limit: z.number().optional().describe('list: max tasks returned'),
  compact: z.boolean().optional().describe('list: omit context/toolOutputs'),
  months: z.number().optional().describe('report: months of history'),
  dedupeKey: z.string().optional().describe('create: idempotency key; an open task with the same key is returned instead of a duplicate'),
  allowDuplicate: z.boolean().optional().describe('create: permit a second open task with the same normalized label (rare; default false = returns the existing one with deduped:true)'),
  state: z.object({ next: z.string().optional(), gate: z.string().optional() }).optional().describe('Structured state (next step / gate) instead of label text'),
  links: z.object({ commit: z.string().optional(), deploy: z.string().optional(), release: z.string().optional(), url: z.string().optional() }).optional(),
  phase: z.enum(['todo', 'doing', 'built', 'deployed', 'verified']).optional(),
  tags: z.array(z.string()).optional(),
  note: z.string().optional().describe('Append-only timestamped note'),
});

export const RunTDDInput = z.object({
  description: z.string().describe('What the code should do'),
  testCode: z.string().describe('Test code'),
  implementationCode: z.string().describe('Implementation code'),
  testFilePath: z.string().describe('Path for test file'),
  implementationFilePath: z.string().describe('Path for implementation'),
  testTimeout: z.number().optional().describe('Timeout per test run in ms (default: 30000)'),
  autoFix: z.boolean().optional().describe('Whether to auto-fix lint issues'),
});

export const FindSymbolInput = z.object({
  symbolName: z.string().describe('Symbol name to find'),
  entryPoints: z.array(z.string()).describe('Entry points for search'),
  language: z
    .string()
    .optional()
    .describe(
      'Filter results to a single tree-sitter language ID (typescript, python, javascript, go, rust, ...). When omitted, all languages are returned.'
    ),
  cluster: z
    .string()
    .optional()
    .describe(
      'Phase 3: when a graph is configured, filter results to a specific cluster label (e.g. "auth/", "billing/"). Ignored when no graph is configured.'
    ),
});

export const IndexCodebaseInput = z.object({
  mode: z.enum(['incremental', 'full']).optional().describe('Indexing mode'),
  includeUncommitted: z.boolean().optional().describe('Include uncommitted changes (default: true)'),
  paths: z.array(z.string()).optional().describe('Specific paths to index'),
});

export const SummarizeCodebaseInput = z.object({
  scope: z.string().optional().describe('Directory scope to summarize'),
  depth: z.enum(['overview', 'detailed']).optional().describe('Summary depth'),
  focus: z.array(z.string()).optional().describe('Focus areas'),
  maxTokens: z.number().optional().describe('Maximum tokens for summary (default: 2000)'),
  cluster: z
    .string()
    .optional()
    .describe(
      'Phase 3: when a graph is configured, focus the summary on a single cluster label (e.g. "auth/"). Ignored when no graph is configured.'
    ),
});

export const OrchestrateAgentsInput = z.object({
  action: z.enum([
    'create_pool', 'remove_pool', 'submit_task', 'get_status',
    'execute_workflow', 'create_checkpoint', 'restore_checkpoint', 'shutdown',
  ]).describe('Orchestration action'),
  role: z.enum([
    'orchestrator', 'coder', 'reviewer', 'tester', 'documenter', 'analyst', 'debugger',
  ]).optional().describe('Agent role'),
  poolSpec: z.object({
    replicas: z.number().optional(),
    autoscaling: z.object({
      enabled: z.boolean(),
      minReplicas: z.number().optional(),
      maxReplicas: z.number().optional(),
    }).optional(),
  }).optional().describe('Pool specification'),
  task: z.object({
    description: z.string(),
    context: z.record(z.any()).optional(),
    files: z.array(z.string()).optional(),
  }).optional().describe('Task to submit'),
  workflowId: z.string().optional(),
  workflowInput: z.record(z.any()).optional(),
  executionId: z.string().optional(),
  checkpointId: z.string().optional(),
});

export const AutoFixInput = z.object({
  paths: z.array(z.string()).describe('Files to analyze and fix'),
  dryRun: z.boolean().optional().describe('Preview fixes without applying (default: true)'),
  maxFixes: z.number().optional().describe('Maximum fixes per iteration (default: 20)'),
  maxIterations: z.number().optional().describe('Maximum fix iterations (default: 5)'),
  confidence: z.enum(['high', 'medium', 'low']).optional().describe('Minimum confidence (default: high)'),
});

export const VaultValidateInput = z.object({
  path: z.string().describe('Absolute or relative path to the GVS vault root'),
  repoRoot: z.string().optional().describe('Repository root for resolving canonical paths (defaults to vault parent)'),
  skipCanonical: z.boolean().optional().describe('Skip canonical-path resolution (default: false)'),
  maxIssues: z.number().optional().describe('Max issues to return per severity (default: 50)'),
});

export const VaultIndexInput = z.object({
  path: z.string().describe('Absolute or relative path to the GVS vault root'),
  axis: z.enum(['identity', 'policy', 'roles', 'decision', 'memory', 'audit']).optional().describe('Limit index to a single axis'),
});

export const ContextBudgetInput = z.object({
  action: z.enum(['status', 'add', 'reset', 'configure']).describe('Action to perform'),
  category: z.enum(['code', 'summary', 'messages', 'other']).optional(),
  tokens: z.number().optional(),
  content: z.string().optional(),
  config: z.object({
    totalBudget: z.number().optional(),
    categoryBudgets: z.object({
      code: z.number().optional(),
      summary: z.number().optional(),
      messages: z.number().optional(),
      other: z.number().optional(),
    }).optional(),
    warningThreshold: z.number().optional(),
  }).optional(),
});

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'analyze_dependency',
    description: 'Analyze code dependencies and build import graph. Returns dependency tree, circular dependencies, and symbol locations.',
    inputSchema: {
      type: 'object',
      properties: {
        entryPoints: { type: 'array', items: { type: 'string' }, description: 'File paths to start analysis from' },
        maxDepth: { type: 'number', description: 'Maximum depth to traverse (default: 50)' },
        includeNodeModules: { type: 'boolean', description: 'Include node_modules imports (default: false)' },
      },
      required: ['entryPoints'],
    },
  },
  {
    name: 'validate_code',
    description: 'Run pre-flight validation checks (ESLint, TypeScript type checking) on code files. Returns truncated results for better UX.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: 'File paths to validate' },
        fix: { type: 'boolean', description: 'Attempt to auto-fix issues' },
        maxIssues: { type: 'number', description: 'Max issues to return per validator (default: 10)' },
      },
      required: ['paths'],
    },
  },
  {
    name: 'execute_sandbox',
    description: 'Execute a command in an isolated sandbox environment with timeout and resource limits.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to execute' },
        args: { type: 'array', items: { type: 'string' }, description: 'Command arguments' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
        workingDir: { type: 'string', description: 'Working directory for execution' },
      },
      required: ['command'],
    },
  },
  {
    name: 'manage_task',
    description: 'Create, update, or query tasks in the persistent task DAG. Supports caching tool outputs, reconciling closures from git Task-done: trailers (with commit evidence + audit), and flagging stale pending/running tasks. Lifecycle actions: close (proof required), archive (reason required), renew, merge (correlated tasks are merged, not duplicated), triage (dry-run), report. create compares with open tasks: score >= 0.80 returns the existing one (merged:true, note appended), 0.50-0.79 creates and returns related[]. Accepts id as alias of taskId.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'update', 'get', 'list', 'tree', 'clear', 'reconcile', 'stale', 'close', 'archive', 'renew', 'merge', 'triage', 'report'], description: 'Action to perform. Per-action help: batiste-direct manage_task <action> --help' },
        taskId: { type: 'string', description: 'Task ID (update/get/close/archive/renew). Alias: id' },
        sourceId: { type: 'string', description: 'merge: task absorbed and archived' },
        targetId: { type: 'string', description: 'merge: task that absorbs notes/links/tags/children' },
        label: { type: 'string', description: 'Task label (create); short title, max 120 chars' },
        parentId: { type: 'string', description: 'Parent task ID (for create subtask)' },
        status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed'], description: 'New status (update; completed needs proof/reason, or use close)' },
        toolOutput: { type: 'object', properties: { toolName: { type: 'string', description: 'optional, default "manual"' }, output: {} }, required: ['output'], description: 'Tool output to cache' },
        since: { type: 'string', description: 'reconcile: git revision lower bound; only commits after it are scanned (default: persisted marker / recent window)' },
        staleDays: { type: 'number', description: 'reconcile/stale/triage: days a pending task may sit untouched before being flagged stale (default 14; triage 60)' },
        runningStaleHours: { type: 'number', description: 'stale: hours a running task may go without update (default 48)' },
        proof: { type: 'string', description: 'close: evidence (commit sha, url, deploy id)' },
        reason: { type: 'string', description: 'archive/renew/reopen: why' },
        until: { type: 'string', description: 'renew: YYYY-MM-DD or +Nd' },
        reopen: { type: 'boolean', description: 'update: leave a terminal status (needs reason)' },
        confirm: { type: 'string', description: 'clear: "APAGAR <N> TAREFAS"; triage apply: "TRIAGE"' },
        apply: { type: 'boolean', description: 'triage: execute (default dry-run)' },
        minGroup: { type: 'number', description: 'triage: min open tasks per prefix to flag the group (default 5)' },
        olderThanDays: { type: 'number', description: 'list filter' },
        labelPrefix: { type: 'string', description: 'list filter' },
        limit: { type: 'number', description: 'list: max tasks' },
        compact: { type: 'boolean', description: 'list: omit context' },
        months: { type: 'number', description: 'report: months of history (default 6)' },
        dedupeKey: { type: 'string', description: 'create: idempotency key' },
        allowDuplicate: { type: 'boolean', description: 'create: allow an open task with the same normalized label (default false: returns existing, deduped:true)' },
        state: { type: 'object', properties: { next: { type: 'string' }, gate: { type: 'string' } }, description: 'Structured state; keep it out of the label' },
        links: { type: 'object', properties: { commit: { type: 'string' }, deploy: { type: 'string' }, release: { type: 'string' }, url: { type: 'string' } } },
        phase: { type: 'string', enum: ['todo', 'doing', 'built', 'deployed', 'verified'] },
        tags: { type: 'array', items: { type: 'string' } },
        note: { type: 'string', description: 'Append-only timestamped note' },
      },
      required: ['action'],
    },
  },
  {
    name: 'run_tdd',
    description: 'Execute a TDD cycle: verify test fails (RED), then passes with implementation (GREEN), validate code quality.',
    inputSchema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Description of the hypothesis' },
        testCode: { type: 'string', description: 'Test code to run' },
        implementationCode: { type: 'string', description: 'Implementation code' },
        testFilePath: { type: 'string', description: 'Path to write test file' },
        implementationFilePath: { type: 'string', description: 'Path to write implementation' },
        testTimeout: { type: 'number', description: 'Timeout per test run in ms (default: 30000)' },
        autoFix: { type: 'boolean', description: 'Whether to auto-fix lint issues' },
      },
      required: ['description', 'testCode', 'implementationCode', 'testFilePath', 'implementationFilePath'],
    },
  },
  {
    name: 'find_symbol',
    description: 'Find where a symbol (function, class, etc.) is defined and where it is called across the codebase. Uses LSP with TreeSitter fallback. Phase 2a: results can be filtered by tree-sitter language.',
    inputSchema: {
      type: 'object',
      properties: {
        symbolName: { type: 'string', description: 'Name of the symbol to find' },
        entryPoints: { type: 'array', items: { type: 'string' }, description: 'Entry points for building dependency graph' },
        language: { type: 'string', description: 'Optional tree-sitter language ID to filter results by (typescript, python, javascript, go, rust, ...)' },
        cluster: { type: 'string', description: 'Optional cluster label (Phase 3 graph-backed filter, e.g. "auth/")' },
      },
      required: ['symbolName', 'entryPoints'],
    },
  },
  {
    name: 'orchestrate_agents',
    description: 'Manage multi-agent workflows with specialized agents (Coder, Reviewer, Tester). Supports Kubernetes-style pool management.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create_pool', 'remove_pool', 'submit_task', 'get_status', 'execute_workflow', 'create_checkpoint', 'restore_checkpoint', 'shutdown'], description: 'Action to perform' },
        role: { type: 'string', enum: ['orchestrator', 'coder', 'reviewer', 'tester', 'documenter', 'analyst', 'debugger'], description: 'Agent role' },
        poolSpec: { type: 'object', properties: { replicas: { type: 'number' }, autoscaling: { type: 'object', properties: { enabled: { type: 'boolean' }, minReplicas: { type: 'number' }, maxReplicas: { type: 'number' } } } }, description: 'Pool specification' },
        task: { type: 'object', properties: { description: { type: 'string' }, context: { type: 'object' }, files: { type: 'array', items: { type: 'string' } } }, description: 'Task to submit' },
        workflowId: { type: 'string', description: 'Workflow ID' },
        workflowInput: { type: 'object', description: 'Workflow input' },
        executionId: { type: 'string', description: 'Execution ID' },
        checkpointId: { type: 'string', description: 'Checkpoint ID' },
      },
      required: ['action'],
    },
  },
  {
    name: 'index_codebase',
    description: 'Index or re-index the codebase for semantic search and analysis. Uses git-aware incremental indexing.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['incremental', 'full'], description: 'Indexing mode' },
        includeUncommitted: { type: 'boolean', description: 'Include uncommitted changes (default: true)' },
        paths: { type: 'array', items: { type: 'string' }, description: 'Specific paths to index' },
      },
      required: [],
    },
  },
  {
    name: 'summarize_codebase',
    description: 'Generate a compressed summary of the codebase for context injection.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', description: 'Directory scope to summarize' },
        depth: { type: 'string', enum: ['overview', 'detailed'], description: 'Summary depth' },
        focus: { type: 'array', items: { type: 'string' }, description: 'Focus areas' },
        maxTokens: { type: 'number', description: 'Maximum tokens for summary (default: 2000)' },
        cluster: { type: 'string', description: 'Optional cluster label to focus the summary on (Phase 3 graph-backed)' },
      },
      required: [],
    },
  },
  {
    name: 'auto_fix',
    description: 'Automatically detect and fix code issues (TypeScript errors, ESLint violations). Supports dry-run mode.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: 'File paths to analyze and fix' },
        dryRun: { type: 'boolean', description: 'Preview fixes without applying (default: true)' },
        maxFixes: { type: 'number', description: 'Maximum fixes per iteration (default: 20)' },
        maxIterations: { type: 'number', description: 'Maximum fix iterations (default: 5)' },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Minimum confidence (default: high)' },
      },
      required: ['paths'],
    },
  },
  {
    name: 'context_budget',
    description: 'Monitor and manage context token budget. Track usage across categories, get warnings and suggestions.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'add', 'reset', 'configure'], description: 'Action to perform' },
        category: { type: 'string', enum: ['code', 'summary', 'messages', 'other'], description: 'Token category' },
        tokens: { type: 'number', description: 'Number of tokens to add' },
        content: { type: 'string', description: 'Content to estimate tokens for' },
        config: { type: 'object', properties: { totalBudget: { type: 'number' }, categoryBudgets: { type: 'object', properties: { code: { type: 'number' }, summary: { type: 'number' }, messages: { type: 'number' }, other: { type: 'number' } } }, warningThreshold: { type: 'number' } }, description: 'Budget configuration' },
      },
      required: ['action'],
    },
  },
  {
    name: 'vault_validate',
    description: 'Validate a GVS 0.1 Governance Vault (see specs/gvs-0.1.md). Runs §10 rules — frontmatter completeness, axis consistency, wikilink resolution, canonical-path resolution, audit ref uniqueness, status consistency — and reports conformance with by-axis counts.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the vault root' },
        repoRoot: { type: 'string', description: 'Repo root for canonical path resolution' },
        skipCanonical: { type: 'boolean', description: 'Skip canonical path resolution (default: false)' },
        maxIssues: { type: 'number', description: 'Max issues to return per severity (default: 50)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'vault_index',
    description: 'Index a GVS 0.1 Governance Vault and return the note inventory grouped by axis (identity, policy, roles, decision, memory, audit). Each note carries its title, relative path, status, and outbound wikilinks — enabling downstream agents to reason over the governance graph.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the vault root' },
        axis: { type: 'string', enum: ['identity', 'policy', 'roles', 'decision', 'memory', 'audit'], description: 'Limit index to a single axis' },
      },
      required: ['path'],
    },
  },
];

export type ToolName =
  | 'analyze_dependency'
  | 'validate_code'
  | 'execute_sandbox'
  | 'manage_task'
  | 'run_tdd'
  | 'find_symbol'
  | 'orchestrate_agents'
  | 'index_codebase'
  | 'summarize_codebase'
  | 'auto_fix'
  | 'context_budget'
  | 'vault_validate'
  | 'vault_index';
