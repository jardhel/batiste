/**
 * batiste audit killswitch
 *
 * Cross-process kill switch for multi-agent sessions. File-based so shell
 * subagents can poll it from any process. Complements Batiste's in-process
 * `KillSwitch` class (which lives inside a single Node process).
 *
 * Subcommands:
 *   create   — initialize a kill token for a session (triggered=false)
 *   check    — exit 0 if allowed, 1 if triggered; prints status
 *   trigger  — flip triggered=true; agents polling will see it next tick
 *   status   — print current state
 *
 * The kill token lives at `<~/.batiste>/killswitch/<session>.json`. Each
 * kill operation also emits an event to the operational event log so the
 * audit trail records the halt.
 */

import type { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, configDir } from '../utils/config.js';
import { EventLog } from '@batiste-aidk/audit';
import { ok, fail, kv, section, green, red, gray } from '../utils/output.js';

interface KillToken {
  sessionId: string;
  createdAt: string;
  triggered: boolean;
  triggeredAt?: string;
  reason?: string;
}

function killswitchDir(): string {
  return join(configDir(), 'killswitch');
}

function tokenPath(sessionId: string): string {
  return join(killswitchDir(), `${sessionId}.json`);
}

function readToken(sessionId: string): KillToken | null {
  const p = tokenPath(sessionId);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as KillToken;
  } catch {
    return null;
  }
}

function writeToken(token: KillToken): void {
  const dir = killswitchDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(tokenPath(token.sessionId), JSON.stringify(token, null, 2) + '\n', 'utf8');
}

async function emitEvent(event: string, sessionId: string, reason?: string): Promise<void> {
  const config = await loadConfig();
  const log = new EventLog(config.defaultAuditDb);
  try {
    log.append({
      ts: new Date().toISOString(),
      event,
      stream: sessionId,
      generator: 'batiste audit killswitch',
      payload: reason !== undefined ? { sessionId, reason } : { sessionId },
    });
  } finally {
    log.close();
  }
}

export function registerAuditKillswitch(audit: Command): void {
  const ks = audit
    .command('killswitch')
    .description('Cross-process kill switch for multi-agent sessions');

  ks
    .command('create')
    .description('Create a kill token for a session')
    .requiredOption('--session <id>', 'Session ID (shared across agents)')
    .action(async (opts: { session: string }) => {
      const existing = readToken(opts.session);
      if (existing) {
        fail(`killswitch already exists for session ${opts.session} (triggered=${existing.triggered})`);
        process.exit(1);
      }
      writeToken({
        sessionId: opts.session,
        createdAt: new Date().toISOString(),
        triggered: false,
      });
      await emitEvent('killswitch.created', opts.session);
      ok(`killswitch created: ${opts.session}`);
    });

  ks
    .command('check')
    .description('Exit 0 if allowed, 1 if triggered (for agent polling)')
    .requiredOption('--session <id>', 'Session ID')
    .option('--silent', 'Do not print status, only use exit code')
    .action((opts: { session: string; silent?: boolean }) => {
      const token = readToken(opts.session);
      if (!token) {
        if (!opts.silent) fail(`no killswitch for session ${opts.session}`);
        process.exit(2);
      }
      if (token.triggered) {
        if (!opts.silent) {
          process.stdout.write(`${red('HALT')} ${opts.session} triggered at ${token.triggeredAt} (${token.reason ?? 'no reason'})\n`);
        }
        process.exit(1);
      }
      if (!opts.silent) process.stdout.write(`${green('OK')} ${opts.session} allowed\n`);
      process.exit(0);
    });

  ks
    .command('trigger')
    .description('Trigger the kill switch for a session')
    .requiredOption('--session <id>', 'Session ID')
    .option('--reason <str>', 'Reason for triggering', 'manual')
    .action(async (opts: { session: string; reason: string }) => {
      const token = readToken(opts.session);
      if (!token) {
        fail(`no killswitch for session ${opts.session} — run \`killswitch create\` first`);
        process.exit(1);
      }
      if (token.triggered) {
        fail(`already triggered at ${token.triggeredAt}: ${token.reason ?? 'no reason'}`);
        process.exit(1);
      }
      writeToken({
        ...token,
        triggered: true,
        triggeredAt: new Date().toISOString(),
        reason: opts.reason,
      });
      await emitEvent('killswitch.triggered', opts.session, opts.reason);
      ok(`killswitch triggered: ${opts.session} (${opts.reason})`);
    });

  ks
    .command('status')
    .description('Print current killswitch status')
    .requiredOption('--session <id>', 'Session ID')
    .action((opts: { session: string }) => {
      const token = readToken(opts.session);
      if (!token) {
        fail(`no killswitch for session ${opts.session}`);
        process.exit(1);
      }
      section(`Killswitch · ${opts.session}`);
      kv('Created', gray(token.createdAt));
      kv('Triggered', token.triggered ? red('yes') : green('no'));
      if (token.triggered) {
        kv('Triggered at', gray(token.triggeredAt ?? ''));
        kv('Reason', token.reason ?? '');
      }
    });
}
