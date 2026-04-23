/**
 * batiste audit emit
 *
 * Append an entry to the operational event log (EventLog sibling of
 * AuditLedger). Use from shell / subagents / cron.
 *
 * Example:
 *   batiste audit emit file.created \
 *     --stream ana-luisa \
 *     --generator releases/.../carta.md \
 *     '{"path":"releases/.../carta.md","sha":"abc"}'
 */

import type { Command } from 'commander';
import { loadConfig } from '../utils/config.js';
import { EventLog } from '@batiste-aidk/audit';
import { ok, fail } from '../utils/output.js';

export function registerAuditEmit(audit: Command): void {
  audit
    .command('emit')
    .description('Append an operational event to the event log')
    .argument('<event>', 'Event name (e.g. file.created, pdf.recompiled)')
    .argument('[payload]', 'Optional JSON payload object', '{}')
    .option('--db <path>', 'Event DB path (overrides config)')
    .option('--stream <id>', 'Stream ID (e.g. ana-luisa, dr-dias)')
    .option('--generator <source>', 'Source that emitted the event')
    .option('--ts <iso>', 'Override timestamp (default: now)')
    .action(async (event: string, payloadStr: string, opts: {
      db?: string; stream?: string; generator?: string; ts?: string;
    }) => {
      const config = await loadConfig();
      const dbPath = opts.db ?? config.defaultAuditDb;

      let payload: Record<string, unknown> | undefined;
      if (payloadStr && payloadStr !== '{}') {
        try {
          const parsed = JSON.parse(payloadStr) as unknown;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            payload = parsed as Record<string, unknown>;
          } else {
            fail('payload must be a JSON object');
            process.exit(1);
          }
        } catch (err) {
          fail(`invalid JSON payload: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
      }

      let log: EventLog;
      try {
        log = new EventLog(dbPath);
      } catch (err) {
        fail(`cannot open event DB at ${dbPath}: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }

      try {
        log.append({
          ts: opts.ts ?? new Date().toISOString(),
          event,
          ...(opts.stream ? { stream: opts.stream } : {}),
          ...(opts.generator ? { generator: opts.generator } : {}),
          ...(payload ? { payload } : {}),
        });
        ok(`event: ${event}${opts.stream ? ` (stream=${opts.stream})` : ''}`);
      } catch (err) {
        fail(`append failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      } finally {
        log.close();
      }
    });
}
