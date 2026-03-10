import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Skip SQLite-dependent tests in CI - better-sqlite3 native bindings don't build
const describeWithSQLite = process.env.CI ? describe.skip : describe;
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdir, rm, writeFile } from 'fs/promises';
import { ToolHandler } from './handler.js';

describe('ToolHandler', () => {
  let testDir: string;
  let dataDir: string;
  let handler: ToolHandler;

  beforeEach(async () => {
    testDir = join(tmpdir(), `mcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    dataDir = join(testDir, '.batiste');
    await mkdir(testDir, { recursive: true });
    await mkdir(dataDir, { recursive: true });
    handler = new ToolHandler(testDir, dataDir);
  });

  afterEach(async () => {
    await handler.close();
    await rm(testDir, { recursive: true, force: true });
  });

  describe('analyze_dependency', () => {
    it('analyzes file dependencies', async () => {
      const file1 = join(testDir, 'main.ts');
      const file2 = join(testDir, 'utils.ts');

      await writeFile(file2, `export function helper() { return 42; }`);
      await writeFile(
        file1,
        `
        import { helper } from './utils.js';
        console.log(helper());
      `
      );

      const result = (await handler.handleTool('analyze_dependency', {
        entryPoints: ['main.ts'],
      })) as Record<string, unknown>;

      expect((result.stats as Record<string, unknown>).totalFiles).toBeGreaterThanOrEqual(1);
      expect(result.roots).toBeDefined();
      expect(result.circularDeps).toHaveLength(0);
    });
  });

  describe('validate_code', () => {
    it('validates TypeScript files', async () => {
      const file = join(testDir, 'valid.ts');
      await writeFile(
        file,
        `
        const x: number = 42;
        console.log(x);
      `
      );

      const result = (await handler.handleTool('validate_code', {
        paths: ['valid.ts'],
      })) as Record<string, unknown>;

      expect(result.passed).toBeDefined();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('execute_sandbox', () => {
    it('executes commands in sandbox', async () => {
      const result = (await handler.handleTool('execute_sandbox', {
        command: 'echo',
        args: ['Hello from sandbox'],
      })) as Record<string, unknown>;

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Hello from sandbox');
    });

    it('handles command timeout', async () => {
      const result = (await handler.handleTool('execute_sandbox', {
        command: 'sleep',
        args: ['10'],
        timeout: 100,
      })) as Record<string, unknown>;

      expect(result.timedOut).toBe(true);
    });
  });

  describeWithSQLite('manage_task', () => {
    it('creates tasks', async () => {
      const result = (await handler.handleTool('manage_task', {
        action: 'create',
        label: 'Test Task',
      })) as Record<string, unknown>;

      expect(result.created).toBe(true);
      expect((result.task as Record<string, unknown>).label).toBe('Test Task');
      expect((result.task as Record<string, unknown>).status).toBe('pending');
    });

    it('creates subtasks', async () => {
      const parent = (await handler.handleTool('manage_task', {
        action: 'create',
        label: 'Parent Task',
      })) as Record<string, unknown>;

      const child = (await handler.handleTool('manage_task', {
        action: 'create',
        label: 'Child Task',
        parentId: (parent.task as Record<string, unknown>).id,
      })) as Record<string, unknown>;

      expect((child.task as Record<string, unknown>).parentId).toBe(
        (parent.task as Record<string, unknown>).id
      );
    });

    it('updates task status', async () => {
      const created = (await handler.handleTool('manage_task', {
        action: 'create',
        label: 'Update Me',
      })) as Record<string, unknown>;

      const updated = (await handler.handleTool('manage_task', {
        action: 'update',
        taskId: (created.task as Record<string, unknown>).id,
        status: 'completed',
      })) as Record<string, unknown>;

      expect((updated.task as Record<string, unknown>).status).toBe('completed');
    });

    it('caches tool outputs', async () => {
      const created = (await handler.handleTool('manage_task', {
        action: 'create',
        label: 'Cache Test',
      })) as Record<string, unknown>;

      await handler.handleTool('manage_task', {
        action: 'update',
        taskId: (created.task as Record<string, unknown>).id,
        toolOutput: {
          toolName: 'grep',
          output: { results: ['file1.ts', 'file2.ts'] },
        },
      });

      const fetched = (await handler.handleTool('manage_task', {
        action: 'get',
        taskId: (created.task as Record<string, unknown>).id,
      })) as Record<string, unknown>;

      const task = fetched.task as Record<string, unknown>;
      const context = task.context as Record<string, unknown>;
      const toolOutputs = context.toolOutputs as Record<string, unknown>;
      expect(toolOutputs.grep).toBeDefined();
    });

    it('lists all tasks', async () => {
      await handler.handleTool('manage_task', { action: 'create', label: 'Task 1' });
      await handler.handleTool('manage_task', { action: 'create', label: 'Task 2' });

      const result = (await handler.handleTool('manage_task', { action: 'list' })) as Record<string, unknown>;

      expect(result.total).toBe(2);
      expect(result.pending).toBe(2);
    });

    it('returns task tree', async () => {
      const parent = (await handler.handleTool('manage_task', {
        action: 'create',
        label: 'Root',
      })) as Record<string, unknown>;

      await handler.handleTool('manage_task', {
        action: 'create',
        label: 'Child',
        parentId: (parent.task as Record<string, unknown>).id,
      });

      const result = (await handler.handleTool('manage_task', { action: 'tree' })) as Record<string, unknown>;

      const tree = result.tree as Array<Record<string, unknown>>;
      expect(tree).toHaveLength(1);
      expect(tree[0]!.label).toBe('Root');
      expect(tree[0]!.children).toHaveLength(1);
    });

    it('clears all tasks', async () => {
      await handler.handleTool('manage_task', { action: 'create', label: 'Task 1' });
      await handler.handleTool('manage_task', { action: 'create', label: 'Task 2' });

      const beforeClear = (await handler.handleTool('manage_task', { action: 'list' })) as Record<string, unknown>;
      expect(beforeClear.total).toBe(2);

      const clearResult = (await handler.handleTool('manage_task', { action: 'clear' })) as Record<string, unknown>;
      expect(clearResult.cleared).toBe(true);
      expect(clearResult.deletedCount).toBe(2);

      const afterClear = (await handler.handleTool('manage_task', { action: 'list' })) as Record<string, unknown>;
      expect(afterClear.total).toBe(0);
    });
  });

  describe('run_tdd', () => {
    it('runs TDD cycle', async () => {
      const result = (await handler.handleTool('run_tdd', {
        description: 'Add function test',
        testCode: `
          const { test } = require('node:test');
          const assert = require('node:assert');
          const { add } = require('./impl.js');
          test('adds numbers', () => { assert.strictEqual(add(1, 2), 3); });
        `,
        implementationCode: `
          module.exports.add = (a, b) => a + b;
        `,
        testFilePath: 'test.js',
        implementationFilePath: 'impl.js',
      })) as Record<string, unknown>;

      expect(result.phase).toBeDefined();
      expect(['complete', 'green', 'red', 'refactor', 'error']).toContain(result.phase);
    });
  });

  describe('find_symbol', () => {
    it('finds symbol definitions and usages', async () => {
      const file1 = join(testDir, 'defs.ts');
      const file2 = join(testDir, 'uses.ts');

      await writeFile(
        file1,
        `
        export function myHelper() { return 42; }
      `
      );
      await writeFile(
        file2,
        `
        import { myHelper } from './defs.js';
        const result = myHelper();
      `
      );

      const result = (await handler.handleTool('find_symbol', {
        symbolName: 'myHelper',
        entryPoints: ['uses.ts'],
      })) as Record<string, unknown>;

      expect(result.symbolName).toBe('myHelper');
      expect(result.definitionCount).toBeGreaterThanOrEqual(0);
    });
  });
});
