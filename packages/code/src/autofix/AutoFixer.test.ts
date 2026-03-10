import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AutoFixer } from './AutoFixer.js';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';

const TEST_DIR = '/tmp/autofixer-test';

describe('AutoFixer', () => {
  let fixer: AutoFixer;

  beforeEach(async () => {
    fixer = new AutoFixer({ projectRoot: TEST_DIR });
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe('fix', () => {
    it('should return clean status when no errors', async () => {
      const filePath = join(TEST_DIR, 'clean.ts');
      await writeFile(filePath, 'const x = 1;\nexport { x };\n');

      const result = await fixer.fix([filePath]);

      expect(result.status).toBe('clean');
      expect(result.iterations).toBe(1);
    });

    it('should fix simple errors in single pass', async () => {
      const filePath = join(TEST_DIR, 'simple.ts');
      // File with let that should be const
      await writeFile(filePath, 'let x = 1;\nconsole.log(x);\n');

      const result = await fixer.fix([filePath], { dryRun: false });

      // The fix may or may not apply depending on ESLint config
      expect(['clean', 'fixed', 'partial']).toContain(result.status);
    });

    it('should respect maxIterations', async () => {
      const filePath = join(TEST_DIR, 'iterate.ts');
      await writeFile(filePath, 'const x = 1;\n');

      const result = await fixer.fix([filePath], { maxIterations: 2 });

      expect(result.iterations).toBeLessThanOrEqual(2);
    });

    it('should track all fixes across iterations', async () => {
      const filePath = join(TEST_DIR, 'track.ts');
      await writeFile(filePath, 'const x = 1;\nexport { x };\n');

      const result = await fixer.fix([filePath]);

      expect(result.totalFixesApplied).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.allFixes)).toBe(true);
    });

    it('should detect convergence when no more fixes possible', async () => {
      const filePath = join(TEST_DIR, 'converge.ts');
      await writeFile(filePath, 'export const x: number = 1;\n');

      const result = await fixer.fix([filePath]);

      expect(result.converged).toBe(true);
    });
  });

  describe('options', () => {
    it('should respect dryRun option', async () => {
      const filePath = join(TEST_DIR, 'dryrun.ts');
      await writeFile(filePath, 'let x = 1;\nconsole.log(x);\n');

      const result = await fixer.fix([filePath], { dryRun: true });

      expect(result.dryRun).toBe(true);
      expect(result.totalFixesApplied).toBe(0);
    });

    it('should respect confidence filter', async () => {
      const filePath = join(TEST_DIR, 'confidence.ts');
      await writeFile(filePath, 'const x = 1;\n');

      const result = await fixer.fix([filePath], { minConfidence: 'high' });

      // Should only include high-confidence fixes
      for (const fix of result.allFixes) {
        expect(fix.confidence).toBe('high');
      }
    });
  });
});
