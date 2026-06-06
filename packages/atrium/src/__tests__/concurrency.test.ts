/**
 * Unit tests for `pLimit`. These cover the three properties the
 * ingest/compile loops actually rely on:
 *
 *   1. Never more than N concurrent tasks in flight.
 *   2. FIFO ordering: tasks start in the order they are scheduled (we don't
 *      depend on completion order, but start-order matters because the
 *      checkpoint-update path expects deterministic line traversal).
 *   3. A failed task releases its slot so the queue keeps draining.
 */

import { describe, expect, it } from 'vitest';
import { pLimit } from '../utils/concurrency.js';

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('pLimit', () => {
  it('never exceeds N concurrent tasks', async () => {
    const limit = pLimit(3);
    let inFlight = 0;
    let peak = 0;

    const tasks = Array.from({ length: 20 }, (_, i) =>
      limit(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        // Vary the work so tasks complete out-of-order — peak must still
        // be bounded by the limit.
        await new Promise((r) => setTimeout(r, (i % 5) * 2));
        inFlight--;
        return i;
      }),
    );

    const results = await Promise.all(tasks);
    expect(results).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThanOrEqual(2); // sanity: not accidentally serial
  });

  it('starts queued tasks in FIFO order', async () => {
    const limit = pLimit(1);
    const startOrder: number[] = [];
    const tasks: Promise<number>[] = [];

    for (let i = 0; i < 5; i++) {
      tasks.push(
        limit(async () => {
          startOrder.push(i);
          await new Promise((r) => setTimeout(r, 1));
          return i;
        }),
      );
    }

    await Promise.all(tasks);
    expect(startOrder).toEqual([0, 1, 2, 3, 4]);
  });

  it('propagates errors and keeps draining the queue', async () => {
    const limit = pLimit(2);
    const completed: number[] = [];

    const failing = limit(async () => {
      throw new Error('boom');
    });
    const after = Array.from({ length: 4 }, (_, i) =>
      limit(async () => {
        await new Promise((r) => setTimeout(r, 1));
        completed.push(i);
        return i;
      }),
    );

    await expect(failing).rejects.toThrow('boom');
    const results = await Promise.all(after);
    expect(results).toEqual([0, 1, 2, 3]);
    expect(completed).toHaveLength(4);
  });

  it('coerces invalid concurrency to >= 1', async () => {
    for (const bad of [0, -3, Number.NaN, 0.4]) {
      const limit = pLimit(bad);
      const d1 = deferred<number>();
      const d2 = deferred<number>();
      let started2 = false;

      const p1 = limit(() => d1.promise);
      const p2 = limit(() => {
        started2 = true;
        return d2.promise;
      });

      // Yield once so any synchronous scheduling settles.
      await new Promise((r) => setImmediate(r));
      expect(started2).toBe(false);

      d1.resolve(1);
      d2.resolve(2);
      await Promise.all([p1, p2]);
    }
  });

  it('runs tasks in parallel when concurrency >= count', async () => {
    const limit = pLimit(10);
    const start = Date.now();
    const tasks = Array.from({ length: 5 }, () =>
      limit(async () => {
        await new Promise((r) => setTimeout(r, 30));
      }),
    );
    await Promise.all(tasks);
    const elapsed = Date.now() - start;
    // Five 30 ms tasks in serial = 150 ms; in parallel = ~30-60 ms.
    expect(elapsed).toBeLessThan(120);
  });
});
