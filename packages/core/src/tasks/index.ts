/**
 * Task Management Module
 *
 * Persistent task DAG with SQLite backing.
 * Like a prep list that survives kitchen fires.
 */

export * from './types.js';
export { TaskManager } from './TaskManager.js';
export { SQLiteTaskStore } from './SQLiteTaskStore.js';
