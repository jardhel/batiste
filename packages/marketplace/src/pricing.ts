/**
 * Pricing Meter
 *
 * Tracks compute cycles per session and generates billing reports.
 * Backed by SQLite — same WAL pattern as @batiste-aidk/audit.
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { BillingEntry, BillingReport } from './types.js';

interface BillingRow {
  id: string;
  session_id: string;
  node_id: string;
  node_name: string;
  cycles_used: number;
  price_per_cycle: number;
  total_cost: number;
  recorded_at: string;
}

function rowToEntry(row: BillingRow): BillingEntry {
  return {
    id: row.id,
    sessionId: row.session_id,
    nodeId: row.node_id,
    nodeName: row.node_name,
    cyclesUsed: row.cycles_used,
    pricePerCycle: row.price_per_cycle,
    totalCost: row.total_cost,
    recordedAt: row.recorded_at,
  };
}

export class PricingMeter {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS billing (
        id            TEXT PRIMARY KEY,
        session_id    TEXT NOT NULL,
        node_id       TEXT NOT NULL,
        node_name     TEXT NOT NULL,
        cycles_used   INTEGER NOT NULL,
        price_per_cycle REAL NOT NULL,
        total_cost    REAL NOT NULL,
        recorded_at   TEXT NOT NULL
      )
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_billing_session ON billing(session_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_billing_node ON billing(node_id)');
  }

  record(sessionId: string, nodeId: string, nodeName: string, pricePerCycle: number, cyclesUsed: number): BillingEntry {
    const id = randomUUID();
    const now = new Date().toISOString();
    const totalCost = cyclesUsed * pricePerCycle;
    this.db.prepare(`
      INSERT INTO billing (id, session_id, node_id, node_name, cycles_used, price_per_cycle, total_cost, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, sessionId, nodeId, nodeName, cyclesUsed, pricePerCycle, totalCost, now);
    return {
      id,
      sessionId,
      nodeId,
      nodeName,
      cyclesUsed,
      pricePerCycle,
      totalCost,
      recordedAt: now,
    };
  }

  getReport(sessionId: string): BillingReport {
    const rows = this.db
      .prepare('SELECT * FROM billing WHERE session_id = ? ORDER BY recorded_at ASC')
      .all(sessionId) as BillingRow[];
    const entries = rows.map(rowToEntry);
    const totalCycles = entries.reduce((s, e) => s + e.cyclesUsed, 0);
    const totalCost = entries.reduce((s, e) => s + e.totalCost, 0);
    return {
      sessionId,
      entries,
      totalCycles,
      totalCost: Math.round(totalCost * 1e8) / 1e8, // 8 decimal places
      generatedAt: new Date().toISOString(),
    };
  }

  allReports(): BillingReport[] {
    const rows = this.db
      .prepare('SELECT DISTINCT session_id FROM billing')
      .all() as { session_id: string }[];
    return rows.map((r) => this.getReport(r.session_id));
  }

  close(): void {
    this.db.close();
  }
}
