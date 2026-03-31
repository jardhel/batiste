/**
 * batiste audit tail
 *
 * Tail the Batiste audit ledger.
 * With --follow, polls every 2s and prints new entries as they arrive.
 */

import type { Command } from 'commander';
import { loadConfig } from '../utils/config.js';
import { AuditLedger } from '@batiste-aidk/audit';
import {
  fail, section, table, statusBadge, bold, info, gray, green,
} from '../utils/output.js';

function formatTs(iso: string): string {
  return iso.replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

export function registerAuditTail(program: Command): void {
  program
    .command('audit')
    .description('Tail the audit ledger')
    .command('tail')
    .description('Print recent audit entries')
    .option('--db <path>', 'Audit DB path (overrides config)')
    .option('-n, --limit <number>', 'Number of entries to show', '20')
    .option('-f, --follow', 'Poll for new entries every 2s')
    .option('--agent <id>', 'Filter by agent ID')
    .option('--tool <name>', 'Filter by tool name')
    .option('--result <r>', 'Filter by result (success|denied|error)')
    .action(async (opts: {
      db?: string; limit: string; follow?: boolean;
      agent?: string; tool?: string; result?: string;
    }) => {
      const config = await loadConfig();
      const dbPath = opts.db ?? config.defaultAuditDb;
      const limit = parseInt(opts.limit, 10);

      let ledger: AuditLedger;
      try {
        ledger = new AuditLedger(dbPath);
      } catch (err) {
        fail(`Cannot open audit DB at ${dbPath}: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }

      const query = {
        agentId: opts.agent,
        tool: opts.tool,
        result: opts.result as 'success' | 'denied' | 'error' | undefined,
        limit,
      };

      const printEntries = (firstRun = false) => {
        const entries = ledger.query(query).reverse(); // oldest first
        if (firstRun) {
          section('Audit Log' + (opts.follow ? ' (following…)' : ''));
        }
        if (entries.length === 0 && firstRun) {
          info('No entries found');
          return;
        }
        if (entries.length === 0) return;

        if (firstRun) {
          table(
            ['Timestamp', 'Agent', 'Tool', 'Result', 'Duration'],
            entries.map((e) => [
              formatTs(e.timestamp),
              e.agentId.slice(0, 12),
              bold(e.tool),
              statusBadge(e.result),
              `${e.durationMs.toFixed(1)}ms`,
            ]),
          );
        }
      };

      // Follow mode — track last seen and print diffs
      if (opts.follow) {
        let lastTs = '';
        printEntries(true);

        const tick = () => {
          const fresh = ledger.query({ ...query, since: lastTs || undefined }).reverse();
          const newEntries = lastTs ? fresh.filter((e) => e.timestamp > lastTs) : [];
          if (newEntries.length > 0) {
            newEntries.forEach((e) => {
              const ts = gray(formatTs(e.timestamp));
              const agent = e.agentId.slice(0, 12).padEnd(12);
              const tool = bold(e.tool.padEnd(20));
              const result = statusBadge(e.result);
              const dur = `${e.durationMs.toFixed(1)}ms`;
              process.stdout.write(`  ${ts}  ${agent}  ${tool}  ${result}  ${green(dur)}\n`);
            });
            lastTs = newEntries[newEntries.length - 1]!.timestamp;
          } else if (!lastTs && fresh.length > 0) {
            lastTs = fresh[fresh.length - 1]!.timestamp;
          }
        };

        const interval = setInterval(tick, 2_000);
        process.on('SIGINT', () => {
          clearInterval(interval);
          ledger.close();
          process.exit(0);
        });
      } else {
        printEntries(true);
        ledger.close();
      }
    });
}
