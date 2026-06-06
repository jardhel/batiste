/**
 * batiste-fm sync drive (push | restore | status)
 *
 * Encrypted disaster-recovery mirror of the local Firm Memory to a
 * designated Google Drive folder. Push-only / one-way; the canonical
 * query backend stays on local disk. Drive sees only opaque ciphertext —
 * the bundle is encrypted with AES-256-GCM (utils/crypt.ts) using a
 * passphrase that lives in env or macOS Keychain. Drive never holds key
 * material.
 *
 * Why on top of the existing OAuth substrate (`utils/gauth.ts`): per
 * ADR-0002 + the v1.3 ingestion plan, every Google connector reuses the
 * same refresh token and incrementally widens scopes. `sync drive` only
 * needs `drive.file` (files this app creates), not `drive.readonly`.
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Command } from 'commander';
import { AuditLedger } from '@batiste-aidk/audit';
import { ensureFmRoot, resolvePaths } from '../utils/data-dir.js';
import { withAudit } from '../audit-wrap.js';
import { getGoogleClient, type GoogleClient } from '../utils/gauth.js';
import { getSecret } from '../utils/keychain.js';
import {
  BUNDLE_MAGIC,
  decryptBundle,
  encryptBundle,
  looksLikeBatisteBundle,
  packEncrypted,
  unpackEncrypted,
} from '../utils/crypt.js';
import { packFmDir, unpackFmBundle, writeUnpackedBundle } from '../utils/bundle.js';
import {
  bold,
  cyan,
  fail,
  gray,
  green,
  kv,
  ok,
  Progress,
  section,
  warn,
  yellow,
} from '../utils/output.js';

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
export const PASSPHRASE_KEYCHAIN_ACCOUNT = 'fm-passphrase';
const DEFAULT_PASSPHRASE_ENV = 'BATISTE_FM_PASSPHRASE';
const DEFAULT_RESTORE_DIR = join(homedir(), '.batiste', 'firm-memory.restored');

export interface PushOptions {
  folderId: string;
  passphraseEnv: string;
  keychain: boolean;
  bundleName?: string;
  includeModels: boolean;
  dryRun: boolean;
}

export interface RestoreOptions {
  folderId: string;
  bundleName: string;
  passphraseEnv: string;
  keychain: boolean;
  targetDir: string;
  confirm: boolean;
}

export interface StatusOptions {
  folderId: string;
  json: boolean;
}

interface DriveListedFile {
  id: string;
  name: string;
  size?: string;
  modifiedTime?: string;
}

/**
 * Resolve the bundle passphrase following the documented order:
 *   1. --passphrase-env <var>  (default BATISTE_FM_PASSPHRASE)
 *   2. --keychain              (service: cachola-tech-batiste-fm,
 *                               account: fm-passphrase)
 *   3. fail with a setup hint
 *
 * Empty passphrase → error (refuses to derive a useless key).
 */
export async function resolvePassphrase(opts: {
  passphraseEnv: string;
  keychain: boolean;
}): Promise<string> {
  const fromEnv = process.env[opts.passphraseEnv];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  if (opts.keychain) {
    const fromKc = await getSecret(PASSPHRASE_KEYCHAIN_ACCOUNT);
    if (fromKc && fromKc.length > 0) return fromKc;
  }
  throw new Error(
    `Bundle passphrase not configured. Provide it via either:\n` +
    `    export ${opts.passphraseEnv}='...'    # short-lived shell env\n` +
    `  or\n` +
    `    security add-generic-password -U \\\n` +
    `      -s cachola-tech-batiste-fm \\\n` +
    `      -a ${PASSPHRASE_KEYCHAIN_ACCOUNT} -w '...'   # macOS Keychain\n` +
    `  then re-run with --keychain.`,
  );
}

function defaultBundleName(now = new Date()): string {
  // YYYY-MM-DDTHH-MM-SSZ — colons are awkward in Drive UIs; ISO-ish-no-colons.
  const iso = now.toISOString().replace(/[:]/g, '-').replace(/\.\d{3}Z$/, 'Z');
  return `fm-snapshot-${iso}.bin`;
}

async function listBundleFiles(client: GoogleClient, folderId: string): Promise<DriveListedFile[]> {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id,name,size,modifiedTime),nextPageToken',
    pageSize: '200',
    orderBy: 'modifiedTime desc',
  });
  const out: DriveListedFile[] = [];
  let pageToken: string | undefined;
  do {
    if (pageToken) params.set('pageToken', pageToken);
    const res = await client.fetch(`${DRIVE_API_BASE}/files?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Drive list ${folderId} failed (${res.status}): ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { files?: DriveListedFile[]; nextPageToken?: string };
    for (const f of data.files ?? []) out.push(f);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

/**
 * Multipart upload of an encrypted bundle. Drive's `uploadType=multipart`
 * lets us send metadata + bytes in a single round trip; for >5 MB bundles
 * a future optimization could switch to resumable upload.
 */
async function uploadBundle(
  client: GoogleClient,
  folderId: string,
  filename: string,
  payload: Buffer,
): Promise<{ id: string; name: string; size?: string }> {
  const boundary = `batiste-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const meta = JSON.stringify({
    name: filename,
    parents: [folderId],
    mimeType: 'application/octet-stream',
  });
  const head = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${meta}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const body = Buffer.concat([head, payload, tail]);

  const res = await client.fetch(
    `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,size`,
    {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(body.length),
      },
      body,
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive upload failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return (await res.json()) as { id: string; name: string; size?: string };
}

async function downloadFile(client: GoogleClient, fileId: string): Promise<Buffer> {
  const res = await client.fetch(
    `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`,
    { headers: { Accept: 'application/octet-stream' } },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive download ${fileId} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/**
 * Probe the first bytes of a Drive object to decide if it looks like one
 * of our bundles. Uses Range to avoid pulling the full file.
 */
async function probeMagic(client: GoogleClient, fileId: string): Promise<boolean> {
  const res = await client.fetch(
    `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`,
    { headers: { Range: `bytes=0-${BUNDLE_MAGIC.length - 1}` } },
  );
  if (!res.ok && res.status !== 206) return false;
  const ab = await res.arrayBuffer();
  return looksLikeBatisteBundle(Buffer.from(ab));
}

export async function runPush(opts: PushOptions): Promise<void> {
  const paths = resolvePaths();
  await ensureFmRoot(paths);
  const passphrase = await resolvePassphrase(opts);
  const bundleName = opts.bundleName ?? defaultBundleName();

  section('Atrium · sync drive push');
  kv('FM root', gray(paths.fmRoot));
  kv('Folder ID', gray(opts.folderId));
  kv('Bundle name', cyan(bundleName));
  kv('Include models', opts.includeModels ? yellow('yes (large)') : gray('no'));
  kv('Mode', opts.dryRun ? yellow('dry-run (no upload)') : cyan('upload'));

  const progress = new Progress('packing', 3);
  progress.tick(0, gray('walking FM tree'));
  const packed = await packFmDir(paths.fmRoot, { includeModels: opts.includeModels });
  progress.tick(1, gray(`${packed.entries.length} files, raw ${packed.rawBytes}B → gz ${packed.buffer.length}B`));

  const enc = encryptBundle(packed.buffer, passphrase);
  const onDisk = packEncrypted(enc);
  progress.tick(2, gray(`encrypted ${onDisk.length}B`));
  const sha = createHash('sha256').update(onDisk).digest('hex');
  progress.done(green(`bundle ready (${onDisk.length}B, sha256 ${sha.slice(0, 12)}…)`));

  if (opts.dryRun) {
    const stagingDir = join(tmpdir(), 'batiste-fm-sync');
    await mkdir(stagingDir, { recursive: true });
    const outPath = join(stagingDir, bundleName);
    await writeFile(outPath, onDisk);
    section('Dry-run summary');
    kv('Staged at', gray(outPath));
    kv('Size (bytes)', String(onDisk.length));
    kv('SHA-256', gray(sha));
    kv('Files in bundle', String(packed.entries.length));
    ok('Dry-run complete — no upload performed.');
    return;
  }

  const ledger = new AuditLedger(paths.auditDbPath);
  const ctx = { ledger, sessionId: `atrium-${Date.now()}`, agentId: 'batiste-fm' };

  const client = await getGoogleClient([DRIVE_FILE_SCOPE]);
  const uploaded = await withAudit(
    ctx,
    'fm.sync.push',
    {
      bundle_name: bundleName,
      folder_id: opts.folderId,
      size_bytes: onDisk.length,
      sha256_ciphertext: sha,
    },
    () => uploadBundle(client, opts.folderId, bundleName, onDisk),
  );

  section('Upload summary');
  kv('Drive file ID', gray(uploaded.id));
  kv('Drive name', cyan(uploaded.name));
  kv('Size (bytes)', String(onDisk.length));
  kv('SHA-256', gray(sha));
  kv('Audit ledger', gray(paths.auditDbPath));
  ok('sync drive push complete.');
}

export async function runRestore(opts: RestoreOptions): Promise<void> {
  const paths = resolvePaths();
  const passphrase = await resolvePassphrase(opts);

  section('Atrium · sync drive restore');
  kv('Folder ID', gray(opts.folderId));
  kv('Bundle', cyan(opts.bundleName));
  kv('Target dir', gray(opts.targetDir));
  kv('Confirm overwrite', opts.confirm ? yellow('yes (live FM root)') : gray('no (sibling dir)'));

  const client = await getGoogleClient([DRIVE_FILE_SCOPE]);
  const list = await listBundleFiles(client, opts.folderId);

  let chosen: DriveListedFile | undefined;
  if (opts.bundleName === 'latest') {
    // listBundleFiles returns modifiedTime desc.
    chosen = list[0];
    if (!chosen) throw new Error(`No bundles found in folder ${opts.folderId}.`);
  } else {
    chosen = list.find((f) => f.name === opts.bundleName);
    if (!chosen) throw new Error(`Bundle "${opts.bundleName}" not found in folder ${opts.folderId}.`);
  }
  kv('Resolved name', cyan(chosen.name));
  kv('Drive file ID', gray(chosen.id));

  const blob = await downloadFile(client, chosen.id);
  const enc = unpackEncrypted(blob);
  const innerGz = decryptBundle({ ...enc, passphrase });
  const files = unpackFmBundle(innerGz);

  const writeTo = opts.confirm ? paths.fmRoot : opts.targetDir;
  if (opts.confirm) {
    warn(`--confirm passed: writing into LIVE FM root ${paths.fmRoot}.`);
  }
  await writeUnpackedBundle(writeTo, files);

  section('Restore summary');
  kv('Files restored', String(files.length));
  kv('Restored to', cyan(writeTo));
  if (!opts.confirm) {
    process.stdout.write(`  ${gray('Manual swap:')} mv ${paths.fmRoot} ${paths.fmRoot}.bak && mv ${opts.targetDir} ${paths.fmRoot}\n`);
  }
  ok('sync drive restore complete.');
}

export async function runStatus(opts: StatusOptions): Promise<void> {
  const client = await getGoogleClient([DRIVE_FILE_SCOPE]);
  const list = await listBundleFiles(client, opts.folderId);

  const annotated = await Promise.all(
    list.map(async (f) => ({
      ...f,
      isBatisteBundle: await probeMagic(client, f.id).catch(() => false),
    })),
  );

  if (opts.json) {
    process.stdout.write(JSON.stringify({ folderId: opts.folderId, bundles: annotated }, null, 2) + '\n');
    return;
  }

  section('Atrium · sync drive status');
  kv('Folder ID', gray(opts.folderId));
  kv('Bundles found', String(annotated.length));
  process.stdout.write('\n');
  if (annotated.length === 0) {
    process.stdout.write(`  ${gray('(folder is empty)')}\n`);
    return;
  }
  process.stdout.write(`  ${bold('encrypted'.padEnd(11))} ${bold('size'.padEnd(12))} ${bold('modifiedTime'.padEnd(26))} ${bold('name')}\n`);
  for (const f of annotated) {
    const enc = f.isBatisteBundle ? green('yes') : yellow('no ');
    const size = (f.size ?? '-').padEnd(12);
    const mt = (f.modifiedTime ?? '-').padEnd(26);
    process.stdout.write(`  ${enc.padEnd(11 + 9 /* ansi length pad */)} ${size} ${mt} ${f.name}\n`);
  }
}

export function registerSyncDrive(parent: Command): void {
  const drive = parent
    .command('drive')
    .description('Encrypted DR mirror of Firm Memory to a Google Drive folder (push/restore/status)');

  drive
    .command('push')
    .description('Pack + encrypt the local FM and upload to the configured Drive folder')
    .option('--folder-id <id>', 'Drive folder ID where the encrypted bundle goes')
    .option('--passphrase-env <var>', 'env var holding the passphrase', DEFAULT_PASSPHRASE_ENV)
    .option('--keychain', 'read passphrase from macOS Keychain (account: fm-passphrase)', false)
    .option('--bundle-name <name>', 'output filename in Drive (default: fm-snapshot-<ISO_DATE>.bin)')
    .option('--include-models', 'include the embedder models in the bundle (default false; bigger)', false)
    .option('--dry-run', "pack + encrypt but don't upload; print bundle path + size", false)
    .action(async (opts: {
      folderId?: string;
      passphraseEnv: string;
      keychain: boolean;
      bundleName?: string;
      includeModels: boolean;
      dryRun: boolean;
    }) => {
      if (!opts.folderId && !opts.dryRun) {
        fail('--folder-id is required for non-dry-run push.');
        process.exitCode = 1;
        return;
      }
      await runPush({
        folderId: opts.folderId ?? 'dry-run-no-folder',
        passphraseEnv: opts.passphraseEnv,
        keychain: opts.keychain,
        bundleName: opts.bundleName,
        includeModels: opts.includeModels,
        dryRun: opts.dryRun,
      });
    });

  drive
    .command('restore')
    .description('Download an encrypted bundle from Drive and unpack it locally')
    .option('--bundle-name <name>', "Drive filename to restore (or 'latest' to pick the newest)")
    .option('--folder-id <id>', 'Drive folder ID')
    .option('--passphrase-env <var>', 'env var holding the passphrase', DEFAULT_PASSPHRASE_ENV)
    .option('--keychain', 'read passphrase from macOS Keychain (account: fm-passphrase)', false)
    .option('--target-dir <path>', 'where to restore', DEFAULT_RESTORE_DIR)
    .option('--confirm', 'required to actually overwrite ~/.batiste/firm-memory/', false)
    .action(async (opts: {
      bundleName?: string;
      folderId?: string;
      passphraseEnv: string;
      keychain: boolean;
      targetDir: string;
      confirm: boolean;
    }) => {
      if (!opts.folderId) {
        fail('--folder-id is required.');
        process.exitCode = 1;
        return;
      }
      if (!opts.bundleName) {
        fail('--bundle-name is required (use "latest" to pick newest).');
        process.exitCode = 1;
        return;
      }
      await runRestore({
        folderId: opts.folderId,
        bundleName: opts.bundleName,
        passphraseEnv: opts.passphraseEnv,
        keychain: opts.keychain,
        targetDir: opts.targetDir,
        confirm: opts.confirm,
      });
    });

  drive
    .command('status')
    .description('List bundles in the Drive folder and flag which look like Batiste bundles')
    .option('--folder-id <id>', 'Drive folder ID')
    .option('--json', 'emit JSON instead of a table', false)
    .action(async (opts: { folderId?: string; json: boolean }) => {
      if (!opts.folderId) {
        fail('--folder-id is required.');
        process.exitCode = 1;
        return;
      }
      await runStatus({ folderId: opts.folderId, json: opts.json });
    });
}
