/**
 * Task types and interfaces for @batiste-aidk/core
 */

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Task {
  id: string;
  parentId?: string;
  label: string;
  status: TaskStatus;
  context: TaskContext;
}

export interface TaskContext {
  toolOutputs?: Record<string, ToolOutputCache>;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ToolOutputCache {
  output: unknown;
  cachedAt: number;
}

/**
 * Task node for hierarchical tree view
 */
export interface TaskNode {
  task: Task;
  children: TaskNode[];
}

/**
 * Interface for task persistence
 */
export interface ITaskStore {
  /** Save or update a task */
  save(task: Task): Promise<void>;

  /** Get a task by ID */
  get(id: string): Promise<Task | null>;

  /** Get all child tasks of a parent */
  getChildren(parentId: string): Promise<Task[]>;

  /** Get all tasks in the store */
  getAll(): Promise<Task[]>;

  /** Get all root tasks (tasks with no parent) */
  getRoots(): Promise<Task[]>;

  /** Delete a task by ID */
  delete(id: string): Promise<void>;

  /** Delete all tasks from the store */
  clearAll(): Promise<void>;

  /** Close the store connection */
  close(): void;
}
