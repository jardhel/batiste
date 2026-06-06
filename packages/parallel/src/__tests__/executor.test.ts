import { describe, expect, it } from 'vitest';
import { Plan } from '../plan.js';
import { Executor } from '../executor.js';
import type { LineageEntry } from '../types.js';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('Executor', () => {
  it('runs a 5-op chain sequentially at concurrency 1, in order', async () => {
    const plan = new Plan();
    const log: string[] = [];
    let prev = plan.add('s1', async () => {
      log.push('s1');
      return 1;
    });
    for (let i = 2; i <= 5; i++) {
      const name = `s${i}`;
      const dep = prev;
      prev = plan.add(name, { deps: [dep] }, async () => {
        log.push(name);
        return i;
      });
    }
    const exec = new Executor({ concurrency: 1 });
    const { results, lineage } = await exec.run(plan);

    expect(log).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(results.size).toBe(5);
    const ends = lineage.filter((e) => e.phase === 'end');
    expect(ends).toHaveLength(5);
    expect(ends.every((e) => e.result === 'success')).toBe(true);
  });

  it('overlaps execution at concurrency 5 (>=2 ops in flight at once)', async () => {
    // Five INDEPENDENT ops so they're all immediately ready.
    const plan = new Plan();
    let inFlight = 0;
    let peak = 0;
    for (let i = 0; i < 5; i++) {
      plan.add(`p${i}`, async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await sleep(40);
        inFlight--;
        return i;
      });
    }
    const exec = new Executor({ concurrency: 5 });
    const t0 = Date.now();
    const { results } = await exec.run(plan);
    const elapsed = Date.now() - t0;

    expect(results.size).toBe(5);
    expect(peak).toBeGreaterThanOrEqual(2);
    // Sequential would be ~200ms; parallel should be well under 150ms.
    expect(elapsed).toBeLessThan(150);
  });

  it('skips downstream of a failed op with the right error message; unrelated branches still complete', async () => {
    const plan = new Plan();
    // Branch A: a -> b (a throws, b should be skipped)
    const a = plan.add('a', async () => {
      throw new Error('boom');
    });
    const b = plan.add('b', { deps: [a] }, async () => 'b-ran');
    const c = plan.add('c', { deps: [b] }, async () => 'c-ran');

    // Branch B (independent): x -> y, both should succeed.
    const x = plan.add('x', async () => 'x-ran');
    const y = plan.add('y', { deps: [x] }, async () => 'y-ran');

    const events: LineageEntry[] = [];
    const exec = new Executor({ concurrency: 4, onLineage: (e) => events.push(e) });
    const { results, lineage } = await exec.run(plan);

    // Failed branch.
    expect(results.has(a)).toBe(false);
    expect(results.has(b)).toBe(false);
    expect(results.has(c)).toBe(false);

    // Independent branch.
    expect(results.get(x)).toBe('x-ran');
    expect(results.get(y)).toBe('y-ran');

    // Lineage shape.
    const endsByName = new Map(
      lineage.filter((e) => e.phase === 'end').map((e) => [e.name, e]),
    );
    expect(endsByName.get('a')!.result).toBe('error');
    expect(endsByName.get('a')!.error?.message).toBe('boom');
    expect(endsByName.get('b')!.result).toBe('error');
    expect(endsByName.get('b')!.error?.message).toBe('upstream failed: a');
    expect(endsByName.get('c')!.result).toBe('error');
    expect(endsByName.get('c')!.error?.message).toBe('upstream failed: a');
    expect(endsByName.get('x')!.result).toBe('success');
    expect(endsByName.get('y')!.result).toBe('success');

    // The onLineage sink should have seen the same set.
    expect(events.length).toBe(lineage.length);
  });

  it('respects per-tag concurrency caps', async () => {
    const plan = new Plan();
    let llmInFlight = 0;
    let llmPeak = 0;
    for (let i = 0; i < 6; i++) {
      plan.add(`llm-${i}`, { tag: 'llm-bound' }, async () => {
        llmInFlight++;
        llmPeak = Math.max(llmPeak, llmInFlight);
        await sleep(30);
        llmInFlight--;
        return i;
      });
    }
    const exec = new Executor({
      concurrency: 16,
      concurrencyByTag: { 'llm-bound': 2 },
    });
    await exec.run(plan);
    expect(llmPeak).toBeLessThanOrEqual(2);
  });
});
