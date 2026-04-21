/**
 * Audit-log redaction (E3-B07).
 *
 * GDPR Art. 17 ("right to erasure") requires that a data controller be
 * able to remove a data subject's personal data on request. Our audit
 * ledger is append-only by design, which is in tension with erasure:
 * we cannot simply DELETE a row or the tamper-evidence property
 * collapses, and an auditor can no longer show a contiguous trail.
 *
 * This module resolves the tension with a **chain-preserving
 * redaction**:
 *
 *   1. The original entry's immutable metadata (id, timestamp,
 *      session_id, agent_id, tool, result, duration) is retained.
 *   2. The sensitive payload (`args_json`) is replaced in-place by a
 *      tombstone JSON object of the form:
 *
 *        {
 *          "_redacted": true,
 *          "_original_sha256": "<sha256 of original args_json>",
 *          "_redacted_at": "<ISO-8601 UTC>",
 *          "_reason": "<human-readable reason, free text>",
 *          "_request_id": "<DSR intake identifier>"
 *        }
 *
 *   3. A redaction record is appended to a sibling table
 *      `audit_redactions` so the redaction itself is an auditable
 *      event (the redactor's identity, time, and reason are
 *      preserved forever — only the data-subject payload is erased).
 *
 * The SHA-256 of the original payload is the integrity witness: a
 * later auditor can verify that the pre-redaction content had the
 * recorded hash without ever seeing the original content. This is the
 * bit the phrase "chain-preserving" refers to — the integrity chain
 * (ordering, identity, and hash witness) remains intact even though
 * the payload body is gone.
 *
 * Compliance:
 *   - GDPR Art. 17 (erasure), Art. 5(1)(c) (data minimisation)
 *   - ISO 27001 A.8.10 (information deletion)
 *   - SOC 2 C1.1 (confidential information is protected)
 *   - EU AI Act Art. 12 (record-keeping — erasure must preserve
 *     the ability to evidence operation of the system)
 */

import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

export interface RedactionRequest {
  /** Audit entry id to redact. */
  entryId: string;
  /** Operator who performed the redaction. */
  actor: string;
  /** Free-text reason (goes into the tombstone and the redaction log). */
  reason: string;
  /** Optional DSR intake identifier (cross-references dsr-log.md). */
  requestId?: string;
}

export interface RedactionResult {
  entryId: string;
  originalSha256: string;
  redactedAt: string;
  reason: string;
  actor: string;
  requestId: string | null;
}

/**
 * Initialise the `audit_redactions` table. Safe to call repeatedly —
 * uses `CREATE TABLE IF NOT EXISTS`.
 */
export function initRedactionTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_redactions (
      entry_id TEXT PRIMARY KEY,
      actor TEXT NOT NULL,
      reason TEXT NOT NULL,
      request_id TEXT,
      original_sha256 TEXT NOT NULL,
      redacted_at TEXT NOT NULL,
      FOREIGN KEY (entry_id) REFERENCES audit_log(id) ON DELETE RESTRICT
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_redactions_ts ON audit_redactions(redacted_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_redactions_req ON audit_redactions(request_id)');
}

/**
 * Redact the args payload of a single audit entry in place.
 *
 * Throws if the entry id does not exist or has already been redacted.
 * The operation is atomic: args_json and the audit_redactions row are
 * written in a single transaction, so a crash mid-write cannot leave
 * a half-redacted entry.
 */
export function redactEntry(
  db: Database.Database,
  req: RedactionRequest,
): RedactionResult {
  const existing = db
    .prepare('SELECT args_json FROM audit_log WHERE id = ?')
    .get(req.entryId) as { args_json: string } | undefined;
  if (!existing) {
    throw new Error(`audit entry not found: ${req.entryId}`);
  }
  const alreadyRedacted = (() => {
    try {
      const parsed = JSON.parse(existing.args_json) as Record<string, unknown>;
      return parsed._redacted === true;
    } catch {
      return false;
    }
  })();
  if (alreadyRedacted) {
    throw new Error(`audit entry already redacted: ${req.entryId}`);
  }

  const originalSha256 = createHash('sha256').update(existing.args_json).digest('hex');
  const redactedAt = new Date().toISOString();
  const tombstone = JSON.stringify({
    _redacted: true,
    _original_sha256: originalSha256,
    _redacted_at: redactedAt,
    _reason: req.reason,
    _request_id: req.requestId ?? null,
  });

  const txn = db.transaction(() => {
    db.prepare('UPDATE audit_log SET args_json = ? WHERE id = ?').run(tombstone, req.entryId);
    db.prepare(
      `INSERT INTO audit_redactions (entry_id, actor, reason, request_id, original_sha256, redacted_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(req.entryId, req.actor, req.reason, req.requestId ?? null, originalSha256, redactedAt);
  });
  txn();

  return {
    entryId: req.entryId,
    originalSha256,
    redactedAt,
    reason: req.reason,
    actor: req.actor,
    requestId: req.requestId ?? null,
  };
}

/**
 * List redactions. Used by the DSR runbook to evidence completion of
 * a Right-to-Erasure request (GDPR Art. 12(3) — one-month response
 * window; operator must attach the redaction log to the reply).
 */
export function listRedactions(db: Database.Database, opts: { since?: string; requestId?: string } = {}): RedactionResult[] {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts.since) { conditions.push('redacted_at >= ?'); params.push(opts.since); }
  if (opts.requestId) { conditions.push('request_id = ?'); params.push(opts.requestId); }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT entry_id, actor, reason, request_id, original_sha256, redacted_at
              FROM audit_redactions ${where} ORDER BY redacted_at DESC`)
    .all(...params) as Array<{
      entry_id: string;
      actor: string;
      reason: string;
      request_id: string | null;
      original_sha256: string;
      redacted_at: string;
    }>;
  return rows.map((r) => ({
    entryId: r.entry_id,
    actor: r.actor,
    reason: r.reason,
    requestId: r.request_id,
    originalSha256: r.original_sha256,
    redactedAt: r.redacted_at,
  }));
}

/**
 * Tombstone-aware predicate used by read paths. An auditor query that
 * needs to skip redacted entries can filter on this.
 */
export function isRedacted(argsJson: string): boolean {
  try {
    const parsed = JSON.parse(argsJson) as Record<string, unknown>;
    return parsed._redacted === true;
  } catch {
    return false;
  }
}
