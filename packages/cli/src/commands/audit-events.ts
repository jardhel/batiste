/**
 * batiste audit events
 *
 * Query the operational event log (EventLog). Mirror of `audit tail` but
 * for event_log entries.
 */

import type { Command } from 'commander';
import { loadConfig } from '../utils/config.js';
import { EventLog } from '@batiste-aidk/audit';
import { fail, section, table, bold, info, gray } from '../utils/output.js';

function formatTs(iso: string): string {
  return iso.replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

function shorten(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function registerAuditEvents(audit: Command): void {
  audit
    .command('events')
    .description('Query the operational event log')
    .option('--db <path>', 'Event DB path (overrides config)')
    .option('-n, --limit <number>', 'Max entries to show', '20')
    .option('--stream <id>', 'Filter by stream ID')
    .option('--event <name>', 'Filter by event name')
    .option('--since <iso>', 'Only entries since ISO timestamp')
    .option('--json', 'Output as JSON array instead of table')
    .action(async (opts: {
      db?: string; limit: string;
      stream?: string; event?: string; since?: string; json?: boolean;
    }) => {
      const config = await loadConfig();
      const dbPath = opts.db ?? config.defaultAuditDb;
      const limit = parseInt(opts.limit, 10);

      let log: EventLog;
      try {
        log = new EventLog(dbPath);
      } catch (err) {
        fail(`cannot open event DB at ${dbPath}: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }

      try {
        const rows = log.query({
          ...(opts.event ? { event: opts.event } : {}),
          ...(opts.stream ? { stream: opts.stream } : {}),
          ...(opts.since ? { since: opts.since } : {}),
          limit,
        }).reverse(); // oldest first for display

        if (opts.json) {
          process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
          return;
        }

        section('Event Log');
        if (rows.length === 0) {
          info('No events matched.');
          return;
        }
        table(
          ['Timestamp', 'Event', 'Stream', 'Payload'],
          rows.map((r) => [
            gray(formatTs(r.ts)),
            bold(r.event),
            r.stream ?? '',
            shorten(r.payload ? JSON.stringify(r.payload) : '', 60),
          ]),
        );
      } finally {
        log.close();
      }
    });
}
