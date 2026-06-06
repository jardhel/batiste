/**
 * Unit tests for `buildAtriumExecutor`.
 *
 * The bridge has one job: every `LineageEntry` the executor emits must
 * land in the supplied `AuditLedger` as an `AuditEntry` row. These tests
 * use an in-memory fake ledger (any object exposing `append`) to avoid
 * spinning up SQLite. Shape assertions cross-check against
 * `lineageToAuditEntry` so a future audit-schema change has to update
 * both sides in lockstep.
 */

import { describe, expect, it } from 'vitest';
import type { AuditEntry, AuditLedger } from '@batiste-aidk/audit';
import { Plan } from '@batiste-aidk/parallel';
import { buildAtriumExecutor, lineageToAuditEntry } from '../utils/parallel-bridge.js';

/**
 * Minimal in-memory ledger fake. We only need `append`; the rest of the
 * `AuditLedger` API is unused by the bridge.
 */
function makeFakeLedger(): { ledger: AuditLedger; entries: AuditEntry[] } {
  const entries: AuditEntry[] = [];
  const fake = {
    append(entry: AuditEntry): void {
      entries.push(entry);
    },
  };
  return { ledger: fake as unknown as AuditLedger, entries };
}

describe('buildAtriumExecutor', () => {
  it('emits start+end ledger rows for every successful op', async () => {
    const { ledger, entries } = makeFakeLedger();
    const executor = buildAtriumExecutor({
      concurrency: 2,
      ledger,
      sessionId: 'test-session',
      agentId: 'test-agent',
    });
    const plan = new Plan();
    plan.add('alpha', { tag: 'io-bound' }, async () => 'a');
    plan.add('beta', { tag: 'io-bound' }, async () => 'b');

    const { lineage } = await executor.run(plan);

    // 2 ops × 2 phases = 4 lineage events = 4 ledger rows.
    expect(lineage).toHaveLength(4);
    expect(entries).toHaveLength(4);
    for (const row of entries) {
      expect(row.tool).toBe('parallel.op');
      expect(row.sessionId).toBe('test-session');
      expect(row.agentId).toBe('test-agent');
      expect(row.result).toBe('success');
      expect(typeof row.id).toBe('string');
      expect(row.id.length).toBeGreaterThan(0);
    }
    const names = entries.map((e) => (e.args as { name: string }).name).sort();
    expect(names).toEqual(['alpha', 'alpha', 'beta', 'beta']);
  });

  it('records exactly 3 ledger pairs for a 3-op plan with one thrower', async () => {
    const { ledger, entries } = makeFakeLedger();
    const executor = buildAtriumExecutor({
      concurrency: 1,
      ledger,
      sessionId: 's1',
      agentId: 'a1',
    });
    const plan = new Plan();
    plan.add('ok-1', async () => 1);
    plan.add('boom', async () => {
      throw new Error('kaboom');
    });
    plan.add('ok-2', async () => 2);

    const { lineage } = await executor.run(plan);

    // 3 successful starts + 3 ends = 6 ledger rows. (No upstream skips
    // because the three ops are independent — failure does not cascade.)
    expect(lineage).toHaveLength(6);
    expect(entries).toHaveLength(6);

    const ends = entries.filter((e) => (e.args as { phase: string }).phase === 'end');
    expect(ends).toHaveLength(3);
    const errEnd = ends.find((e) => (e.args as { name: string }).name === 'boom');
    expect(errEnd).toBeDefined();
    expect(errEnd?.result).toBe('error');
    expect((errEnd?.args as { error?: { message: string } }).error?.message).toBe('kaboom');

    const okEnds = ends.filter((e) => (e.args as { name: string }).name !== 'boom');
    for (const e of okEnds) {
      expect(e.result).toBe('success');
    }
  });

  it('stamps tag, durationMs, and a fresh uuid on every row', async () => {
    const { ledger, entries } = makeFakeLedger();
    const executor = buildAtriumExecutor({
      concurrency: 1,
      ledger,
      sessionId: 's',
      agentId: 'a',
    });
    const plan = new Plan();
    plan.add('measured', { tag: 'cpu-bound' }, async () => {
      // Tiny but nonzero so the end-row durationMs >= 0.
      await new Promise((r) => setTimeout(r, 5));
    });

    await executor.run(plan);

    expect(entries).toHaveLength(2);
    const [start, end] = entries;
    expect((start!.args as { tag: string }).tag).toBe('cpu-bound');
    expect((end!.args as { tag: string }).tag).toBe('cpu-bound');
    expect(end!.durationMs).toBeGreaterThanOrEqual(0);
    // Audit row IDs are unique even though both share the same logical
    // lineage id under the hood.
    expect(start!.id).not.toBe(end!.id);
  });

  it('handles ledger=undefined without throwing; in-memory lineage still populated', async () => {
    const executor = buildAtriumExecutor({
      concurrency: 2,
      // ledger intentionally omitted
      sessionId: 's',
      agentId: 'a',
    });
    const plan = new Plan();
    plan.add('one', async () => 1);
    plan.add('two', async () => 2);

    const { lineage, results } = await executor.run(plan);
    expect(lineage).toHaveLength(4);
    expect(results.size).toBe(2);
  });

  it('lineageToAuditEntry maps phase correctly to result enum', () => {
    // Synthesised inputs — does not require a running executor.
    const startRow = lineageToAuditEntry(
      {
        id: 'op-1',
        name: 'x',
        phase: 'start',
        startedAt: '2026-04-24T00:00:00.000Z',
        tag: 'io-bound',
      },
      { sessionId: 's', agentId: 'a' },
    );
    expect(startRow.result).toBe('success');
    expect((startRow.args as { phase: string }).phase).toBe('start');
    expect(startRow.durationMs).toBe(0);

    const endErr = lineageToAuditEntry(
      {
        id: 'op-1',
        name: 'x',
        phase: 'end',
        startedAt: '2026-04-24T00:00:00.000Z',
        endedAt: '2026-04-24T00:00:01.000Z',
        durationMs: 1000,
        result: 'error',
        error: { message: 'no' },
      },
      { sessionId: 's', agentId: 'a' },
    );
    expect(endErr.result).toBe('error');
    expect(endErr.durationMs).toBe(1000);
  });
});
