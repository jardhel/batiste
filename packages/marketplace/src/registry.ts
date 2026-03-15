/**
 * Node Registry
 *
 * SQLite-backed catalog of marketplace nodes.
 * WAL mode for safe concurrent reads.
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  NodeRecord,
  RegisterNodeInput,
  NodeStatus,
} from './types.js';

interface NodeRow {
  id: string;
  name: string;
  description: string;
  capabilities_json: string;
  endpoint: string;
  price_per_cycle: number;
  creator_id: string;
  tags_json: string;
  status: string;
  registered_at: string;
  last_heartbeat: string;
  latency_ms: number | null;
  reliability: number;
}

function rowToRecord(row: NodeRow): NodeRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    capabilities: JSON.parse(row.capabilities_json) as string[],
    endpoint: row.endpoint,
    pricePerCycle: row.price_per_cycle,
    creatorId: row.creator_id,
    tags: JSON.parse(row.tags_json) as string[],
    status: row.status as NodeStatus,
    registeredAt: row.registered_at,
    lastHeartbeat: row.last_heartbeat,
    latencyMs: row.latency_ms,
    reliability: row.reliability,
  };
}

/** Heartbeat timeout: nodes not seen within this window are marked offline */
const HEARTBEAT_TIMEOUT_MS = 60_000;

export class NodeRegistry {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        description     TEXT NOT NULL DEFAULT '',
        capabilities_json TEXT NOT NULL,
        endpoint        TEXT NOT NULL,
        price_per_cycle REAL NOT NULL,
        creator_id      TEXT NOT NULL,
        tags_json       TEXT NOT NULL DEFAULT '[]',
        status          TEXT NOT NULL DEFAULT 'online',
        registered_at   TEXT NOT NULL,
        last_heartbeat  TEXT NOT NULL,
        latency_ms      REAL,
        reliability     REAL NOT NULL DEFAULT 1.0
      )
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_nodes_creator ON nodes(creator_id)');
  }

  register(input: RegisterNodeInput): NodeRecord {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO nodes (id, name, description, capabilities_json, endpoint,
        price_per_cycle, creator_id, tags_json, status, registered_at, last_heartbeat,
        latency_ms, reliability)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'online', ?, ?, NULL, 1.0)
    `).run(
      id,
      input.name,
      input.description,
      JSON.stringify(input.capabilities),
      input.endpoint,
      input.pricePerCycle,
      input.creatorId,
      JSON.stringify(input.tags),
      now,
      now,
    );
    return this.get(id)!;
  }

  unregister(nodeId: string): boolean {
    const info = this.db.prepare('DELETE FROM nodes WHERE id = ?').run(nodeId);
    return info.changes > 0;
  }

  get(nodeId: string): NodeRecord | null {
    const row = this.db
      .prepare('SELECT * FROM nodes WHERE id = ?')
      .get(nodeId) as NodeRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  list(filter?: { status?: NodeStatus; creatorId?: string }): NodeRecord[] {
    let sql = 'SELECT * FROM nodes WHERE 1=1';
    const params: unknown[] = [];
    if (filter?.status) {
      sql += ' AND status = ?';
      params.push(filter.status);
    }
    if (filter?.creatorId) {
      sql += ' AND creator_id = ?';
      params.push(filter.creatorId);
    }
    sql += ' ORDER BY registered_at ASC';
    const rows = this.db.prepare(sql).all(...params) as NodeRow[];
    return rows.map(rowToRecord);
  }

  heartbeat(nodeId: string): boolean {
    const now = new Date().toISOString();
    const info = this.db
      .prepare("UPDATE nodes SET last_heartbeat = ?, status = 'online' WHERE id = ?")
      .run(now, nodeId);
    return info.changes > 0;
  }

  updateStatus(nodeId: string, status: NodeStatus): boolean {
    const info = this.db
      .prepare('UPDATE nodes SET status = ? WHERE id = ?')
      .run(status, nodeId);
    return info.changes > 0;
  }

  updateLatency(nodeId: string, latencyMs: number): void {
    // Exponential moving average (α=0.3)
    const row = this.db
      .prepare('SELECT latency_ms FROM nodes WHERE id = ?')
      .get(nodeId) as { latency_ms: number | null } | undefined;
    if (!row) return;
    const prev = row.latency_ms;
    const next = prev === null ? latencyMs : 0.3 * latencyMs + 0.7 * prev;
    this.db.prepare('UPDATE nodes SET latency_ms = ? WHERE id = ?').run(next, nodeId);
  }

  updateReliability(nodeId: string, success: boolean): void {
    // Exponential moving average (α=0.1)
    const row = this.db
      .prepare('SELECT reliability FROM nodes WHERE id = ?')
      .get(nodeId) as { reliability: number } | undefined;
    if (!row) return;
    const sample = success ? 1 : 0;
    const next = 0.1 * sample + 0.9 * row.reliability;
    this.db.prepare('UPDATE nodes SET reliability = ? WHERE id = ?').run(next, nodeId);
  }

  /** Mark nodes with stale heartbeats as offline */
  pruneStale(): number {
    const cutoff = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS).toISOString();
    const info = this.db
      .prepare("UPDATE nodes SET status = 'offline' WHERE last_heartbeat < ? AND status = 'online'")
      .run(cutoff);
    return info.changes;
  }

  close(): void {
    this.db.close();
  }
}
