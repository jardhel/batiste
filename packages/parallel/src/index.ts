/**
 * @batiste-aidk/parallel — public surface.
 *
 * Spark-inspired DAG executor. Build a `Plan`, hand it to an `Executor`,
 * get back `{ results, lineage }`. See README.md for the philosophy and
 * the v1.4 / v1.4.1 split (Promise pool now, worker_threads next).
 */

export { Plan } from './plan.js';
export { Executor } from './executor.js';
export { LineageRecorder } from './lineage.js';
export {
  getCpuConcurrency,
  getRpmLimit,
  getAvailableMemoryBytes,
  rpmToConcurrency,
  type AnthropicTier,
  type AnthropicModel,
} from './limits.js';
export {
  CycleError,
  type AddOptions,
  type ConcurrencyByTag,
  type ExecutorOptions,
  type LineageEntry,
  type LineagePhase,
  type Operation,
  type OperationContext,
  type OperationHandle,
  type RunResult,
} from './types.js';
