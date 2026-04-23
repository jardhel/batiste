/**
 * Task Log
 *
 * SQLite-backed persistent task list. Sibling of `EventLog`. Every
 * create/update/complete also emits a corresponding event to a provided
 * `EventLog`, so the task state can be reconstructed from events if needed.
 *
 * Shape is intentionally narrow: id, timestamps, status, subject,
 * description, stream, session_id, parent_id, metadata. Enough for
 * multi-agent / multi-session coordination; not trying to be Jira.
 *
 * Use case:
 *   - Claude Code or any other agent creates tasks via `batiste task create`.
 *   - Subagents update status via `batiste task update --id X --status in_progress`.
 *   - After a crash or session restart, `batiste task list` plus
 *     `batiste audit events --since T` reconstructs where work was left.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { EventLog } from './event-log.js';

export const TaskStatusSchema = z.enum([
  'pending', 'in_progress', 'completed', 'blocked', 'parked', 'deleted',
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  status: TaskStatusSchema,
  subject: z.string().min(1),
  description: z.string().optional(),
  stream: z.string().optional(),
  sessionId: z.string().optional(),
  parentId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type Task = z.infer<typeof TaskSchema>;

export interface TaskCreateInput {
  id?: string;
  subject: string;
  description?: string;
  stream?: string;
  sessionId?: string;
  parentId?: string;
  status?: TaskStatus;
  metadata?: Record<string, unknown>;
}

export interface TaskUpdateInput {
  subject?: string;
  description?: string;
  stream?: string;
  sessionId?: string;
  parentId?: string;
  status?: TaskStatus;
  metadata?: Record<string, unknown>;
}

export interface TaskQuery {
  status?: TaskStatus | TaskStatus[];
  stream?: string;
  sessionId?: string;
  parentId?: string;
  limit?: number;
}

export class TaskLog {
  private readonly db: Database.Database;

  constructor(
    dbPath: string,
    private readonly eventLog?: EventLog,
  ) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        status TEXT NOT NULL,
        subject TEXT NOT NULL,
        description TEXT,
        stream TEXT,
        session_id TEXT,
        parent_id TEXT,
        metadata_json TEXT
      )
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_stream ON tasks(stream)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_updated ON tasks(updated_at)');
  }

  create(input: TaskCreateInput): Task {
    const now = new Date().toISOString();
    const task: Task = {
      id: input.id ?? randomUUID(),
      createdAt: now,
      updatedAt: now,
      status: input.status ?? 'pending',
      subject: input.subject,
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.stream !== undefined ? { stream: input.stream } : {}),
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    };
    TaskSchema.parse(task);

    this.db.prepare(`
      INSERT INTO tasks (id, created_at, updated_at, status, subject, description, stream, session_id, parent_id, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id, task.createdAt, task.updatedAt, task.status, task.subject,
      task.description ?? null,
      task.stream ?? null,
      task.sessionId ?? null,
      task.parentId ?? null,
      task.metadata ? JSON.stringify(task.metadata) : null,
    );

    this.emit('task.created', task);
    return task;
  }

  get(id: string): Task | null {
    const row = this.db.prepare(
      `SELECT * FROM tasks WHERE id = ?`,
    ).get(id) as TaskRow | undefined;
    return row ? rowToTask(row) : null;
  }

  update(id: string, patch: TaskUpdateInput): Task {
    const existing = this.get(id);
    if (!existing) throw new Error(`task not found: ${id}`);

    const now = new Date().toISOString();
    const next: Task = {
      ...existing,
      ...(patch.subject !== undefined ? { subject: patch.subject } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.stream !== undefined ? { stream: patch.stream } : {}),
      ...(patch.sessionId !== undefined ? { sessionId: patch.sessionId } : {}),
      ...(patch.parentId !== undefined ? { parentId: patch.parentId } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.metadata !== undefined ? { metadata: patch.metadata } : {}),
      updatedAt: now,
    };
    TaskSchema.parse(next);

    this.db.prepare(`
      UPDATE tasks
      SET updated_at = ?, status = ?, subject = ?, description = ?,
          stream = ?, session_id = ?, parent_id = ?, metadata_json = ?
      WHERE id = ?
    `).run(
      next.updatedAt, next.status, next.subject,
      next.description ?? null,
      next.stream ?? null,
      next.sessionId ?? null,
      next.parentId ?? null,
      next.metadata ? JSON.stringify(next.metadata) : null,
      id,
    );

    if (patch.status && patch.status !== existing.status) {
      if (patch.status === 'completed') this.emit('task.completed', next);
      else if (patch.status === 'deleted') this.emit('task.deleted', next);
      else this.emit('task.status_changed', next, { from: existing.status, to: patch.status });
    } else {
      this.emit('task.updated', next);
    }

    return next;
  }

  list(query: TaskQuery = {}): Task[] {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.status) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status];
      conditions.push(`status IN (${statuses.map(() => '?').join(',')})`);
      params.push(...statuses);
    } else {
      // By default exclude deleted.
      conditions.push(`status != 'deleted'`);
    }
    if (query.stream) { conditions.push('stream = ?'); params.push(query.stream); }
    if (query.sessionId) { conditions.push('session_id = ?'); params.push(query.sessionId); }
    if (query.parentId) { conditions.push('parent_id = ?'); params.push(query.parentId); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = query.limit ? `LIMIT ${query.limit}` : 'LIMIT 500';

    const rows = this.db.prepare(
      `SELECT * FROM tasks ${where} ORDER BY updated_at DESC ${limit}`,
    ).all(...params) as TaskRow[];
    return rows.map(rowToTask);
  }

  delete(id: string): boolean {
    return this.update(id, { status: 'deleted' }) !== null;
  }

  count(query: TaskQuery = {}): number {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.status) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status];
      conditions.push(`status IN (${statuses.map(() => '?').join(',')})`);
      params.push(...statuses);
    } else {
      conditions.push(`status != 'deleted'`);
    }
    if (query.stream) { conditions.push('stream = ?'); params.push(query.stream); }
    if (query.sessionId) { conditions.push('session_id = ?'); params.push(query.sessionId); }
    if (query.parentId) { conditions.push('parent_id = ?'); params.push(query.parentId); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const row = this.db.prepare(`SELECT COUNT(*) as cnt FROM tasks ${where}`).get(...params) as { cnt: number };
    return row.cnt;
  }

  close(): void {
    this.db.close();
  }

  private emit(event: string, task: Task, extra?: Record<string, unknown>): void {
    if (!this.eventLog) return;
    try {
      this.eventLog.append({
        ts: new Date().toISOString(),
        event,
        ...(task.stream ? { stream: task.stream } : {}),
        generator: 'batiste task',
        payload: {
          task_id: task.id,
          status: task.status,
          subject: task.subject,
          ...(task.sessionId ? { session_id: task.sessionId } : {}),
          ...(extra ?? {}),
        },
      });
    } catch { /* best-effort; task state is authoritative regardless */ }
  }
}

interface TaskRow {
  id: string;
  created_at: string;
  updated_at: string;
  status: string;
  subject: string;
  description: string | null;
  stream: string | null;
  session_id: string | null;
  parent_id: string | null;
  metadata_json: string | null;
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status as TaskStatus,
    subject: row.subject,
    ...(row.description !== null ? { description: row.description } : {}),
    ...(row.stream !== null ? { stream: row.stream } : {}),
    ...(row.session_id !== null ? { sessionId: row.session_id } : {}),
    ...(row.parent_id !== null ? { parentId: row.parent_id } : {}),
    ...(row.metadata_json !== null ? { metadata: JSON.parse(row.metadata_json) as Record<string, unknown> } : {}),
  };
}
