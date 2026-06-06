/**
 * parallel-bridge — wire `@batiste-aidk/parallel`'s `Executor` to the
 * deployment audit ledger.
 *
 * Why a bridge: `Executor` is provenance-emitting by design (it calls
 * `onLineage(entry)` at op start AND op end), but it has no opinion about
 * where those events go. Atrium has an opinion: every ingest/compile run
 * is a Firm-Memory-affecting operation, and per ADR-0002 every such
 * operation must be ledgered before/with the mutation. So we forward
 * each lineage event into the deployment's `AuditLedger` as an
 * `AuditEntry` row keyed `tool='parallel.op'`. After a run, an operator
 * can grep:
 *
 *   SELECT * FROM audit_log
 *   WHERE tool='parallel.op'
 *     AND timestamp > '<some iso>'
 *   ORDER BY timestamp;
 *
 * …and reconstruct the entire DAG that just executed: which ops fired,
 * how long each took, which failed.
 *
 * Two emissions per op (start + end) is intentional. Start tells you the
 * op was scheduled (so a crash mid-fn is visible as an unmatched start);
 * end records the outcome. We map both to ledger rows because the ledger
 * is the source of truth — the in-memory `LineageEntry[]` is lost on
 * process exit.
 *
 * `ledger: undefined` is supported so unit tests + dry-runs can build a
 * fully functional executor without a SQLite handle. In that mode the
 * in-memory lineage log is still populated; only the ledger emit is
 * skipped.
 */

import { randomUUID } from 'node:crypto';
import { Executor, type LineageEntry } from '@batiste-aidk/parallel';
import type { AuditEntry, AuditLedger } from '@batiste-aidk/audit';

export interface AtriumExecutorOptions {
  /** Global concurrency cap. Forwarded to `Executor`. */
  concurrency: number;
  /**
   * Deployment audit ledger. When omitted (tests, dry-runs), lineage is
   * still recorded in-memory and returned via `Executor.run().lineage`.
   */
  ledger?: AuditLedger;
  /** Audit `sessionId` stamped on every emitted entry. */
  sessionId: string;
  /** Audit `agentId` stamped on every emitted entry. */
  agentId: string;
}

/**
 * Map a parallel `LineageEntry` to an `AuditEntry`. Exported for the
 * tests so they can re-derive the expected row shape without poking at
 * SQLite internals.
 *
 * Schema notes:
 *   - `start` events have no `durationMs` yet; we store `0` (a `start`
 *     row in the ledger is the "scheduled" beacon, not a completed
 *     measurement). The matching `end` row carries the real number.
 *   - We deliberately stash the full `LineageEntry` shape into `args`
 *     (name, phase, durationMs, result, error) so a downstream report
 *     can rebuild the DAG without joining tables.
 *   - `result` collapses `LineageEntry.result` to the audit enum:
 *     `'success' | 'error'`. `start` rows are `'success'` (the start
 *     itself succeeded; outcome lives on the matching `end` row).
 */
export function lineageToAuditEntry(
  entry: LineageEntry,
  ctx: { sessionId: string; agentId: string },
): AuditEntry {
  const args: Record<string, unknown> = {
    name: entry.name,
    phase: entry.phase,
  };
  if (entry.tag !== undefined) args.tag = entry.tag;
  if (entry.durationMs !== undefined) args.durationMs = entry.durationMs;
  if (entry.result !== undefined) args.result = entry.result;
  if (entry.error !== undefined) args.error = entry.error;

  const result: AuditEntry['result'] =
    entry.phase === 'end' && entry.result === 'error' ? 'error' : 'success';

  return {
    // Synthesize a fresh uuid per ledger row — the lineage `id` is a
    // logical op identity (start/end share it), but `audit_log.id` is a
    // PRIMARY KEY and must be unique per insert.
    id: randomUUID(),
    timestamp: entry.startedAt,
    sessionId: ctx.sessionId,
    agentId: ctx.agentId,
    tool: 'parallel.op',
    args,
    result,
    durationMs: entry.durationMs ?? 0,
  };
}

/**
 * Build a configured `Executor` whose `onLineage` sink writes each event
 * to the supplied audit ledger (when provided). The returned executor is
 * safe to reuse across multiple `Plan`s in the same run.
 *
 * Ledger append failures are swallowed — the executor must never fail
 * because of a downstream sink. (Same convention as `audit-wrap.ts`.)
 */
export function buildAtriumExecutor(opts: AtriumExecutorOptions): Executor {
  return new Executor({
    concurrency: opts.concurrency,
    onLineage: (entry: LineageEntry): void => {
      if (!opts.ledger) return;
      try {
        opts.ledger.append(
          lineageToAuditEntry(entry, { sessionId: opts.sessionId, agentId: opts.agentId }),
        );
      } catch {
        // Ledger outage is itself an audit-emit failure caught by the
        // deployment monitor. Swallow so the run continues.
      }
    },
  });
}
