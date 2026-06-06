/**
 * batiste-fm ingest drive
 *
 * Sync a Google Drive folder into Firm Memory. For Bonita G's Loungerie
 * deployment this is the asset catalog (product photos, brand guidelines,
 * templates) that the design-as-code compiler resolves against.
 *
 * v1.3 ships:
 *   - OAuth substrate (`utils/gauth.ts`) — scope-flexible from day one,
 *     so future `ingest gmail` / `ingest calendar` / `ingest sheets`
 *     reuse the same Google session token by adding scopes incrementally.
 *   - Metadata fetch (filename + mime + drive_ref → FactEntry).
 *   - Fixture mode for the design-as-code demo (no live OAuth needed).
 *
 * Binary content extraction (PDF text, image OCR) reuses
 * `@batiste-aidk/connectors` parsers and lands in v1.3.1.
 */

import type { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { openFirmMemory, type FactEntry } from '@batiste-aidk/memory';
import { AuditLedger } from '@batiste-aidk/audit';
import { ensureFmRoot, resolvePaths } from '../utils/data-dir.js';
import { shortHash } from '../utils/hash.js';
import { scrub } from '../utils/scrub.js';
import { withAudit } from '../audit-wrap.js';
import { cyan, gray, green, kv, ok, Progress, section, warn, yellow } from '../utils/output.js';
import { getCheckpoint, loadCheckpoints, saveCheckpoints, setCheckpoint } from '../utils/checkpoint.js';
import { kebabCase } from '../utils/trello-client.js';
import {
  DRIVE_READONLY_SCOPE,
  fetchFolderMeta,
  listFolderFiles,
  type DriveFile,
  type DriveFolder,
} from '../utils/drive-client.js';
import { getGoogleClient } from '../utils/gauth.js';

export interface DriveFixture {
  folder: DriveFolder;
  files: DriveFile[];
}

export interface DriveProjectionOptions {
  workstream?: string;
  /** ISO timestamp; injected for deterministic tests. Defaults to now. */
  now?: string;
}

function renderFileMetadata(file: DriveFile): string {
  const lines = [
    `id: ${file.id}`,
    `name: ${file.name}`,
    `mimeType: ${file.mimeType}`,
  ];
  if (file.size) lines.push(`size: ${file.size}`);
  if (file.createdTime) lines.push(`createdTime: ${file.createdTime}`);
  if (file.modifiedTime) lines.push(`modifiedTime: ${file.modifiedTime}`);
  if (file.webViewLink) lines.push(`webViewLink: ${file.webViewLink}`);
  if (file.parents && file.parents.length > 0) {
    lines.push(`parents: [${file.parents.join(', ')}]`);
  }
  return lines.join('\n');
}

/**
 * Pure projection: a Drive folder + its file list -> FactEntry[]. One
 * entry per non-trashed file. Body is YAML-ish metadata; binary content
 * extraction is deferred to the design-as-code resolver step.
 */
export function projectFolderToFacts(
  folder: DriveFolder,
  files: DriveFile[],
  options: DriveProjectionOptions = {},
): FactEntry[] {
  const workstream = options.workstream && options.workstream.length > 0
    ? options.workstream
    : kebabCase(folder.name);
  const now = options.now ?? new Date().toISOString();

  return files
    .filter((f) => !f.trashed)
    .map((file) => {
      const { text: scrubbed } = scrub(renderFileMetadata(file));
      return {
        id: shortHash(`drive:${file.id}`),
        kind: 'precedent',
        title: file.name,
        body: scrubbed,
        workstream,
        sensitivity: 'confidential',
        tags: [
          'source:drive',
          `mime:${file.mimeType}`,
          `folder:${folder.name}`,
        ],
        vault_ref: file.webViewLink ?? `drive://${file.id}`,
        created_at: file.createdTime ?? now,
        updated_at: file.modifiedTime ?? now,
      } satisfies FactEntry;
    });
}

async function loadFixture(path: string): Promise<DriveFixture> {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as DriveFixture;
  if (!parsed.folder || !Array.isArray(parsed.files)) {
    throw new Error(`Drive fixture ${path} does not match { folder, files[] } shape.`);
  }
  return parsed;
}

export function registerIngestDrive(parent: Command): void {
  parent
    .command('drive')
    .description('Sync a Google Drive folder into FM (live OAuth or --fixture)')
    .option('--folder-id <id>', 'Drive folder ID (live mode)')
    .option('--fixture <path>', 'load folder snapshot from a local JSON file (offline / demo mode)')
    .option('--workstream <slug>', 'override workstream tag (default: kebab-case of folder name)')
    .option('--scopes <list>', 'comma-separated OAuth scopes', DRIVE_READONLY_SCOPE)
    .option('--dry-run', 'project + display, do not write to FM', false)
    .action(async (opts: {
      folderId?: string;
      fixture?: string;
      workstream?: string;
      scopes: string;
      dryRun: boolean;
    }) => {
      const paths = resolvePaths();
      await ensureFmRoot(paths);

      section('Atrium · ingest drive');
      kv('Mode', opts.fixture ? cyan('fixture') : cyan('live API'));
      if (opts.fixture) kv('Fixture', gray(opts.fixture));
      if (opts.folderId) kv('Folder ID', gray(opts.folderId));
      kv('Scopes', gray(opts.scopes));
      kv('Workstream', gray(opts.workstream ?? '(derived from folder name)'));
      kv('Namespace', cyan(paths.namespace));

      if (!opts.fixture && !opts.folderId) {
        warn('Pass --folder-id <id> for live mode, or --fixture <path.json> for offline mode.');
        return;
      }

      const checkpoints = await loadCheckpoints(paths.checkpointPath);
      let folder: DriveFolder;
      let files: DriveFile[];

      if (opts.fixture) {
        const fx = await loadFixture(opts.fixture);
        folder = fx.folder;
        files = fx.files;
      } else {
        const scopes = opts.scopes.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
        const client = await getGoogleClient(scopes);
        const folderId = opts.folderId as string;
        folder = await fetchFolderMeta(client, folderId);
        const since = getCheckpoint<string>(checkpoints, 'drive', folderId);
        files = [];
        for await (const f of listFolderFiles(client, folderId, { modifiedTimeFloor: since })) {
          files.push(f);
        }
      }

      kv('Folder', `${folder.name} (${folder.id})`);
      kv('Files', String(files.filter((f) => !f.trashed).length));

      const facts = projectFolderToFacts(folder, files, { workstream: opts.workstream });

      if (opts.dryRun) {
        for (const f of facts) {
          process.stdout.write(`  ${gray('would put:')} ${f.id}  ${f.title}\n`);
        }
        ok(`Dry-run complete — ${facts.length} facts would be projected.`);
        return;
      }

      const fm = await openFirmMemory({ dataDir: paths.dataDir, namespace: paths.namespace });
      const ledger = new AuditLedger(paths.auditDbPath);
      const ctx = { ledger, sessionId: `atrium-${Date.now()}`, agentId: 'batiste-fm' };

      const progress = new Progress('importing', facts.length);
      let imported = 0;
      let skipped = 0;
      let lastModifiedTime = '';

      try {
        for (let i = 0; i < facts.length; i++) {
          const fact = facts[i];
          if (!fact) continue;
          const file = files.find((f) => shortHash(`drive:${f.id}`) === fact.id);
          if (file?.modifiedTime && file.modifiedTime > lastModifiedTime) {
            lastModifiedTime = file.modifiedTime;
          }
          const existing = await fm.facts.get(fact.id);
          if (existing && existing.body === fact.body) {
            skipped++;
            progress.tick(i + 1, gray('(idempotent)'));
            continue;
          }
          await withAudit(ctx, 'fm.facts.put', { id: fact.id, source: 'drive', folderId: folder.id }, async () => {
            await fm.facts.put(fact);
          });
          imported++;
          progress.tick(i + 1);
        }
        progress.done(green(`${imported} imported, ${skipped} skipped`));

        if (lastModifiedTime) {
          setCheckpoint(checkpoints, 'drive', folder.id, lastModifiedTime);
          await saveCheckpoints(paths.checkpointPath, checkpoints);
        }

        section('Summary');
        kv('Imported', green(String(imported)));
        kv('Skipped (idempotent)', String(skipped));
        kv('Checkpoint', gray(lastModifiedTime || '(no files had modifiedTime)'));
        kv('Audit ledger', gray(paths.auditDbPath));
        ok('drive ingestion complete.');
      } finally {
        void yellow;
        await fm.close();
      }
    });
}
