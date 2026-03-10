/**
 * Audit Ledger
 *
 * Append-only audit log backed by SQLite in WAL mode.
 * Records every tool call with timing, result, and context.
 */

import Database from 'better-sqlite3';
import type { AuditEntry } from './types.js';

export interface LedgerQuery {
  sessionId?: string;
  agentId?: string;
  tool?: string;
  result?: 'success' | 'denied' | 'error';
  since?: string; // ISO datetime
  limit?: number;
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
        bytes_transferred INTEGER
      )
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(timestamp)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_log(session_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_log(agent_id)');
  }

  /** Append an audit entry. */
  append(entry: AuditEntry): void {
    this.db.prepare(`
      INSERT INTO audit_log (id, timestamp, session_id, agent_id, tool, args_json, result, duration_ms, ast_nodes_accessed, bytes_transferred)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id, entry.timestamp, entry.sessionId, entry.agentId,
      entry.tool, JSON.stringify(entry.args), entry.result, entry.durationMs,
      entry.astNodesAccessed ?? null, entry.bytesTransferred ?? null,
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
    }));
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
