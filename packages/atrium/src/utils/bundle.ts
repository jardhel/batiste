/**
 * Pack / unpack the Firm Memory data directory into a single buffer for
 * the disaster-recovery mirror.
 *
 * Format choice: a custom binary container, NOT tar. Rationale:
 *
 *   - We control both endpoints (this codebase writes AND reads). There
 *     is zero interop benefit to tar — we never expect another tool to
 *     extract these bundles, because the file is encrypted with a
 *     passphrase only the operator holds (see crypt.ts).
 *   - A real tar writer requires either a npm dep or ~150 lines of
 *     POSIX/USTAR header math (file mode, owner, checksum, padding to
 *     512-byte blocks). The constraint says "no npm deps".
 *   - The custom format below is ~30 lines, deterministic byte-for-byte,
 *     and trivially round-trips through the test harness. Files are
 *     concatenated verbatim with a tiny header per entry, then the whole
 *     stream is gzipped to recover compression for the SQLite databases
 *     (which compress well — lots of zero-padded pages).
 *
 * Container layout (BEFORE gzip wrap):
 *
 *   ┌────────────────────────────────────────────────────────┐
 *   │ "BTSTBND1"   8 bytes  (cleartext magic, distinct from  │
 *   │                        the encrypted-file magic)       │
 *   │ u32_le       4 bytes  file_count                       │
 *   │ for each file:                                         │
 *   │   u16_le     2 bytes  name_length                      │
 *   │   bytes      N        relative path (utf8)             │
 *   │   u64_le     8 bytes  content_length                   │
 *   │   bytes      M        file content (verbatim)          │
 *   └────────────────────────────────────────────────────────┘
 *
 * Files included in a `sync drive push`:
 *   memory.db, vector/**, .audit/document-audit.db, checkpoints.json
 * Files excluded:
 *   models/** (re-downloadable embedder weights — would 10× the bundle
 *   size for no recovery value; the operator can re-`install` them).
 */

import { gunzipSync, gzipSync } from 'node:zlib';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, posix, relative, sep } from 'node:path';

export const BUNDLE_INNER_MAGIC = Buffer.from('BTSTBND1', 'utf8');

/** Default include list, evaluated relative to the FM root. */
export const DEFAULT_INCLUDES = [
  'memory.db',
  'vector',
  '.audit/document-audit.db',
  'checkpoints.json',
];
export const MODELS_DIR = 'models';

export interface PackOptions {
  /** Roots (relative paths under fmRoot) to include. */
  includes?: string[];
  /** Add the embedder model weights (default false; large). */
  includeModels?: boolean;
}

export interface BundleEntry {
  /** Relative POSIX path inside the bundle (forward slashes always). */
  path: string;
  size: number;
}

export interface PackResult {
  /** gzipped container buffer ready for encryption. */
  buffer: Buffer;
  entries: BundleEntry[];
  /** Raw uncompressed-container size (pre-gzip), for diagnostics. */
  rawBytes: number;
}

async function walkFiles(root: string, rel: string): Promise<string[]> {
  const abs = join(root, rel);
  if (!existsSync(abs)) return [];
  const st = await stat(abs);
  if (st.isFile()) return [rel];
  if (!st.isDirectory()) return [];
  const out: string[] = [];
  const entries = await readdir(abs);
  for (const name of entries) {
    const child = rel === '' ? name : posix.join(rel.split(sep).join('/'), name);
    out.push(...(await walkFiles(root, child)));
  }
  return out;
}

/**
 * Pack a Firm Memory data directory into a gzipped, custom-format buffer.
 * Skips includes that don't exist on disk (fresh deployments may not have
 * a vector/ directory yet — that's fine, we just record what's there).
 */
export async function packFmDir(fmRoot: string, options: PackOptions = {}): Promise<PackResult> {
  const includes = [...(options.includes ?? DEFAULT_INCLUDES)];
  if (options.includeModels) includes.push(MODELS_DIR);

  const allRelPaths: string[] = [];
  for (const inc of includes) {
    const found = await walkFiles(fmRoot, inc);
    allRelPaths.push(...found);
  }
  // Deterministic order — makes test expectations stable.
  allRelPaths.sort();

  const headers: Buffer[] = [];
  const bodies: Buffer[] = [];
  const entries: BundleEntry[] = [];

  for (const rel of allRelPaths) {
    const abs = join(fmRoot, rel.split('/').join(sep));
    const content = await readFile(abs);
    const nameBuf = Buffer.from(rel, 'utf8');
    if (nameBuf.length > 0xffff) {
      throw new Error(`Path too long for bundle format: ${rel}`);
    }
    const header = Buffer.alloc(2 + nameBuf.length + 8);
    header.writeUInt16LE(nameBuf.length, 0);
    nameBuf.copy(header, 2);
    header.writeBigUInt64LE(BigInt(content.length), 2 + nameBuf.length);
    headers.push(header);
    bodies.push(content);
    entries.push({ path: rel, size: content.length });
  }

  const countBuf = Buffer.alloc(4);
  countBuf.writeUInt32LE(allRelPaths.length, 0);

  const interleaved: Buffer[] = [];
  for (let i = 0; i < headers.length; i++) {
    interleaved.push(headers[i] as Buffer, bodies[i] as Buffer);
  }
  const raw = Buffer.concat([BUNDLE_INNER_MAGIC, countBuf, ...interleaved]);
  const compressed = gzipSync(raw);
  return { buffer: compressed, entries, rawBytes: raw.length };
}

export interface UnpackedFile {
  path: string;
  content: Buffer;
}

/**
 * Inverse of `packFmDir`: gunzip then walk the custom format. Returns the
 * file list in memory; caller decides where to write them.
 */
export function unpackFmBundle(buf: Buffer): UnpackedFile[] {
  const raw = gunzipSync(buf);
  if (raw.length < BUNDLE_INNER_MAGIC.length + 4) {
    throw new Error('Bundle inner stream too small to contain header.');
  }
  const magic = raw.subarray(0, BUNDLE_INNER_MAGIC.length);
  if (!magic.equals(BUNDLE_INNER_MAGIC)) {
    throw new Error(
      `Bad inner magic: expected ${BUNDLE_INNER_MAGIC.toString('utf8')}, got ${magic.toString('utf8')}.`,
    );
  }
  let offset = BUNDLE_INNER_MAGIC.length;
  const count = raw.readUInt32LE(offset);
  offset += 4;
  const files: UnpackedFile[] = [];
  for (let i = 0; i < count; i++) {
    if (offset + 2 > raw.length) throw new Error('Truncated bundle (header).');
    const nameLen = raw.readUInt16LE(offset);
    offset += 2;
    if (offset + nameLen > raw.length) throw new Error('Truncated bundle (name).');
    const path = raw.subarray(offset, offset + nameLen).toString('utf8');
    offset += nameLen;
    if (offset + 8 > raw.length) throw new Error('Truncated bundle (size).');
    const sizeBig = raw.readBigUInt64LE(offset);
    offset += 8;
    const size = Number(sizeBig);
    if (!Number.isSafeInteger(size)) throw new Error(`Bundle entry size out of range: ${path}`);
    if (offset + size > raw.length) throw new Error(`Truncated bundle (content of ${path}).`);
    const content = raw.subarray(offset, offset + size);
    offset += size;
    files.push({ path, content: Buffer.from(content) });
  }
  return files;
}

/**
 * Materialize an unpacked bundle to disk under `targetDir`. Refuses to
 * traverse outside the target via `..` or absolute paths.
 */
export async function writeUnpackedBundle(targetDir: string, files: UnpackedFile[]): Promise<void> {
  if (!existsSync(targetDir)) await mkdir(targetDir, { recursive: true });
  for (const f of files) {
    if (f.path.startsWith('/') || f.path.includes('..')) {
      throw new Error(`Refusing to write suspicious bundle path: ${f.path}`);
    }
    const abs = join(targetDir, f.path.split('/').join(sep));
    const within = relative(targetDir, abs);
    if (within.startsWith('..') || within.startsWith(sep + '..')) {
      throw new Error(`Bundle path escapes target dir: ${f.path}`);
    }
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, f.content);
  }
}
