import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { GitTracker } from './git-tracker.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, stdio: 'pipe' });

describe('GitTracker command construction (no shell)', () => {
  let dir: string;
  let tracker: GitTracker;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'batiste-gt-'));
    git(dir, 'init', '-q');
    writeFileSync(join(dir, 'a.txt'), 'a');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'init');
    tracker = new GitTracker(dir);
    await tracker.initialize();
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not execute shell metacharacters in file names', async () => {
    const marker = join(dir, 'PWNED');
    const evil = `a.txt"; touch "${marker}"; echo "`;
    expect(await tracker.getFileHash(evil)).toBeNull();
    expect(await tracker.hasUncommittedChanges(evil)).toBe(false);
    expect(existsSync(marker)).toBe(false);
  });

  it('does not execute shell metacharacters in refs', async () => {
    const marker = join(dir, 'PWNED2');
    expect(await tracker.resolveRef(`HEAD; touch "${marker}"`)).toBeNull();
    expect(await tracker.resolveRef(`$(touch "${marker}")`)).toBeNull();
    const diff = await tracker.getDiff(`HEAD; touch "${marker}"`);
    expect(diff.added).toEqual([]);
    expect(existsSync(marker)).toBe(false);
  });

  it('rejects refs that look like git options', async () => {
    expect(await tracker.resolveRef('--output=/tmp/x')).toBeNull();
    const diff = await tracker.getDiff('--output=/tmp/batiste-should-not-exist');
    expect(diff.modified).toEqual([]);
    expect(existsSync('/tmp/batiste-should-not-exist')).toBe(false);
  });

  it('still resolves valid refs and file hashes', async () => {
    expect(await tracker.resolveRef('HEAD')).toMatch(/^[0-9a-f]{40}$/);
    expect(await tracker.getFileHash('a.txt')).toMatch(/^[0-9a-f]{40}$/);
    expect(await tracker.getModifiedSince(new Date(Date.now() - 86_400_000))).toContain('a.txt');
  });
});
