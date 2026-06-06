/**
 * Executor — runs a `Plan` with concurrency caps + per-tag pools.
 *
 * Design:
 *   - Topologically sort the Plan once up-front (cycle check happens here).
 *   - Maintain a ready queue of ops whose deps have all resolved.
 *   - A scheduler loop dispatches ops while two conditions hold:
 *         (1) global in-flight < global concurrency,
 *         (2) tag in-flight < tag concurrency (if a per-tag cap exists).
 *   - When an op finishes, its dependents have their pending-dep counter
 *     decremented; when it hits zero, the dependent enters the ready queue.
 *   - On error: the op is recorded as failed; its transitive dependents
 *     are flushed as `skip` (synthetic error lineage). Independent
 *     branches keep running. `run()` always resolves; the caller inspects
 *     the lineage to decide what to do.
 *
 * Backpressure is implicit — when the global cap is full we just don't
 * pull from the ready queue; the loop wakes up via the `wakeup` Promise
 * each time an op completes. No setInterval, no busy-wait.
 *
 * v1.4.1 will swap the body of `runOp` for a `worker_threads` pool dispatch
 * for tag === 'cpu-bound', leaving the rest of this scheduler untouched.
 */

import type { Plan } from './plan.js';
import { LineageRecorder } from './lineage.js';
import { getCpuConcurrency, getRpmLimit, rpmToConcurrency } from './limits.js';
import type {
  ExecutorOptions,
  Operation,
  OperationHandle,
  RunResult,
} from './types.js';

export class Executor {
  constructor(private readonly opts: ExecutorOptions = {}) {}

  async run(plan: Plan): Promise<RunResult> {
    const order = plan.toposort(); // throws CycleError on cycles
    const ops = plan.operations();

    const globalCap = this.resolveGlobalCap();
    const tagCaps = this.resolveTagCaps();

    const recorder = new LineageRecorder(this.opts.onLineage);
    const results = new Map<OperationHandle, unknown>();
    const handleById = new Map<string, OperationHandle>();
    const resultById = new Map<string, unknown>();
    const failed = new Set<string>(); // op ids that errored OR were skipped
    const failureReason = new Map<string, string>(); // id -> the original failed op's name

    // Pre-compute pending-dep counters and dependents adjacency.
    const pending = new Map<string, number>();
    const dependents = new Map<string, string[]>();
    for (const id of order) {
      const op = ops.get(id)!;
      pending.set(id, op.deps.length);
      handleById.set(id, plan.handleOf(id)!);
      for (const dep of op.deps) {
        const list = dependents.get(dep.id) ?? [];
        list.push(id);
        dependents.set(dep.id, list);
      }
    }

    const ready: string[] = order.filter((id) => (pending.get(id) ?? 0) === 0);

    let globalInFlight = 0;
    const tagInFlight = new Map<string, number>();
    let wakeup: () => void = () => {};
    let wakeupPromise = new Promise<void>((r) => (wakeup = r));
    const wake = () => {
      const w = wakeup;
      wakeupPromise = new Promise<void>((r) => (wakeup = r));
      w();
    };

    let pendingCount = order.length; // how many ops still owe an end-state
    const inFlight: Promise<void>[] = [];

    const tagOf = (op: Operation): string | undefined => op.tag;
    const tagCapFor = (tag: string | undefined): number | undefined =>
      tag !== undefined ? tagCaps.get(tag) : undefined;

    const canDispatch = (op: Operation): boolean => {
      if (globalInFlight >= globalCap) return false;
      const cap = tagCapFor(tagOf(op));
      if (cap !== undefined && (tagInFlight.get(op.tag!) ?? 0) >= cap) return false;
      return true;
    };

    /** Cascade a failure to all transitive dependents. */
    const cascadeSkip = (originId: string, originName: string): void => {
      const stack = [...(dependents.get(originId) ?? [])];
      while (stack.length > 0) {
        const id = stack.pop()!;
        if (failed.has(id)) continue;
        failed.add(id);
        const op = ops.get(id)!;
        recorder.skip(op.name, op.tag, originName);
        pendingCount--;
        for (const next of dependents.get(id) ?? []) stack.push(next);
      }
    };

    const runOp = async (op: Operation): Promise<void> => {
      // If any dep failed, skip transitively. We test deps here (rather
      // than only in the cascade) so ops whose deps failed BEFORE they
      // became ready still get the synthetic skip.
      const failedDep = op.deps.find((d) => failed.has(d.id));
      if (failedDep) {
        if (!failed.has(op.id)) {
          failed.add(op.id);
          recorder.skip(op.name, op.tag, failureReason.get(failedDep.id) ?? failedDep.name);
          pendingCount--;
          cascadeSkip(op.id, failureReason.get(failedDep.id) ?? failedDep.name);
        }
        return;
      }

      const tag = tagOf(op);
      globalInFlight++;
      if (tag !== undefined) tagInFlight.set(tag, (tagInFlight.get(tag) ?? 0) + 1);

      const { id: lineageId, startedAt, t0 } = recorder.start(op.name, tag);
      try {
        const depResults = op.deps.map((d) => resultById.get(d.id));
        const value = await op.fn({ deps: depResults });
        resultById.set(op.id, value);
        results.set(handleById.get(op.id)!, value);
        recorder.end({ id: lineageId, name: op.name, startedAt, t0, tag, result: 'success' });
        pendingCount--;
        // Release dependents.
        for (const childId of dependents.get(op.id) ?? []) {
          const left = (pending.get(childId) ?? 1) - 1;
          pending.set(childId, left);
          if (left === 0 && !failed.has(childId)) ready.push(childId);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        failed.add(op.id);
        failureReason.set(op.id, op.name);
        recorder.end({
          id: lineageId,
          name: op.name,
          startedAt,
          t0,
          tag,
          result: 'error',
          error: { message },
        });
        pendingCount--;
        cascadeSkip(op.id, op.name);
      } finally {
        globalInFlight--;
        if (tag !== undefined) tagInFlight.set(tag, (tagInFlight.get(tag) ?? 1) - 1);
        wake();
      }
    };

    // Scheduler loop.
    while (pendingCount > 0) {
      // Drain ready queue while caps allow.
      let dispatched = false;
      for (let i = 0; i < ready.length; ) {
        const id = ready[i]!;
        if (failed.has(id)) {
          ready.splice(i, 1);
          continue;
        }
        const op = ops.get(id)!;
        if (!canDispatch(op)) {
          i++;
          continue;
        }
        ready.splice(i, 1);
        dispatched = true;
        const p = runOp(op);
        inFlight.push(p);
        // Don't keep finished promises in `inFlight` — let them GC.
        p.finally(() => {
          const idx = inFlight.indexOf(p);
          if (idx >= 0) inFlight.splice(idx, 1);
        });
      }
      if (pendingCount === 0) break;
      if (!dispatched) {
        // Either everything is in-flight (wait for wakeup) or there's a
        // ready op blocked by tag/global cap (also waits for wakeup).
        if (inFlight.length === 0 && ready.length === 0) {
          // Nothing to do and nothing in flight — should not happen unless
          // the toposort missed something. Bail to avoid a hang.
          break;
        }
        await wakeupPromise;
      }
    }

    // Drain anything still in-flight (cascade-skips can complete synchronously
    // so this is usually a no-op).
    await Promise.all(inFlight);

    return { results, lineage: recorder.entries };
  }

  private resolveGlobalCap(): number {
    const c = this.opts.concurrency ?? 'auto';
    if (c === 'auto') return getCpuConcurrency();
    if (!Number.isFinite(c) || c < 1) return 1;
    return Math.floor(c);
  }

  private resolveTagCaps(): Map<string, number> {
    const out = new Map<string, number>();
    const m = this.opts.concurrencyByTag;
    if (!m) return out;
    for (const [tag, val] of Object.entries(m)) {
      if (val === 'auto') {
        // 'auto' for llm-bound: derive from ANTHROPIC_TIER (sonnet baseline).
        if (tag === 'llm-bound') {
          const c = rpmToConcurrency(getRpmLimit('sonnet'));
          if (c != null) out.set(tag, c);
          continue;
        }
        out.set(tag, getCpuConcurrency());
        continue;
      }
      if (Number.isFinite(val) && val >= 1) out.set(tag, Math.floor(val));
    }
    return out;
  }
}
