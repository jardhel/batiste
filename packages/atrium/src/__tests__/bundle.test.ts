/**
 * Pack/unpack tests for utils/bundle.ts.
 *
 * Coverage:
 *   - pack a tmpdir tree (mixed text + binary), unpack into a sibling
 *     tmpdir, verify byte-for-byte equality + sizes
 *   - file count matches what we wrote
 *   - excludes work (models/ skipped by default, included with flag)
 *   - traversal-defense: writeUnpackedBundle refuses paths containing ..
 */

import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { packFmDir, unpackFmBundle, writeUnpackedBundle } from '../utils/bundle.js';

const tmpRoots: string[] = [];
async function newTmp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

afterAll(async () => {
  // Best effort — don't fail tests on cleanup. macOS tmpdir is auto-purged.
  for (const _ of tmpRoots) void _;
});

async function seedFmDir(root: string): Promise<{ paths: string[]; sizes: Record<string, number> }> {
  const layout: Record<string, Buffer> = {
    'memory.db': randomBytes(4096),
    'checkpoints.json': Buffer.from(JSON.stringify({ drive: { 'folder-x': '2026-01-01T00:00:00Z' } }), 'utf8'),
    'vector/index.bin': randomBytes(2048),
    'vector/manifest.json': Buffer.from('{"dim":768}', 'utf8'),
    '.audit/document-audit.db': randomBytes(1024),
  };
  const sizes: Record<string, number> = {};
  for (const [rel, content] of Object.entries(layout)) {
    const abs = join(root, rel);
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, content);
    sizes[rel] = content.length;
  }
  return { paths: Object.keys(layout), sizes };
}

describe('bundle: packFmDir + unpackFmBundle', () => {
  it('round-trips a populated FM dir byte-for-byte', async () => {
    const src = await newTmp('batiste-bundle-src-');
    const seeded = await seedFmDir(src);

    const packed = await packFmDir(src);
    expect(packed.entries).toHaveLength(seeded.paths.length);
    expect(packed.buffer.length).toBeGreaterThan(0);

    // Sizes recorded match the seeded sizes.
    const entrySizes = Object.fromEntries(packed.entries.map((e) => [e.path, e.size]));
    for (const rel of seeded.paths) {
      expect(entrySizes[rel]).toBe(seeded.sizes[rel]);
    }

    const unpacked = unpackFmBundle(packed.buffer);
    expect(unpacked).toHaveLength(seeded.paths.length);

    const dst = await newTmp('batiste-bundle-dst-');
    await writeUnpackedBundle(dst, unpacked);
    for (const rel of seeded.paths) {
      const before = await readFile(join(src, rel));
      const after = await readFile(join(dst, rel));
      expect(after.equals(before)).toBe(true);
    }
  });

  it('skips models/ by default and includes it with --include-models', async () => {
    const src = await newTmp('batiste-bundle-models-');
    await seedFmDir(src);
    await mkdir(join(src, 'models'), { recursive: true });
    await writeFile(join(src, 'models/embedder.bin'), randomBytes(8192));

    const without = await packFmDir(src);
    expect(without.entries.find((e) => e.path.startsWith('models/'))).toBeUndefined();

    const withModels = await packFmDir(src, { includeModels: true });
    expect(withModels.entries.find((e) => e.path === 'models/embedder.bin')).toBeDefined();
    expect(withModels.buffer.length).toBeGreaterThan(without.buffer.length);
  });

  it('quietly skips includes that do not exist on disk', async () => {
    const src = await newTmp('batiste-bundle-missing-');
    // Only create one file — the rest of DEFAULT_INCLUDES are missing.
    await writeFile(join(src, 'memory.db'), randomBytes(64));
    const packed = await packFmDir(src);
    expect(packed.entries).toEqual([{ path: 'memory.db', size: 64 }]);
  });

  it('writeUnpackedBundle refuses traversal paths', async () => {
    const dst = await newTmp('batiste-bundle-traversal-');
    await expect(
      writeUnpackedBundle(dst, [{ path: '../escape.txt', content: Buffer.from('x') }]),
    ).rejects.toThrow(/suspicious|escape/i);
    await expect(
      writeUnpackedBundle(dst, [{ path: '/etc/passwd', content: Buffer.from('x') }]),
    ).rejects.toThrow(/suspicious|escape/i);
  });

  it('unpackFmBundle rejects a non-magic stream', () => {
    const garbage = Buffer.from('not a real bundle');
    // It will try to gunzip first — that throws too. Either way, throws.
    expect(() => unpackFmBundle(garbage)).toThrow();
  });
});
