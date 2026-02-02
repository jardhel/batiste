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

// Agent types (placeholder - will be expanded)
export * from './agents/index.js';
