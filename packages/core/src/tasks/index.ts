/**
 * Task Management Module
 *
 * Persistent task DAG with SQLite backing.
 * Like a prep list that survives kitchen fires.
 */

export * from './types.js';
export { TaskManager } from './TaskManager.js';
export { SQLiteTaskStore } from './SQLiteTaskStore.js';
export { SQLiteReconcileMarkerStore } from './SQLiteReconcileMarkerStore.js';
export {
  TaskReconciler,
  extractTaskDoneTrailers,
  TASK_DONE_TRAILER,
  type ReconcileOptions,
  type StaleCheckOptions,
} from './TaskReconciler.js';
