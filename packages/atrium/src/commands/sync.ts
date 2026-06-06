/**
 * batiste-fm sync <target>
 *
 * Parent command for replication / mirror subcommands. Today: `sync drive`
 * (encrypted DR mirror to Google Drive). Future: `sync s3`, `sync git`, etc.
 *
 * Mirrors the structure of `commands/ingest.ts` so adding a new sync
 * target is a one-line registration plus a new file under commands/.
 */

import type { Command } from 'commander';
import { registerSyncDrive } from './sync-drive.js';

export function registerSync(program: Command): void {
  const sync = program
    .command('sync')
    .description('Replicate Firm Memory to an external store (currently: drive — encrypted DR mirror)');

  registerSyncDrive(sync);
}
