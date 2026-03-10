/**
 * MCP Tool Definitions for @batiste/code
 *
 * Defines all available tools and their input schemas.
 */

import { z } from 'zod';
import type { ToolDefinition } from '@batiste/core/mcp';

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
  action: z.enum(['create', 'update', 'get', 'list', 'tree', 'clear']).describe('Task action'),
  taskId: z.string().optional().describe('Task ID for update/get'),
  label: z.string().optional().describe('Task label for create'),
  parentId: z.string().optional().describe('Parent task ID'),
  status: z.enum(['pending', 'running', 'completed', 'failed']).optional(),
  toolOutput: z.object({
    toolName: z.string(),
    output: z.any(),
  }).optional().describe('Cache tool output'),
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
    description: 'Create, update, or query tasks in the persistent task DAG. Supports caching tool outputs to prevent duplicate work.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'update', 'get', 'list', 'tree', 'clear'], description: 'Action to perform' },
        taskId: { type: 'string', description: 'Task ID (for update/get)' },
        label: { type: 'string', description: 'Task label (for create)' },
        parentId: { type: 'string', description: 'Parent task ID (for create subtask)' },
        status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed'], description: 'New status (for update)' },
        toolOutput: { type: 'object', properties: { toolName: { type: 'string' }, output: {} }, description: 'Tool output to cache' },
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
    description: 'Find where a symbol (function, class, etc.) is defined and where it is called across the codebase. Uses LSP with TreeSitter fallback.',
    inputSchema: {
      type: 'object',
      properties: {
        symbolName: { type: 'string', description: 'Name of the symbol to find' },
        entryPoints: { type: 'array', items: { type: 'string' }, description: 'Entry points for building dependency graph' },
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
  | 'context_budget';
