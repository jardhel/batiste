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
  /**
   * Unix epoch seconds of the last write to this task. Populated by the
   * store on read (the SQLite schema tracks it via `strftime`). Optional
   * because in-memory or partially-hydrated tasks may not carry it; the
   * stale-check treats a missing value as "unknown age" and skips it.
   */
  updatedAt?: number;
  /**
   * Unix epoch seconds of task creation. Same provenance as `updatedAt`.
   */
  createdAt?: number;
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
 * A single task closed by git reconciliation, with the commit that proved it.
 */
export interface ReconciledClosure {
  taskId: string;
  label: string;
  /** The `Task-done:` value as written in the trailer (id or label). */
  matchedBy: string;
  /** Full SHA of the commit carrying the trailer — the evidence. */
  sha: string;
}

/**
 * A pending task flagged as stale (untouched for longer than the threshold).
 * Reconciliation NEVER closes these — an honest board signals, it does not
 * fabricate completion without commit evidence.
 */
export interface StaleFlag {
  taskId: string;
  label: string;
  /** Unix epoch seconds of the last update (the moment it went stale-from). */
  staleSince: number;
  /** Whole days since the last update at the time of the check. */
  ageDays: number;
}

/**
 * Result of {@link TaskReconciler.reconcileFromGit}.
 */
export interface ReconcileResult {
  /** Tasks closed in this run because a commit trailer matched them. */
  closed: ReconciledClosure[];
  /**
   * `Task-done:` trailers found in git that matched NO open board task —
   * surfaced (not an error) so a human can spot typos or already-closed work.
   */
  unmatched: { matchedBy: string; sha: string }[];
  /** Pending tasks flagged stale by the same pass (informational only). */
  stale: StaleFlag[];
  /** The newest commit SHA reconciled, persisted for idempotent re-runs. */
  lastSha: string | null;
  /** How many commits were inspected in this pass. */
  commitsScanned: number;
}

/**
 * Result of {@link TaskReconciler.staleCheck} when run on its own.
 */
export interface StaleCheckResult {
  stale: StaleFlag[];
  thresholdDays: number;
}

/**
 * Narrow sink for recording a reconciliation closure as audit evidence.
 *
 * `@batiste-aidk/core` must NOT depend on `@batiste-aidk/audit` (audit
 * already depends on core — the reverse would be a cycle). So the audit
 * write is inverted: the reconciler accepts this callback and the wiring
 * package (`@batiste-aidk/code`) injects an implementation backed by the
 * real `EventLog`/`TaskLog`. When absent, reconciliation still runs and
 * still closes tasks — it just emits no audit trail.
 */
export interface ReconcileAuditSink {
  recordClosure(evidence: {
    taskId: string;
    label: string;
    commitSha: string;
    matchedBy: string;
  }): void | Promise<void>;
}

/**
 * Persistence for the reconciliation high-water mark (last reconciled SHA).
 * Kept separate from {@link ITaskStore} so reconciliation state can live in
 * its own file under DATA_DIR without widening the task store contract.
 */
export interface IReconcileMarkerStore {
  /** Read the last reconciled commit SHA, or null if never reconciled. */
  getLastSha(): string | null;
  /** Persist the last reconciled commit SHA. */
  setLastSha(sha: string): void;
  /** Release any underlying resources. */
  close(): void;
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
