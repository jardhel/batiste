import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FixGenerator, FixSuggestion } from './FixGenerator.js';
import { ValidationError } from '../validation/types.js';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';

const TEST_DIR = '/tmp/fix-generator-test';

describe('FixGenerator', () => {
  let generator: FixGenerator;

  beforeEach(async () => {
    generator = new FixGenerator();
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe('generateFixes', () => {
    it('should generate fix for missing semicolon', async () => {
      const filePath = join(TEST_DIR, 'test.ts');
      await writeFile(filePath, 'const x = 1\nconst y = 2;\n');

      const errors: ValidationError[] = [{
        file: filePath,
        line: 1,
        column: 12,
        message: 'Missing semicolon.',
        rule: 'semi',
        severity: 'error',
      }];

      const fixes = await generator.generateFixes(errors);

      expect(fixes).toHaveLength(1);
      expect(fixes[0]!.file).toBe(filePath);
      expect(fixes[0]!.line).toBe(1);
      expect(fixes[0]!.replacement).toBe('const x = 1;');
    });

    it('should generate fix for unused variable (remove line)', async () => {
      const filePath = join(TEST_DIR, 'test.ts');
      await writeFile(filePath, 'const unused = 1;\nconst used = 2;\nconsole.log(used);\n');

      const errors: ValidationError[] = [{
        file: filePath,
        line: 1,
        column: 7,
        message: "'unused' is declared but its value is never read.",
        rule: '@typescript-eslint/no-unused-vars',
        severity: 'error',
      }];

      const fixes = await generator.generateFixes(errors);

      expect(fixes).toHaveLength(1);
      expect(fixes[0]!.action).toBe('remove');
      expect(fixes[0]!.line).toBe(1);
    });

    it('should generate fix for missing return type', async () => {
      const filePath = join(TEST_DIR, 'test.ts');
      await writeFile(filePath, 'function greet(name: string) {\n  return `Hello ${name}`;\n}\n');

      const errors: ValidationError[] = [{
        file: filePath,
        line: 1,
        column: 1,
        message: "Missing return type on function.",
        rule: '@typescript-eslint/explicit-function-return-type',
        severity: 'error',
      }];

      const fixes = await generator.generateFixes(errors);

      expect(fixes).toHaveLength(1);
      expect(fixes[0]!.replacement).toContain(': string');
    });

    it('should handle non-existent file gracefully', async () => {
      const errors: ValidationError[] = [{
        file: '/nonexistent/file.ts',
        line: 1,
        column: 1,
        message: 'Some error',
        severity: 'error',
      }];

      const fixes = await generator.generateFixes(errors);

      expect(fixes).toHaveLength(0);
    });

    it('should generate fix for prefer-const', async () => {
      const filePath = join(TEST_DIR, 'test.ts');
      await writeFile(filePath, 'let x = 1;\nconsole.log(x);\n');

      const errors: ValidationError[] = [{
        file: filePath,
        line: 1,
        column: 1,
        message: "'x' is never reassigned. Use 'const' instead.",
        rule: 'prefer-const',
        severity: 'error',
      }];

      const fixes = await generator.generateFixes(errors);

      expect(fixes).toHaveLength(1);
      expect(fixes[0]!.replacement).toBe('const x = 1;');
    });

    it('should return empty array for unknown error type', async () => {
      const filePath = join(TEST_DIR, 'test.ts');
      await writeFile(filePath, 'const x = 1;\n');

      const errors: ValidationError[] = [{
        file: filePath,
        line: 1,
        column: 1,
        message: 'Some custom unknown error',
        severity: 'error',
      }];

      const fixes = await generator.generateFixes(errors);

      // Should either return empty or return a suggestion with confidence 'low'
      if (fixes.length > 0) {
        expect(fixes[0]!.confidence).toBe('low');
      }
    });
  });

  describe('applyFixes', () => {
    it('should apply replacement fix to file', async () => {
      const filePath = join(TEST_DIR, 'test.ts');
      await writeFile(filePath, 'let x = 1;\nconsole.log(x);\n');

      const fixes: FixSuggestion[] = [{
        file: filePath,
        line: 1,
        action: 'replace',
        replacement: 'const x = 1;',
        confidence: 'high',
        description: 'Use const instead of let',
      }];

      await generator.applyFixes(fixes);

      const { readFile } = await import('fs/promises');
      const content = await readFile(filePath, 'utf-8');
      expect(content).toBe('const x = 1;\nconsole.log(x);\n');
    });

    it('should apply remove fix to file', async () => {
      const filePath = join(TEST_DIR, 'test.ts');
      await writeFile(filePath, 'const unused = 1;\nconst used = 2;\nconsole.log(used);\n');

      const fixes: FixSuggestion[] = [{
        file: filePath,
        line: 1,
        action: 'remove',
        confidence: 'high',
        description: 'Remove unused variable',
      }];

      await generator.applyFixes(fixes);

      const { readFile } = await import('fs/promises');
      const content = await readFile(filePath, 'utf-8');
      expect(content).toBe('const used = 2;\nconsole.log(used);\n');
    });
  });
});
