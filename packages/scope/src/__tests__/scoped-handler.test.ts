import { describe, it, expect } from 'vitest';
import { ScopedHandler, ScopeError } from '../scoped-handler.js';
import type { ToolHandler } from '@batiste/core/mcp';
import type { AccessPolicy } from '../types.js';

const mockHandler: ToolHandler = {
  async handleTool(name: string, args: Record<string, unknown>) {
    return { tool: name, args };
  },
};

const policy: AccessPolicy = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'auth-module',
  allowedPaths: ['src/auth/**'],
  deniedPaths: ['**/*.env'],
  maxDepth: 5,
  includeTests: false,
};

describe('ScopedHandler', () => {
  const scoped = new ScopedHandler(mockHandler, policy);

  it('should pass through allowed tool calls', async () => {
    const result = await scoped.handleTool('find_symbol', {
      symbolName: 'login',
      entryPoints: ['src/auth/login.ts'],
    }) as Record<string, unknown>;
    expect(result['tool']).toBe('find_symbol');
  });

  it('should filter array path args to allowed only', async () => {
    const result = await scoped.handleTool('validate_code', {
      paths: ['src/auth/login.ts', 'src/secret/keys.ts'],
    }) as { args: { paths: string[] } };
    // 'src/secret/keys.ts' should be filtered out
    expect(result.args.paths).toEqual(['src/auth/login.ts']);
  });

  it('should throw ScopeError for denied single path', async () => {
    await expect(
      scoped.handleTool('run_tdd', {
        testFilePath: 'src/secret/test.ts',
        implementationFilePath: 'src/auth/impl.ts',
      }),
    ).rejects.toThrow(ScopeError);
  });

  it('should limit maxDepth to policy max', async () => {
    const result = await scoped.handleTool('analyze_dependency', {
      entryPoints: ['src/auth/index.ts'],
      maxDepth: 100,
    }) as { args: { maxDepth: number } };
    expect(result.args.maxDepth).toBe(5);
  });

  it('should filter result definitions', async () => {
    const handler: ToolHandler = {
      async handleTool() {
        return {
          definitions: [
            { name: 'login', file: 'src/auth/login.ts' },
            { name: 'secret', file: 'src/secret/keys.ts' },
          ],
        };
      },
    };
    const scopedH = new ScopedHandler(handler, policy);
    const result = await scopedH.handleTool('find_symbol', {}) as {
      definitions: Array<{ name: string; file: string }>;
    };
    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0]!.name).toBe('login');
  });

  it('should filter result references', async () => {
    const handler: ToolHandler = {
      async handleTool() {
        return {
          references: [
            { file: 'src/auth/handler.ts', line: 10 },
            { file: 'src/api/routes.ts', line: 20 },
          ],
        };
      },
    };
    const scopedH = new ScopedHandler(handler, policy);
    const result = await scopedH.handleTool('find_symbol', {}) as {
      references: Array<{ file: string }>;
    };
    expect(result.references).toHaveLength(1);
  });

  it('should pass through when no file args present', async () => {
    const result = await scoped.handleTool('manage_task', { action: 'list' });
    expect(result).toBeDefined();
  });
});
