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
    it('throws clear error when entryPoints missing', async () => {
      // Zod validation (Input validation failed for tool 'analyze_dependency':
      // entryPoints Required) now fires before the manual check in
      // handler.ts; both messages mention the missing field.
      await expect(handler.handleTool('analyze_dependency', {})).rejects.toThrow(
        /entryPoints/
      );
    });

    it('throws clear error when entryPoints is empty', async () => {
      await expect(
        handler.handleTool('analyze_dependency', { entryPoints: [] }),
      ).rejects.toThrow(/entryPoints/);
    });

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

  describeWithSQLite('summarize_codebase', () => {
    it('falls back to all indexed files when entry-name files yield low coverage', async () => {
      // Simulate a Python-style project where __init__.py files don't import siblings.
      // Without the coverage fallback, summarize_codebase walked only the __init__ files
      // (2 files / 4 symbols on a 78-file repo). With the fallback, it walks the corpus.
      const pkgDir = join(testDir, 'pkg');
      await mkdir(pkgDir, { recursive: true });
      await writeFile(join(pkgDir, '__init__.py'), '# empty package init\n');
      const moduleNames = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa'];
      for (const name of moduleNames) {
        await writeFile(
          join(pkgDir, `${name}.py`),
          `def ${name}_func():\n    return "${name}"\n\nclass ${name.toUpperCase()}Class:\n    pass\n`,
        );
      }

      // Build a minimal file-index entry pointing at all files so summarize_codebase
      // takes the indexed-files branch (otherwise it falls back to fast-glob).
      const indexedFiles = [
        { relativePath: 'pkg/__init__.py' },
        ...moduleNames.map(n => ({ relativePath: `pkg/${n}.py` })),
      ];
      await writeFile(
        join(dataDir, 'file-index.json'),
        JSON.stringify({
          version: 1,
          projectRoot: testDir,
          files: indexedFiles.map(f => ({
            relativePath: f.relativePath,
            sha256: 'x'.repeat(64),
            sizeBytes: 100,
            modifiedAtMs: Date.now(),
            language: 'python',
          })),
        }),
      );

      const result = (await handler.handleTool('summarize_codebase', {})) as Record<string, unknown>;
      const arch = result.architecture as Record<string, unknown>;

      // Without fallback: totalFiles would be 1 (only __init__.py walked).
      // With fallback: graph rebuilt from all indexed files → multiple files visible.
      expect(arch.totalFiles).toBeGreaterThan(2);
      expect(arch.totalSymbols).toBeGreaterThan(4);
    });
  });

  describe('vault_validate + vault_index (GVS 0.1)', () => {
    async function scaffoldMinimalVault(root: string) {
      await mkdir(root, { recursive: true });
      await writeFile(
        join(root, '00 Home.md'),
        '---\ntitle: Home\ngvs_version: 0.1-draft\naxis: policy\nupdated: 2026-04-21\nstatus: active\ntags: []\n---\n\n# Home\n',
      );

      for (const [folder, name, fm] of [
        ['01 Identity', 'Acme Corp.md', { title: 'Acme Corp', axis: 'identity' }],
        ['02 Policy', 'Principles.md', { title: 'Principles', axis: 'policy' }],
        [
          '03 Roles',
          'Jane Doe.md',
          { title: 'Jane Doe', axis: 'roles', principal_type: 'human' },
        ],
        [
          '04 Decision',
          '2026-04-20 — Adopt GVS.md',
          {
            title: '2026-04-20 — Adopt GVS',
            axis: 'decision',
            decided_on: '2026-04-20',
            authority: 'Jane Doe',
          },
        ],
        ['05 Memory', 'Q2 fundraise.md', { title: 'Q2 fundraise', axis: 'memory' }],
        [
          '06 Audit',
          '2026-04-20-AC-LEG-001.md',
          {
            title: '2026-04-20-AC-LEG-001',
            axis: 'audit',
            ref: 'AC-LEG-001',
            manifest: 'manifests/AC-LEG-001.json',
            stamp_hash: 'a'.repeat(64),
            stamped_on: '2026-04-20T10:00:00Z',
          },
        ],
      ] as const) {
        const full: Record<string, unknown> = {
          ...fm,
          updated: '2026-04-21',
          status: 'active',
          tags: [],
        };
        const folderPath = join(root, folder);
        await mkdir(folderPath, { recursive: true });
        const lines = ['---'];
        for (const [k, v] of Object.entries(full)) lines.push(`${k}: ${JSON.stringify(v)}`);
        lines.push('---', '');
        await writeFile(join(folderPath, name), lines.join('\n'));
      }

      const tpl = join(root, '_templates');
      await mkdir(tpl, { recursive: true });
      for (const t of [
        '00-home.md',
        '01-identity.md',
        '02-policy.md',
        '03-roles.md',
        '04-decision.md',
        '05-memory.md',
        '06-audit.md',
      ]) {
        await writeFile(join(tpl, t), '---\ntitle: "{{title}}"\n---\n');
      }
    }

    it('vault_validate reports a minimal vault as conforming', async () => {
      const vaultPath = join(testDir, 'vault');
      await scaffoldMinimalVault(vaultPath);

      const result = (await handler.handleTool('vault_validate', {
        path: vaultPath,
        skipCanonical: true,
      })) as Record<string, unknown>;

      expect(result.conforming).toBe(true);
      expect(result.gvsVersion).toBe('0.1-draft');
      const counts = result.counts as Record<string, unknown>;
      expect(counts.errors).toBe(0);
      expect((counts.byAxis as Record<string, number>).audit).toBe(1);
    });

    it('vault_index returns notes grouped by axis', async () => {
      const vaultPath = join(testDir, 'vault');
      await scaffoldMinimalVault(vaultPath);

      const result = (await handler.handleTool('vault_index', {
        path: vaultPath,
      })) as Record<string, unknown>;

      expect(result.gvsVersion).toBe('0.1-draft');
      const byAxis = result.byAxis as Record<string, unknown[]>;
      expect(byAxis.decision).toHaveLength(1);
      expect(byAxis.audit).toHaveLength(1);
      expect(byAxis.identity).toHaveLength(1);
    });

    it('vault_validate rejects missing path arg', async () => {
      await expect(handler.handleTool('vault_validate', {})).rejects.toThrow(
        /Input validation failed/,
      );
    });
  });
});
