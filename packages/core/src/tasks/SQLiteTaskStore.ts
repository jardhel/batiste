/**
 * SQLiteTaskStore - SQLite-backed implementation of ITaskStore
 *
 * Features:
 * - Persistent storage with SQLite
 * - Automatic readonly database recovery
 * - Parent-child indexing for efficient queries
 */

import Database from 'better-sqlite3';
import { existsSync, unlinkSync, renameSync } from 'fs';
import type { Task, ITaskStore } from './types.js';

export class SQLiteTaskStore implements ITaskStore {
  private db: Database.Database;
  private dbPath: string;

  constructor(dbPath: string = ':memory:') {
    this.dbPath = dbPath;
    this.db = this.openDatabase(dbPath);
    this.initializeSchema();
  }

  private openDatabase(dbPath: string): Database.Database {
    try {
      const db = new Database(dbPath);
      // Test write capability immediately
      if (dbPath !== ':memory:') {
        this.testWriteCapability(db);
      }
      return db;
    } catch (error: unknown) {
      const err = error as Error & { code?: string };
      // Handle readonly database or locked database
      if (err.message?.includes('readonly') || err.code === 'SQLITE_READONLY') {
        return this.handleReadonlyDatabase(dbPath, err);
      }
      throw error;
    }
  }

  private testWriteCapability(db: Database.Database): void {
    try {
      db.exec('CREATE TABLE IF NOT EXISTS _write_test (id INTEGER)');
      db.exec('DROP TABLE IF EXISTS _write_test');
    } catch (error: unknown) {
      const err = error as Error & { code?: string };
      if (err.message?.includes('readonly') || err.code === 'SQLITE_READONLY') {
        throw error;
      }
      // Other errors during test are non-fatal
    }
  }

  private handleReadonlyDatabase(dbPath: string, originalError: Error): Database.Database {
    if (dbPath === ':memory:') {
      throw originalError;
    }

    // Try to recover by backing up and recreating
    const backupPath = `${dbPath}.readonly-backup-${Date.now()}`;

    try {
      if (existsSync(dbPath)) {
        renameSync(dbPath, backupPath);
        console.warn(`[@batiste-aidk/core] Database was readonly, backed up to: ${backupPath}`);
      }

      // Remove any stale lock files
      const walPath = `${dbPath}-wal`;
      const shmPath = `${dbPath}-shm`;
      if (existsSync(walPath)) unlinkSync(walPath);
      if (existsSync(shmPath)) unlinkSync(shmPath);

      // Create fresh database
      const db = new Database(dbPath);
      console.warn('[@batiste-aidk/core] Created fresh database after readonly recovery');
      return db;
    } catch (recoveryError: unknown) {
      const recErr = recoveryError as Error;
      // Recovery failed, throw with helpful message
      throw new Error(
        `Database is readonly and recovery failed. ` +
          `Original: ${originalError.message}. ` +
          `Recovery: ${recErr.message}. ` +
          `Try: rm -rf ${dbPath}* and restart.`
      );
    }
  }

  private initializeSchema(): void {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          parentId TEXT,
          label TEXT NOT NULL,
          status TEXT NOT NULL,
          context TEXT NOT NULL DEFAULT '{}',
          createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
          updatedAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )
      `);
      // Index for efficient parent-child queries
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_parentId ON tasks(parentId)`);
    } catch (error: unknown) {
      const err = error as Error;
      if (err.message?.includes('readonly')) {
        // If schema init fails due to readonly, try recovery
        this.db.close();
        this.db = this.handleReadonlyDatabase(this.dbPath, err);
        this.initializeSchema();
      } else {
        throw error;
      }
    }
  }

  async save(task: Task): Promise<void> {
    await this.executeWrite(() => {
      const stmt = this.db.prepare(`
        INSERT INTO tasks (id, parentId, label, status, context, updatedAt)
        VALUES (?, ?, ?, ?, ?, strftime('%s', 'now'))
        ON CONFLICT(id) DO UPDATE SET
          parentId = excluded.parentId,
          label = excluded.label,
          status = excluded.status,
          context = excluded.context,
          updatedAt = strftime('%s', 'now')
      `);
      stmt.run(
        task.id,
        task.parentId ?? null,
        task.label,
        task.status,
        JSON.stringify(task.context)
      );
    });
  }

  private async executeWrite<T>(operation: () => T): Promise<T> {
    try {
      return operation();
    } catch (error: unknown) {
      const err = error as Error & { code?: string };
      if (err.message?.includes('readonly') || err.code === 'SQLITE_READONLY') {
        // Attempt recovery
        this.db.close();
        this.db = this.handleReadonlyDatabase(this.dbPath, err);
        this.initializeSchema();
        // Retry the operation
        return operation();
      }
      throw error;
    }
  }

  async get(id: string): Promise<Task | null> {
    const row = this.db
      .prepare('SELECT id, parentId, label, status, context FROM tasks WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToTask(row) : null;
  }

  async getChildren(parentId: string): Promise<Task[]> {
    const rows = this.db
      .prepare('SELECT id, parentId, label, status, context FROM tasks WHERE parentId = ?')
      .all(parentId) as Record<string, unknown>[];
    return rows.map((row) => this.rowToTask(row));
  }

  async getAll(): Promise<Task[]> {
    const rows = this.db
      .prepare('SELECT id, parentId, label, status, context FROM tasks')
      .all() as Record<string, unknown>[];
    return rows.map((row) => this.rowToTask(row));
  }

  async getRoots(): Promise<Task[]> {
    const rows = this.db
      .prepare('SELECT id, parentId, label, status, context FROM tasks WHERE parentId IS NULL')
      .all() as Record<string, unknown>[];
    return rows.map((row) => this.rowToTask(row));
  }

  async delete(id: string): Promise<void> {
    await this.executeWrite(() => {
      this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    });
  }

  async clearAll(): Promise<void> {
    await this.executeWrite(() => {
      this.db.prepare('DELETE FROM tasks').run();
    });
  }

  close(): void {
    this.db.close();
  }

  private rowToTask(row: Record<string, unknown>): Task {
    return {
      id: row.id as string,
      parentId: (row.parentId as string) || undefined,
      label: row.label as string,
      status: row.status as Task['status'],
      context: JSON.parse(row.context as string),
    };
  }
}
