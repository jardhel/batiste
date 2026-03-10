import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileWatcher } from './file-watcher.js';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('FileWatcher', () => {
  let testDir: string;
  let watcher: FileWatcher;

  beforeEach(async () => {
    testDir = join(tmpdir(), `file-watcher-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    if (watcher) {
      await watcher.stop();
    }
    await rm(testDir, { recursive: true, force: true });
  });

  it('should initialize and start watching', async () => {
    watcher = new FileWatcher(testDir, { debounceMs: 100 });
    await watcher.start();
    expect(watcher.isWatching()).toBe(true);
  });

  it('should stop watching', async () => {
    watcher = new FileWatcher(testDir, { debounceMs: 100 });
    await watcher.start();
    await watcher.stop();
    expect(watcher.isWatching()).toBe(false);
  });

  it('should emit change event on file modification', async () => {
    const changes: string[] = [];
    watcher = new FileWatcher(testDir, { debounceMs: 50 });
    watcher.on('change', (files) => changes.push(...files));
    await watcher.start();

    // Create a file
    const testFile = join(testDir, 'test.ts');
    await writeFile(testFile, 'const x = 1;');

    // Wait for debounce
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(changes.length).toBeGreaterThan(0);
    expect(changes.some(f => f.includes('test.ts'))).toBe(true);
  });

  it('should debounce rapid changes', async () => {
    let callCount = 0;
    watcher = new FileWatcher(testDir, { debounceMs: 100 });
    watcher.on('change', () => callCount++);
    await watcher.start();

    // Rapid file changes
    const testFile = join(testDir, 'rapid.ts');
    await writeFile(testFile, 'v1');
    await writeFile(testFile, 'v2');
    await writeFile(testFile, 'v3');

    // Wait for debounce to settle
    await new Promise(resolve => setTimeout(resolve, 300));

    // Should have debounced to fewer calls
    expect(callCount).toBeLessThanOrEqual(2);
  });

  it('should ignore patterns', async () => {
    const changes: string[] = [];
    watcher = new FileWatcher(testDir, {
      debounceMs: 50,
      ignorePatterns: ['**/*.log', '**/node_modules/**']
    });
    watcher.on('change', (files) => changes.push(...files));
    await watcher.start();

    // Create ignored file
    await writeFile(join(testDir, 'test.log'), 'log content');

    // Create watched file
    await writeFile(join(testDir, 'test.ts'), 'const x = 1;');

    await new Promise(resolve => setTimeout(resolve, 200));

    expect(changes.some(f => f.includes('.log'))).toBe(false);
    expect(changes.some(f => f.includes('.ts'))).toBe(true);
  });
});
