/**
 * Audit Ledger
 *
 * Append-only audit log backed by SQLite in WAL mode.
 * Records every tool call with timing, result, and context.
 */

import Database from 'better-sqlite3';
import type { AuditEntry, TokenUsage } from './types.js';
import { initRedactionTable, redactEntry, listRedactions, type RedactionRequest, type RedactionResult } from './redaction.js';

export interface LedgerQuery {
  sessionId?: string;
  agentId?: string;
  tool?: string;
  result?: 'success' | 'denied' | 'error';
  since?: string; // ISO datetime
  limit?: number;
}

/** Aggregate of measured token cost over a query window. */
export interface TokenTotals {
  /** Rows that carried a measured `usage` payload. */
  inferences: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export class AuditLedger {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        session_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        tool TEXT NOT NULL,
        args_json TEXT NOT NULL,
        result TEXT NOT NULL,
        duration_ms REAL NOT NULL,
        ast_nodes_accessed INTEGER,
        bytes_transferred INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cached_tokens INTEGER,
        model_id TEXT,
        provider TEXT
      )
    `);
    this.migrateTokenColumns();
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(timestamp)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_log(session_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_log(agent_id)');
    // E3-B07: sibling table records every GDPR Art. 17 redaction so
    // erasure is itself auditable.
    initRedactionTable(this.db);
  }

  /**
   * Add the token-usage columns to ledgers created before instrumentation.
   * `CREATE TABLE IF NOT EXISTS` is a no-op on an existing table, so an
   * append-only ledger predating this change would otherwise reject the new
   * columns. Each ALTER is idempotent — skipped when the column is present.
   */
  private migrateTokenColumns(): void {
    const existing = new Set(
      (this.db.prepare('PRAGMA table_info(audit_log)').all() as Array<{ name: string }>)
        .map((c) => c.name),
    );
    const additions: Array<[string, string]> = [
      ['input_tokens', 'INTEGER'],
      ['output_tokens', 'INTEGER'],
      ['cached_tokens', 'INTEGER'],
      ['model_id', 'TEXT'],
      ['provider', 'TEXT'],
    ];
    for (const [name, type] of additions) {
      if (!existing.has(name)) {
        this.db.exec(`ALTER TABLE audit_log ADD COLUMN ${name} ${type}`);
      }
    }
  }

  /**
   * Redact a single audit entry in-place (GDPR Art. 17).
   *
   * Preserves the entry's metadata and records a SHA-256 witness of
   * the original payload so the ledger's integrity chain survives.
   * See `redaction.ts` for the full data model.
   */
  redact(request: RedactionRequest): RedactionResult {
    return redactEntry(this.db, request);
  }

  /** List redactions for DSR evidence packs. */
  redactions(opts: { since?: string; requestId?: string } = {}): RedactionResult[] {
    return listRedactions(this.db, opts);
  }

  /** Append an audit entry. */
  append(entry: AuditEntry): void {
    const u = entry.usage;
    this.db.prepare(`
      INSERT INTO audit_log (id, timestamp, session_id, agent_id, tool, args_json, result, duration_ms, ast_nodes_accessed, bytes_transferred, input_tokens, output_tokens, cached_tokens, model_id, provider)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id, entry.timestamp, entry.sessionId, entry.agentId,
      entry.tool, JSON.stringify(entry.args), entry.result, entry.durationMs,
      entry.astNodesAccessed ?? null, entry.bytesTransferred ?? null,
      u?.inputTokens ?? null, u?.outputTokens ?? null, u?.cachedTokens ?? null,
      u?.modelId ?? null, u?.provider ?? null,
    );
  }

  /** Query audit entries. */
  query(q: LedgerQuery = {}): AuditEntry[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (q.sessionId) { conditions.push('session_id = ?'); params.push(q.sessionId); }
    if (q.agentId) { conditions.push('agent_id = ?'); params.push(q.agentId); }
    if (q.tool) { conditions.push('tool = ?'); params.push(q.tool); }
    if (q.result) { conditions.push('result = ?'); params.push(q.result); }
    if (q.since) { conditions.push('timestamp >= ?'); params.push(q.since); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = q.limit ? `LIMIT ${q.limit}` : 'LIMIT 1000';

    const rows = this.db.prepare(
      `SELECT * FROM audit_log ${where} ORDER BY timestamp DESC ${limit}`,
    ).all(...params) as Array<{
      id: string; timestamp: string; session_id: string; agent_id: string;
      tool: string; args_json: string; result: string; duration_ms: number;
      ast_nodes_accessed: number | null; bytes_transferred: number | null;
      input_tokens: number | null; output_tokens: number | null;
      cached_tokens: number | null; model_id: string | null; provider: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      sessionId: row.session_id,
      agentId: row.agent_id,
      tool: row.tool,
      args: JSON.parse(row.args_json) as Record<string, unknown>,
      result: row.result as 'success' | 'denied' | 'error',
      durationMs: row.duration_ms,
      astNodesAccessed: row.ast_nodes_accessed ?? undefined,
      bytesTransferred: row.bytes_transferred ?? undefined,
      ...rowUsage(row),
    }));
  }

  /**
   * Sum measured token cost over a query window.
   *
   * This is the shell-verifiable heart of "audit-by-construction of cost":
   * the number is read straight from the ledger's measured rows, never
   * estimated. Only rows carrying a real `usage` payload (non-null `model_id`)
   * contribute, so unmeasured tool calls cannot dilute or inflate it.
   */
  tokenTotals(q: LedgerQuery = {}): TokenTotals {
    const conditions: string[] = ['model_id IS NOT NULL'];
    const params: unknown[] = [];
    if (q.sessionId) { conditions.push('session_id = ?'); params.push(q.sessionId); }
    if (q.agentId) { conditions.push('agent_id = ?'); params.push(q.agentId); }
    if (q.tool) { conditions.push('tool = ?'); params.push(q.tool); }
    if (q.result) { conditions.push('result = ?'); params.push(q.result); }
    if (q.since) { conditions.push('timestamp >= ?'); params.push(q.since); }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const row = this.db.prepare(
      `SELECT COUNT(*) AS inferences,
              COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(cached_tokens), 0) AS cached_tokens
       FROM audit_log ${where}`,
    ).get(...params) as {
      inferences: number; input_tokens: number; output_tokens: number; cached_tokens: number;
    };
    return {
      inferences: row.inferences,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cachedTokens: row.cached_tokens,
    };
  }

  /** Count entries matching a query. */
  count(q: LedgerQuery = {}): number {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (q.sessionId) { conditions.push('session_id = ?'); params.push(q.sessionId); }
    if (q.agentId) { conditions.push('agent_id = ?'); params.push(q.agentId); }
    if (q.since) { conditions.push('timestamp >= ?'); params.push(q.since); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const row = this.db.prepare(`SELECT COUNT(*) as cnt FROM audit_log ${where}`).get(...params) as { cnt: number };
    return row.cnt;
  }

  close(): void { this.db.close(); }
}

/**
 * Rebuild the optional `usage` object from a ledger row. Returns `{ usage }`
 * only when the row carries a measured inference (non-null `model_id` and
 * `provider`); otherwise `{}`, so spreading it onto an entry leaves `usage`
 * absent rather than half-populated.
 */
function rowUsage(row: {
  input_tokens: number | null; output_tokens: number | null;
  cached_tokens: number | null; model_id: string | null; provider: string | null;
}): { usage?: TokenUsage } {
  if (row.model_id === null || row.provider === null
    || row.input_tokens === null || row.output_tokens === null) {
    return {};
  }
  return {
    usage: {
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      ...(row.cached_tokens !== null ? { cachedTokens: row.cached_tokens } : {}),
      modelId: row.model_id,
      provider: row.provider,
      source: 'api_usage',
    },
  };
}
