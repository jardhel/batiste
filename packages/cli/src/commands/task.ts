/**
 * batiste task
 *
 * Persistent task list. Backed by SQLite (via `@batiste-aidk/audit`
 * TaskLog), mirrored to the event log. Survives crashes of the calling
 * agent / terminal / editor.
 *
 * Subcommands:
 *   create   — create a new task
 *   update   — change status or fields
 *   list     — list tasks (filters by status, stream, session)
 *   get      — print a single task in JSON
 *   delete   — soft-delete (status=deleted)
 *
 * Default DB path is `<config.defaultAuditDb>` (same SQLite as the event
 * log; separate `tasks` table).
 */

import type { Command } from 'commander';
import { loadConfig } from '../utils/config.js';
import { TaskLog, EventLog } from '@batiste-aidk/audit';
import type { TaskStatus } from '@batiste-aidk/audit';
import { ok, fail, section, table, bold, gray, info } from '../utils/output.js';

const VALID_STATUSES: TaskStatus[] = [
  'pending', 'in_progress', 'completed', 'blocked', 'parked', 'deleted',
];

function validateStatus(s: string | undefined): TaskStatus | undefined {
  if (s === undefined) return undefined;
  if (!VALID_STATUSES.includes(s as TaskStatus)) {
    throw new Error(`invalid status "${s}" (valid: ${VALID_STATUSES.join(', ')})`);
  }
  return s as TaskStatus;
}

function parseMetadata(s: string | undefined): Record<string, unknown> | undefined {
  if (!s) return undefined;
  try {
    const parsed = JSON.parse(s) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new Error('metadata must be a JSON object');
  } catch (err) {
    throw new Error(`invalid metadata JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function shorten(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function openStores(dbPath: string): { tasks: TaskLog; events: EventLog } {
  const events = new EventLog(dbPath);
  const tasks = new TaskLog(dbPath, events);
  return { tasks, events };
}

export function registerTask(program: Command): void {
  const cmd = program
    .command('task')
    .description('Persistent task list (SQLite-backed, crash-survivable)');

  cmd
    .command('create')
    .description('Create a new task')
    .requiredOption('--subject <s>', 'Brief subject line')
    .option('--description <s>', 'Longer description')
    .option('--id <s>', 'Stable ID (default: random UUID)')
    .option('--stream <s>', 'Stream ID (e.g. ana-luisa)')
    .option('--session <s>', 'Session ID')
    .option('--parent <s>', 'Parent task ID for hierarchies')
    .option('--status <s>', `Initial status (default pending; valid: ${VALID_STATUSES.join(',')})`)
    .option('--metadata <json>', 'JSON object with extra metadata')
    .option('--db <path>', 'Task DB path (overrides config)')
    .action(async (opts: {
      subject: string; description?: string; id?: string;
      stream?: string; session?: string; parent?: string;
      status?: string; metadata?: string; db?: string;
    }) => {
      const config = await loadConfig();
      const { tasks, events } = openStores(opts.db ?? config.defaultAuditDb);
      try {
        const task = tasks.create({
          ...(opts.id ? { id: opts.id } : {}),
          subject: opts.subject,
          ...(opts.description ? { description: opts.description } : {}),
          ...(opts.stream ? { stream: opts.stream } : {}),
          ...(opts.session ? { sessionId: opts.session } : {}),
          ...(opts.parent ? { parentId: opts.parent } : {}),
          ...(opts.status ? { status: validateStatus(opts.status) as TaskStatus } : {}),
          ...(opts.metadata ? { metadata: parseMetadata(opts.metadata) } : {}),
        });
        ok(`task ${task.id}: ${task.subject} [${task.status}]`);
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        tasks.close();
        events.close();
      }
    });

  cmd
    .command('update')
    .description('Update a task')
    .requiredOption('--id <s>', 'Task ID')
    .option('--status <s>', `Status (${VALID_STATUSES.join(',')})`)
    .option('--subject <s>', 'New subject')
    .option('--description <s>', 'New description')
    .option('--stream <s>', 'New stream ID')
    .option('--session <s>', 'New session ID')
    .option('--parent <s>', 'New parent task ID')
    .option('--metadata <json>', 'New metadata (replaces previous)')
    .option('--db <path>', 'Task DB path')
    .action(async (opts: {
      id: string; status?: string; subject?: string; description?: string;
      stream?: string; session?: string; parent?: string;
      metadata?: string; db?: string;
    }) => {
      const config = await loadConfig();
      const { tasks, events } = openStores(opts.db ?? config.defaultAuditDb);
      try {
        const patch = {
          ...(opts.status ? { status: validateStatus(opts.status) as TaskStatus } : {}),
          ...(opts.subject !== undefined ? { subject: opts.subject } : {}),
          ...(opts.description !== undefined ? { description: opts.description } : {}),
          ...(opts.stream !== undefined ? { stream: opts.stream } : {}),
          ...(opts.session !== undefined ? { sessionId: opts.session } : {}),
          ...(opts.parent !== undefined ? { parentId: opts.parent } : {}),
          ...(opts.metadata !== undefined ? { metadata: parseMetadata(opts.metadata) } : {}),
        };
        const task = tasks.update(opts.id, patch);
        ok(`task ${task.id} → ${task.status}: ${task.subject}`);
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        tasks.close();
        events.close();
      }
    });

  cmd
    .command('list')
    .description('List tasks')
    .option('--status <s>', 'Filter by status (comma-separated ok)')
    .option('--stream <s>', 'Filter by stream')
    .option('--session <s>', 'Filter by session ID')
    .option('--parent <s>', 'Filter by parent task ID')
    .option('-n, --limit <n>', 'Max results', '50')
    .option('--json', 'Output JSON array')
    .option('--db <path>', 'Task DB path')
    .action(async (opts: {
      status?: string; stream?: string; session?: string; parent?: string;
      limit: string; json?: boolean; db?: string;
    }) => {
      const config = await loadConfig();
      const { tasks, events } = openStores(opts.db ?? config.defaultAuditDb);
      try {
        let statusFilter: TaskStatus | TaskStatus[] | undefined;
        if (opts.status) {
          const raw = opts.status.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
          raw.forEach(validateStatus);
          statusFilter = raw as TaskStatus[];
        }
        const rows = tasks.list({
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(opts.stream ? { stream: opts.stream } : {}),
          ...(opts.session ? { sessionId: opts.session } : {}),
          ...(opts.parent ? { parentId: opts.parent } : {}),
          limit: parseInt(opts.limit, 10),
        });
        if (opts.json) {
          process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
          return;
        }
        section('Tasks');
        if (rows.length === 0) {
          info('No tasks matched.');
          return;
        }
        table(
          ['ID', 'Status', 'Subject', 'Stream', 'Updated'],
          rows.map((t) => [
            shorten(t.id, 12),
            t.status,
            bold(shorten(t.subject, 50)),
            t.stream ?? '',
            gray(t.updatedAt.replace('T', ' ').replace(/\.\d+Z$/, 'Z')),
          ]),
        );
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        tasks.close();
        events.close();
      }
    });

  cmd
    .command('get')
    .description('Print a single task as JSON')
    .requiredOption('--id <s>', 'Task ID')
    .option('--db <path>', 'Task DB path')
    .action(async (opts: { id: string; db?: string }) => {
      const config = await loadConfig();
      const { tasks, events } = openStores(opts.db ?? config.defaultAuditDb);
      try {
        const task = tasks.get(opts.id);
        if (!task) {
          fail(`task not found: ${opts.id}`);
          process.exit(1);
        }
        process.stdout.write(JSON.stringify(task, null, 2) + '\n');
      } finally {
        tasks.close();
        events.close();
      }
    });

  cmd
    .command('delete')
    .description('Soft-delete a task (status=deleted)')
    .requiredOption('--id <s>', 'Task ID')
    .option('--db <path>', 'Task DB path')
    .action(async (opts: { id: string; db?: string }) => {
      const config = await loadConfig();
      const { tasks, events } = openStores(opts.db ?? config.defaultAuditDb);
      try {
        tasks.update(opts.id, { status: 'deleted' });
        ok(`task ${opts.id} deleted`);
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        tasks.close();
        events.close();
      }
    });
}
