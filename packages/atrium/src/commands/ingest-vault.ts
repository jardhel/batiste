/**
 * batiste-fm ingest vault
 *
 * Project the founder's Obsidian vault into Firm Memory via Graphify
 * (Leiden clustering + wikilink/tag/frontmatter topology). Per ADR-0002
 * §"Replication flows", AST chunking would lose ~70% of the vault's
 * retrieval signal because Obsidian is graph-first by design.
 *
 * v1.3 ships the wiring stub: `graphify` itself is installed via pipx,
 * the wrapper script (`bin/graphify-wrapper.sh`) is generated, but the
 * full graph.json → FactEntry projection lands in this CLI as a
 * follow-up after the Drive/Trello connectors stabilize.
 */

import type { Command } from 'commander';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { cyan, gray, kv, section, warn, yellow } from '../utils/output.js';
import { resolvePaths } from '../utils/data-dir.js';

const DEFAULT_VAULT = join(
  homedir(),
  'Library', 'Mobile Documents', 'iCloud~md~obsidian', 'Documents', 'cachola-tech',
);

export function registerIngestVault(parent: Command): void {
  parent
    .command('vault')
    .description('Project the Obsidian vault into FM via Graphify (stub in v1.3 — wires graphify-wrapper)')
    .option('--vault <path>', 'override vault path', DEFAULT_VAULT)
    .action(async (opts: { vault: string }) => {
      const paths = resolvePaths();
      section('Atrium · ingest vault');
      kv('Vault', gray(opts.vault));
      kv('FM root', gray(paths.fmRoot));
      kv('Namespace', cyan(paths.namespace));
      warn('vault ingestion is wiring-only in v1.3.');
      process.stdout.write(`  ${yellow('TODO:')} install graphify (pipx install graphifyy), generate .graphifyignore, run graphify, parse graph.json into FactEntry projections per ADR-0006.\n`);
      process.stdout.write(`  ${gray('Tracked: docs/adr/ADR-0006-cc-auto-memory-deprecation-via-atrium.md (vault path is a v1.3 wiring deliverable, full projection in follow-up).\n')}`);
    });
}
