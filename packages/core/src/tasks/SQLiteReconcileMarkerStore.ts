/**
 * SQLiteReconcileMarkerStore - persists the git-reconciliation high-water mark.
 *
 * Reconciliation is idempotent: each run remembers the newest commit SHA it
 * processed, so the next run only inspects commits after it. This store holds
 * that single marker in its own tiny SQLite file (default `reconcile.db` under
 * DATA_DIR), keeping the task store's schema untouched.
 *
 * The table is a degenerate key/value with a single fixed row.
 */

import Database from 'better-sqlite3';
import type { IReconcileMarkerStore } from './types.js';

const MARKER_KEY = 'lastSha';

export class SQLiteReconcileMarkerStore implements IReconcileMarkerStore {
  private db: Database.Database;

  constructor(dbPath = ':memory:') {
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reconcile_marker (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updatedAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      )
    `);
  }

  getLastSha(): string | null {
    const row = this.db
      .prepare('SELECT value FROM reconcile_marker WHERE key = ?')
      .get(MARKER_KEY) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setLastSha(sha: string): void {
    this.db
      .prepare(
        `INSERT INTO reconcile_marker (key, value, updatedAt)
         VALUES (?, ?, strftime('%s', 'now'))
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updatedAt = strftime('%s', 'now')`
      )
      .run(MARKER_KEY, sha);
  }

  close(): void {
    this.db.close();
  }
}
