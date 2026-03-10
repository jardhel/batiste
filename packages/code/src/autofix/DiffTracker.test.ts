import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DiffTracker } from './DiffTracker.js';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('DiffTracker', () => {
  let tracker: DiffTracker;
  let testDir: string;

  beforeEach(() => {
    tracker = new DiffTracker();
    testDir = join(tmpdir(), `difftracker-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('snapshot', () => {
    it('should capture file content as snapshot', async () => {
      const filePath = join(testDir, 'test.ts');
      writeFileSync(filePath, 'const x = 1;\n');

      await tracker.snapshot([filePath]);

      expect(tracker.hasSnapshot(filePath)).toBe(true);
    });

    it('should capture multiple files', async () => {
      const file1 = join(testDir, 'a.ts');
      const file2 = join(testDir, 'b.ts');
      writeFileSync(file1, 'const a = 1;\n');
      writeFileSync(file2, 'const b = 2;\n');

      await tracker.snapshot([file1, file2]);

      expect(tracker.hasSnapshot(file1)).toBe(true);
      expect(tracker.hasSnapshot(file2)).toBe(true);
    });

    it('should handle non-existent files gracefully', async () => {
      const filePath = join(testDir, 'nonexistent.ts');

      await tracker.snapshot([filePath]);

      expect(tracker.hasSnapshot(filePath)).toBe(false);
    });
  });

  describe('diff', () => {
    it('should detect no changes when file unchanged', async () => {
      const filePath = join(testDir, 'unchanged.ts');
      writeFileSync(filePath, 'const x = 1;\n');

      await tracker.snapshot([filePath]);
      const diffs = await tracker.diff();

      expect(diffs).toHaveLength(0);
    });

    it('should detect line changes', async () => {
      const filePath = join(testDir, 'changed.ts');
      writeFileSync(filePath, 'const x = 1;\n');

      await tracker.snapshot([filePath]);

      // Modify the file
      writeFileSync(filePath, 'const x: number = 1;\n');

      const diffs = await tracker.diff();

      expect(diffs).toHaveLength(1);
      expect(diffs[0]!.file).toBe(filePath);
      expect(diffs[0]!.changes).toHaveLength(1);
      expect(diffs[0]!.changes[0]!.before).toBe('const x = 1;');
      expect(diffs[0]!.changes[0]!.after).toBe('const x: number = 1;');
    });

    it('should detect added lines', async () => {
      const filePath = join(testDir, 'added.ts');
      writeFileSync(filePath, 'const x = 1;\n');

      await tracker.snapshot([filePath]);
      writeFileSync(filePath, 'const x = 1;\nconst y = 2;\n');

      const diffs = await tracker.diff();

      expect(diffs).toHaveLength(1);
      const addedLines = diffs[0]!.changes.filter(c => c.type === 'add');
      expect(addedLines.length).toBeGreaterThan(0);
    });

    it('should detect removed lines', async () => {
      const filePath = join(testDir, 'removed.ts');
      writeFileSync(filePath, 'const x = 1;\nconst y = 2;\n');

      await tracker.snapshot([filePath]);
      writeFileSync(filePath, 'const x = 1;\n');

      const diffs = await tracker.diff();

      expect(diffs).toHaveLength(1);
      const removedLines = diffs[0]!.changes.filter(c => c.type === 'remove');
      expect(removedLines.length).toBeGreaterThan(0);
    });
  });

  describe('getSummary', () => {
    it('should return human-readable summary', async () => {
      const filePath = join(testDir, 'summary.ts');
      writeFileSync(filePath, 'const x = 1;\n');

      await tracker.snapshot([filePath]);
      writeFileSync(filePath, 'const x: number = 1;\nconst y = 2;\n');

      const diffs = await tracker.diff();
      const summary = tracker.getSummary(diffs);

      expect(summary).toContain('1 file');
      expect(summary).toMatch(/\d+ change/);
    });
  });

  describe('reset', () => {
    it('should clear all snapshots', async () => {
      const filePath = join(testDir, 'reset.ts');
      writeFileSync(filePath, 'const x = 1;\n');

      await tracker.snapshot([filePath]);
      expect(tracker.hasSnapshot(filePath)).toBe(true);

      tracker.reset();
      expect(tracker.hasSnapshot(filePath)).toBe(false);
    });
  });
});
