/**
 * @batiste/core
 *
 * Core infrastructure for Batiste AI tools.
 * Like a well-organized kitchen - everything in its place.
 */

// Task Management
export {
  TaskManager,
  SQLiteTaskStore,
  type Task,
  type TaskStatus,
  type TaskNode,
  type TaskContext,
  type ToolOutputCache,
  type ITaskStore,
} from './tasks/index.js';

// Context Budget
export {
  ContextBudgetMonitor,
  type BudgetCategory,
  type BudgetConfig,
  type BudgetStatus,
} from './context/index.js';

// Agent Orchestration
export * from './agents/index.js';

// MCP Server Factory
export {
  createMcpServer,
  startMcpServer,
  type ToolDefinition,
  type ToolHandler,
  type McpServerConfig,
} from './mcp/index.js';

// Sandbox
export {
  ProcessSandbox,
  type ISandbox,
  type ISandboxFactory,
  type SandboxCreateOptions,
  type SandboxStatus,
  type ExecutionOptions,
  type ExecutionResult,
} from './sandbox/index.js';
