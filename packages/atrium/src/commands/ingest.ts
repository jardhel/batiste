/**
 * batiste-fm ingest <source>
 *
 * Parent command for source-specific ingestion subcommands. Each source
 * is wired here so adding a new ingestion path (e.g., `ingest gmail`)
 * is a one-line registration plus a new file under commands/.
 */

import type { Command } from 'commander';
import { registerIngestCcMemory } from './ingest-cc-memory.js';
import { registerIngestCcSessions } from './ingest-cc-sessions.js';
import { registerIngestDrive } from './ingest-drive.js';
import { registerIngestTrello } from './ingest-trello.js';
import { registerIngestVault } from './ingest-vault.js';

export function registerIngest(program: Command): void {
  const ingest = program
    .command('ingest')
    .description('Pull a source into Firm Memory (cc-memory, cc-sessions, vault, drive, trello)');

  registerIngestCcMemory(ingest);
  registerIngestCcSessions(ingest);
  registerIngestVault(ingest);
  registerIngestDrive(ingest);
  registerIngestTrello(ingest);
}
