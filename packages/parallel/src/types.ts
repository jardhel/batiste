/**
 * Public type definitions for @batiste-aidk/parallel.
 *
 * The package models work as a DAG of `Operation`s. Operations are added
 * to a `Plan` and addressed via opaque `OperationHandle`s; the handle is
 * the dependency edge token (caller never reaches inside).
 *
 * v1.4 keeps everything Promise-based and single-process. v1.4.1 will
 * introduce `worker_threads` workers behind the same `Operation.fn`
 * boundary, so user code does not change.
 */

/** Opaque handle returned by `Plan.add()`; used to declare dependencies. */
export interface OperationHandle {
  readonly __brand: 'OperationHandle';
  readonly id: string;
  readonly name: string;
}

/** Context passed into an Operation's `fn`. */
export interface OperationContext {
  /** Resolved results of upstream deps, in the same order they were declared. */
  readonly deps: unknown[];
}

/** A unit of work in the DAG. */
export interface Operation<T = unknown> {
  readonly id: string;
  readonly name: string;
  readonly deps: OperationHandle[];
  readonly fn: (ctx: OperationContext) => Promise<T>;
  /** Relative cost hint for the scheduler (default 1). */
  readonly weight: number;
  /** Optional grouping for per-tag concurrency pools (e.g. "io-bound", "llm-bound"). */
  readonly tag?: string;
}

/** Optional knobs accepted by `Plan.add(name, opts, fn)`. */
export interface AddOptions {
  deps?: OperationHandle[];
  weight?: number;
  tag?: string;
}

/** Per-tag concurrency override map. */
export interface ConcurrencyByTag {
  [tag: string]: number | 'auto';
}

export interface ExecutorOptions {
  /** Global concurrency cap. `'auto'` = `max(1, floor(cpus/2))`. */
  concurrency?: number | 'auto';
  /** Optional per-tag pool. Tagged ops also count against the global cap. */
  concurrencyByTag?: ConcurrencyByTag;
  /** Called for each op start AND end — emit to your audit ledger here. */
  onLineage?: (entry: LineageEntry) => void;
}

/** Phase of a lineage event. Both phases share the op's `id`. */
export type LineagePhase = 'start' | 'end';

/** A single lineage event. `phase: 'start'` is emitted before `fn`; `'end'` after. */
export interface LineageEntry {
  /** Stable per-op uuid (same value for the matching start/end pair). */
  id: string;
  name: string;
  phase: LineagePhase;
  startedAt: string;
  /** Only populated on `phase: 'end'`. */
  endedAt?: string;
  /** Only populated on `phase: 'end'`. */
  durationMs?: number;
  /** Only populated on `phase: 'end'`. */
  result?: 'success' | 'error';
  error?: { message: string };
  tag?: string;
}

export interface RunResult {
  /** Map keyed by `OperationHandle` for O(1) lookup by reference. */
  results: Map<OperationHandle, unknown>;
  /** Full ordered log of every start/end event. */
  lineage: LineageEntry[];
}

/** Thrown by `Plan.toposort()` when the DAG contains a cycle. */
export class CycleError extends Error {
  constructor(
    message: string,
    public readonly edge: { from: string; to: string },
  ) {
    super(message);
    this.name = 'CycleError';
  }
}
