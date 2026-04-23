/**
 * Event Log
 *
 * Sibling of `AuditLedger` for operational events that don't fit the
 * tool-call audit shape (id/sessionId/agentId/tool/result/durationMs).
 *
 * Use cases:
 *   - Document creation, PDF recompile, stamp application
 *   - Daily/EOD digest markers
 *   - Workflow stream markers emitted by shell wrappers
 *
 * Backed by the same SQLite file or a separate one (caller's choice).
 * Schema is permissive: just `ts`, `event`, and optional `stream`,
 * `generator`, `payload`.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

export const EventLogEntrySchema = z.object({
  ts: z.string().datetime(),
  event: z.string().min(1),
  stream: z.string().optional(),
  generator: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
});
export type EventLogEntry = z.infer<typeof EventLogEntrySchema>;

export interface EventLogQuery {
  event?: string;
  stream?: string;
  since?: string;
  limit?: number;
}

export interface EventLogRow extends EventLogEntry {
  id: number;
}

export class EventLog {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS event_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        event TEXT NOT NULL,
        stream TEXT,
        generator TEXT,
        payload_json TEXT
      )
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_event_ts ON event_log(ts)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_event_stream ON event_log(stream)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_event_event ON event_log(event)');
  }

  append(entry: EventLogEntry): void {
    const parsed = EventLogEntrySchema.parse(entry);
    this.db.prepare(`
      INSERT INTO event_log (ts, event, stream, generator, payload_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      parsed.ts,
      parsed.event,
      parsed.stream ?? null,
      parsed.generator ?? null,
      parsed.payload ? JSON.stringify(parsed.payload) : null,
    );
  }

  query(q: EventLogQuery = {}): EventLogRow[] {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (q.event) { conditions.push('event = ?'); params.push(q.event); }
    if (q.stream) { conditions.push('stream = ?'); params.push(q.stream); }
    if (q.since) { conditions.push('ts >= ?'); params.push(q.since); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = q.limit ? `LIMIT ${q.limit}` : 'LIMIT 1000';

    const rows = this.db.prepare(
      `SELECT id, ts, event, stream, generator, payload_json FROM event_log ${where} ORDER BY ts DESC, id DESC ${limit}`,
    ).all(...params) as Array<{
      id: number;
      ts: string;
      event: string;
      stream: string | null;
      generator: string | null;
      payload_json: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      ts: row.ts,
      event: row.event,
      ...(row.stream !== null ? { stream: row.stream } : {}),
      ...(row.generator !== null ? { generator: row.generator } : {}),
      ...(row.payload_json !== null ? { payload: JSON.parse(row.payload_json) as Record<string, unknown> } : {}),
    }));
  }

  count(q: EventLogQuery = {}): number {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (q.event) { conditions.push('event = ?'); params.push(q.event); }
    if (q.stream) { conditions.push('stream = ?'); params.push(q.stream); }
    if (q.since) { conditions.push('ts >= ?'); params.push(q.since); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const row = this.db.prepare(`SELECT COUNT(*) as cnt FROM event_log ${where}`).get(...params) as { cnt: number };
    return row.cnt;
  }

  close(): void {
    this.db.close();
  }
}
