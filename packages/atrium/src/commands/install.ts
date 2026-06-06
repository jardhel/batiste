/**
 * batiste-fm install
 *
 * Two surfaces under one verb:
 *   - `batiste-fm install` (no subcommand) — boots the local Cachola Tech
 *     setup wizard at http://127.0.0.1:7777/. Customer-facing, brand
 *     chrome is fully Cachola Tech (per ADR-0006 + the brand-surfaces
 *     project memory). Local-only by design: server hard-binds to
 *     127.0.0.1.
 *   - `batiste-fm install hooks [--uninstall ...]` — wires the two
 *     Claude Code hook scripts that make Atrium "invisible" (v1.4
 *     promise: operator never types `batiste-fm ingest` again). See
 *     install-hooks.ts. This is a deliberate separate operator action;
 *     the wizard only hints at it, never auto-installs hooks.
 */

import type { Command } from 'commander';
import { startUiServer } from '../ui/server.js';
import { gray, kv, ok, section } from '../utils/output.js';
import { registerInstallHooks } from './install-hooks.js';

export function registerInstall(program: Command): void {
  const install = program
    .command('install')
    .description('Open the Cachola Tech setup wizard, or install hook scripts via the `hooks` subcommand')
    .option('--port <n>', 'port to bind on 127.0.0.1', '7777')
    .option('--no-open', "do not auto-open the system browser")
    .action(async (opts: { port: string; open: boolean }) => {
      const port = Number.parseInt(opts.port, 10) || 7777;
      const server = await startUiServer({
        port,
        openBrowser: opts.open,
      });

      section('Cachola Tech · Firm Memory · Setup');
      kv('Wizard URL', server.url);
      kv('Bound to', gray('127.0.0.1 — local only, never exposed to LAN'));
      ok('Wizard ready. Press Ctrl-C to stop the server.');
      // The hint is intentionally minimal: this is a separate explicit
      // operator action so we don't surprise them by silently mutating
      // ~/.claude/settings.json from the wizard.
      process.stdout.write(
        `  ${gray('hint:')} once setup is complete, run ${gray('`batiste-fm install hooks`')} to enable auto-ingest.\n`,
      );

      await new Promise<void>(() => {
        process.on('SIGINT', () => {
          ok('Stopping server.');
          server
            .close()
            .then(() => process.exit(0))
            .catch(() => process.exit(0));
        });
        process.on('SIGTERM', () => {
          server
            .close()
            .then(() => process.exit(0))
            .catch(() => process.exit(0));
        });
      });
    });

  // Mount the `hooks` subcommand under the existing `install` verb.
  registerInstallHooks(install);
}
