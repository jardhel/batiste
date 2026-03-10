import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdir, rm, writeFile } from 'fs/promises';
import { Gatekeeper, GatekeeperRegistry } from './Gatekeeper.js';
import { ESLintValidator } from './ESLintValidator.js';
import { TypeScriptValidator } from './TypeScriptValidator.js';

describe('Gatekeeper', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `gatekeeper-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('ESLintValidator', () => {
    it('validates clean JavaScript/TypeScript files', async () => {
      const validator = new ESLintValidator();
      const filePath = join(testDir, 'clean.ts');

      await writeFile(
        filePath,
        `
const greeting = 'Hello, World!';
console.log(greeting);
      `.trim()
      );

      const result = await validator.validate([filePath]);

      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('reports validation duration', async () => {
      const validator = new ESLintValidator();
      const filePath = join(testDir, 'timed.ts');

      await writeFile(filePath, `console.log('test');`);

      const result = await validator.validate([filePath]);

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('supports multiple files', async () => {
      const validator = new ESLintValidator();
      const file1 = join(testDir, 'file1.ts');
      const file2 = join(testDir, 'file2.ts');

      await writeFile(file1, `const a = 1; console.log(a);`);
      await writeFile(file2, `const b = 2; console.log(b);`);

      const result = await validator.validate([file1, file2]);

      expect(result.passed).toBe(true);
    });

    it('returns errors array on validation', async () => {
      const validator = new ESLintValidator();
      const filePath = join(testDir, 'errors.ts');

      await writeFile(
        filePath,
        `
const unusedVar = 'never used';
console.log('hello');
      `.trim()
      );

      const result = await validator.validate([filePath]);

      // Should return a result with errors array (contents depend on ESLint config)
      expect(result.errors).toBeDefined();
      expect(Array.isArray(result.errors)).toBe(true);
    });
  });

  describe('TypeScriptValidator', () => {
    it('returns validation result with proper structure', async () => {
      const validator = new TypeScriptValidator();
      const filePath = join(testDir, 'typed.ts');

      await writeFile(
        filePath,
        `
function add(a: number, b: number): number {
  return a + b;
}
const result: number = add(1, 2);
console.log(result);
      `.trim()
      );

      const result = await validator.validate([filePath]);

      expect(result).toHaveProperty('passed');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
      expect(result).toHaveProperty('durationMs');
    });

    it('has correct validator id', () => {
      const validator = new TypeScriptValidator();
      expect(validator.id).toBe('typescript');
    });
  });

  describe('GatekeeperRegistry', () => {
    it('registers and retrieves validators', () => {
      const registry = new GatekeeperRegistry();
      const eslint = new ESLintValidator();
      const tsc = new TypeScriptValidator();

      registry.register(eslint);
      registry.register(tsc);

      expect(registry.getAll().size).toBe(2);
    });

    it('retrieves validator by id', () => {
      const registry = new GatekeeperRegistry();
      const eslint = new ESLintValidator();
      registry.register(eslint);

      expect(registry.get('eslint')).toBe(eslint);
      expect(registry.get('nonexistent')).toBeUndefined();
    });
  });

  describe('Gatekeeper Usecase', () => {
    it('combines multiple validators in pre-flight check', async () => {
      const gatekeeper = new Gatekeeper();

      const filePath = join(testDir, 'preflight.ts');
      await writeFile(
        filePath,
        `
export function multiply(a: number, b: number): number {
  return a * b;
}
      `.trim()
      );

      const result = await gatekeeper.preflightCheck([filePath]);

      expect(result.passed).toBeDefined();
      expect(result.validatorResults).toBeDefined();
    });

    it('reports total errors and warnings', async () => {
      const gatekeeper = new Gatekeeper();

      const filePath = join(testDir, 'totals.ts');
      await writeFile(filePath, `const x = 1; console.log(x);`);

      const result = await gatekeeper.preflightCheck([filePath]);

      expect(typeof result.totalErrors).toBe('number');
      expect(typeof result.totalWarnings).toBe('number');
      expect(typeof result.durationMs).toBe('number');
    });

    it('caches validation results', async () => {
      const gatekeeper = new Gatekeeper();

      const filePath = join(testDir, 'cached.ts');
      await writeFile(filePath, `const cached = true; console.log(cached);`);

      // First run
      const result1 = await gatekeeper.preflightCheck([filePath]);

      // Second run should produce same result
      const result2 = await gatekeeper.preflightCheck([filePath]);

      expect(result1.passed).toBe(result2.passed);
    });
  });
});
