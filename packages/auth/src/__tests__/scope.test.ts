import { describe, it, expect } from 'vitest';
import { checkScope, checkOperation, checkPromptScope } from '../scope.js';
import type { ScopeDefinition } from '../types.js';

describe('checkScope', () => {
  it('should allow when no restrictions', () => {
    const scope: ScopeDefinition = { operations: ['read'] };
    const result = checkScope(scope, 'any_tool');
    expect(result.allowed).toBe(true);
  });

  it('should allow a tool in the tools list', () => {
    const scope: ScopeDefinition = {
      tools: ['find_symbol', 'analyze_dependency'],
      operations: ['read'],
    };
    expect(checkScope(scope, 'find_symbol').allowed).toBe(true);
    expect(checkScope(scope, 'analyze_dependency').allowed).toBe(true);
  });

  it('should deny a tool not in the tools list', () => {
    const scope: ScopeDefinition = {
      tools: ['find_symbol'],
      operations: ['read'],
    };
    const result = checkScope(scope, 'execute_sandbox');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('execute_sandbox');
  });

  it('should allow files matching glob patterns', () => {
    const scope: ScopeDefinition = {
      files: ['src/auth/**'],
      operations: ['read'],
    };
    const result = checkScope(scope, 'find_symbol', {
      entryPoints: ['src/auth/middleware.ts'],
    });
    expect(result.allowed).toBe(true);
  });

  it('should deny files not matching glob patterns', () => {
    const scope: ScopeDefinition = {
      files: ['src/auth/**'],
      operations: ['read'],
    };
    const result = checkScope(scope, 'find_symbol', {
      entryPoints: ['src/secret/keys.ts'],
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('src/secret/keys.ts');
  });

  it('should check paths argument', () => {
    const scope: ScopeDefinition = {
      files: ['src/**'],
      operations: ['read'],
    };
    expect(checkScope(scope, 'validate_code', { paths: ['src/main.ts'] }).allowed).toBe(true);
    expect(checkScope(scope, 'validate_code', { paths: ['lib/util.ts'] }).allowed).toBe(false);
  });

  it('should check filePath argument', () => {
    const scope: ScopeDefinition = {
      files: ['src/**'],
      operations: ['read'],
    };
    expect(checkScope(scope, 'run_tdd', {
      testFilePath: 'src/test.ts',
      implementationFilePath: 'src/impl.ts',
    }).allowed).toBe(true);
  });

  it('should deny when any path is out of scope', () => {
    const scope: ScopeDefinition = {
      files: ['src/auth/**'],
      operations: ['read'],
    };
    const result = checkScope(scope, 'validate_code', {
      paths: ['src/auth/login.ts', 'src/secret/env.ts'],
    });
    expect(result.allowed).toBe(false);
  });

  it('should allow when no file args present', () => {
    const scope: ScopeDefinition = {
      files: ['src/**'],
      operations: ['read'],
    };
    // No file-like args, so no file check needed
    expect(checkScope(scope, 'manage_task', { action: 'list' }).allowed).toBe(true);
  });
});

describe('checkOperation', () => {
  it('should allow permitted operations', () => {
    const scope: ScopeDefinition = { operations: ['read', 'write'] };
    expect(checkOperation(scope, 'read').allowed).toBe(true);
    expect(checkOperation(scope, 'write').allowed).toBe(true);
  });

  it('should deny unpermitted operations', () => {
    const scope: ScopeDefinition = { operations: ['read'] };
    expect(checkOperation(scope, 'write').allowed).toBe(false);
    expect(checkOperation(scope, 'execute').allowed).toBe(false);
  });

  it('should default to read-only', () => {
    const scope: ScopeDefinition = {};
    expect(checkOperation(scope, 'read').allowed).toBe(true);
    expect(checkOperation(scope, 'write').allowed).toBe(false);
  });
});

describe('checkPromptScope', () => {
  it('should allow when prompts is undefined', () => {
    const scope: ScopeDefinition = { operations: ['read'] };
    expect(checkPromptScope(scope, 'any-prompt').allowed).toBe(true);
  });

  it('should allow when prompts is empty', () => {
    const scope: ScopeDefinition = { prompts: [], operations: ['read'] };
    expect(checkPromptScope(scope, 'any-prompt').allowed).toBe(true);
  });

  it('should allow a prompt in the list', () => {
    const scope: ScopeDefinition = {
      prompts: ['code-review', 'summarize'],
      operations: ['read'],
    };
    expect(checkPromptScope(scope, 'code-review').allowed).toBe(true);
    expect(checkPromptScope(scope, 'summarize').allowed).toBe(true);
  });

  it('should deny a prompt not in the list', () => {
    const scope: ScopeDefinition = {
      prompts: ['code-review'],
      operations: ['read'],
    };
    const result = checkPromptScope(scope, 'secret-prompt');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('secret-prompt');
  });
});

describe('checkScope glob matching hardening', () => {
  const mk = (p: string): ScopeDefinition => ({ operations: ['read'], files: [p] });

  it('treats regex metacharacters in patterns literally', () => {
    expect(checkScope(mk('src/(a|b)/x.ts'), 'validate_code', { paths: ['src/a/x.ts'] }).allowed).toBe(false);
    expect(checkScope(mk('src/(a|b)/x.ts'), 'validate_code', { paths: ['src/(a|b)/x.ts'] }).allowed).toBe(true);
    expect(checkScope(mk('src/a+b.ts'), 'validate_code', { paths: ['src/aab.ts'] }).allowed).toBe(false);
  });

  it('does not throw nor hang on pathological patterns', () => {
    const t0 = performance.now();
    const r = checkScope(mk('*'.repeat(40) + 'x'), 'validate_code', { paths: ['a'.repeat(5000)] });
    expect(r.allowed).toBe(false);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(() => checkScope(mk('src/[unclosed'), 'validate_code', { paths: ['src/x'] })).not.toThrow();
  });

  it('keeps * within a segment and ** across segments', () => {
    expect(checkScope(mk('src/*.ts'), 'validate_code', { paths: ['src/a.ts'] }).allowed).toBe(true);
    expect(checkScope(mk('src/*.ts'), 'validate_code', { paths: ['src/d/a.ts'] }).allowed).toBe(false);
    expect(checkScope(mk('src/**'), 'validate_code', { paths: ['src/d/a.ts'] }).allowed).toBe(true);
  });
});
