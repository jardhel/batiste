import { describe, it, expect } from 'vitest';
import { AccessPolicyEngine } from '../access-policy.js';

describe('AccessPolicyEngine', () => {
  it('should register and retrieve a policy', () => {
    const engine = new AccessPolicyEngine();
    const id = engine.register({
      name: 'test-policy',
      allowedPaths: ['src/**'],
    });
    const policy = engine.get(id);
    expect(policy).not.toBeNull();
    expect(policy!.name).toBe('test-policy');
  });

  it('should check file access', () => {
    const engine = new AccessPolicyEngine();
    const id = engine.register({
      name: 'auth-only',
      allowedPaths: ['src/auth/**'],
      deniedPaths: ['**/*.env'],
    });
    expect(engine.isFileAllowed(id, 'src/auth/login.ts')).toBe(true);
    expect(engine.isFileAllowed(id, 'src/secret/keys.ts')).toBe(false);
    expect(engine.isFileAllowed(id, 'src/auth/.env')).toBe(false);
  });

  it('should filter files through policy', () => {
    const engine = new AccessPolicyEngine();
    const id = engine.register({
      name: 'src-only',
      allowedPaths: ['src/**'],
    });
    const result = engine.filterFiles(id, ['src/main.ts', 'lib/util.ts', 'src/auth.ts']);
    expect(result).toEqual(['src/main.ts', 'src/auth.ts']);
  });

  it('should check symbol types', () => {
    const engine = new AccessPolicyEngine();
    const id = engine.register({
      name: 'functions-only',
      allowedPaths: ['**'],
      allowedSymbolTypes: ['function', 'class'],
    });
    expect(engine.isSymbolTypeAllowed(id, 'function')).toBe(true);
    expect(engine.isSymbolTypeAllowed(id, 'class')).toBe(true);
    expect(engine.isSymbolTypeAllowed(id, 'variable')).toBe(false);
  });

  it('should allow all symbol types when not restricted', () => {
    const engine = new AccessPolicyEngine();
    const id = engine.register({
      name: 'unrestricted',
      allowedPaths: ['**'],
    });
    expect(engine.isSymbolTypeAllowed(id, 'variable')).toBe(true);
  });

  it('should return max depth', () => {
    const engine = new AccessPolicyEngine();
    const id = engine.register({
      name: 'shallow',
      allowedPaths: ['**'],
      maxDepth: 3,
    });
    expect(engine.maxDepth(id)).toBe(3);
  });

  it('should remove a policy', () => {
    const engine = new AccessPolicyEngine();
    const id = engine.register({ name: 'temp', allowedPaths: ['**'] });
    expect(engine.remove(id)).toBe(true);
    expect(engine.get(id)).toBeNull();
  });

  it('should list all policies', () => {
    const engine = new AccessPolicyEngine();
    engine.register({ name: 'p1', allowedPaths: ['a/**'] });
    engine.register({ name: 'p2', allowedPaths: ['b/**'] });
    expect(engine.list()).toHaveLength(2);
  });

  it('should return false for unknown policy ID', () => {
    const engine = new AccessPolicyEngine();
    expect(engine.isFileAllowed('nonexistent', 'file.ts')).toBe(false);
    expect(engine.filterFiles('nonexistent', ['file.ts'])).toEqual([]);
  });
});
