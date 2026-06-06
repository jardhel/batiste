/**
 * Tiny concurrency limiter — zero-dep `pLimit` for v1.3.1.
 *
 * @deprecated v1.4 — Atrium ingest + compile call-sites have moved to
 * `@batiste-aidk/parallel` (`Plan` + `Executor`) so every run produces a
 * queryable `LineageEntry` trace in the audit ledger via
 * `utils/parallel-bridge.ts`. New call-sites must use `buildAtriumExecutor`
 * instead. This helper is kept ONLY for back-compat with any out-of-tree
 * caller; it will be removed once the ecosystem migrates. Do not use in
 * new code. See ADR-0002 for the lineage-as-audit rationale.
 *
 * Original notes (still accurate):
 *   - At most `concurrency` `fn`s run at once.
 *   - Wrapped fns start in the order they are scheduled (FIFO over waits).
 *   - Errors from a wrapped fn reject the returned promise; the slot is
 *     released and the next queued task starts. Other in-flight tasks are
 *     NOT cancelled — the caller decides whether to abort the whole loop
 *     by tracking errors from the returned promises (e.g. `Promise.all`).
 */

/** @deprecated Use `buildAtriumExecutor` from `utils/parallel-bridge.ts`. */
export type Limited = <T>(fn: () => Promise<T>) => Promise<T>;

interface PendingTask {
  run: () => void;
}

/**
 * Build a concurrency-bounded scheduler.
 *
 * @deprecated v1.4 — see file header. Use `buildAtriumExecutor` from
 * `utils/parallel-bridge.ts` instead so each scheduled unit emits a
 * `LineageEntry` to the deployment audit ledger.
 *
 * @param concurrency  Max parallel in-flight tasks. Coerced to `>= 1`. A
 *                     value of `1` is equivalent to fully sequential
 *                     execution (and is the safe fallback if a caller
 *                     passes `0`, `NaN`, or a negative number).
 */
export function pLimit(concurrency: number): Limited {
  const limit = Math.max(1, Math.floor(Number.isFinite(concurrency) ? concurrency : 1));
  let active = 0;
  const queue: PendingTask[] = [];

  const next = (): void => {
    if (active >= limit) return;
    const task = queue.shift();
    if (!task) return;
    active++;
    task.run();
  };

  return <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const run = (): void => {
        // Defensive: if `fn` throws synchronously, still treat it as a
        // rejected promise so the slot is released exactly once.
        Promise.resolve()
          .then(fn)
          .then(
            (value) => {
              active--;
              resolve(value);
              next();
            },
            (err: unknown) => {
              active--;
              reject(err instanceof Error ? err : new Error(String(err)));
              next();
            },
          );
      };
      queue.push({ run });
      next();
    });
  };
}
