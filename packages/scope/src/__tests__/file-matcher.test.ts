import { describe, it, expect } from 'vitest';
import { FileMatcher } from '../file-matcher.js';
import type { AccessPolicy } from '../types.js';

const policy: AccessPolicy = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'auth-readonly',
  allowedPaths: ['src/auth/**', 'src/types/*.ts'],
  deniedPaths: ['**/*.env', '**/*.secret'],
  maxDepth: 10,
  includeTests: false,
};

describe('FileMatcher', () => {
  const matcher = new FileMatcher(policy);

  it('should allow files matching allowed patterns', () => {
    expect(matcher.isAllowed('src/auth/login.ts')).toBe(true);
    expect(matcher.isAllowed('src/auth/middleware/jwt.ts')).toBe(true);
    expect(matcher.isAllowed('src/types/auth.ts')).toBe(true);
  });

  it('should deny files outside allowed patterns', () => {
    expect(matcher.isAllowed('src/secret/keys.ts')).toBe(false);
    expect(matcher.isAllowed('lib/util.ts')).toBe(false);
  });

  it('should deny files matching denied patterns', () => {
    expect(matcher.isAllowed('src/auth/.env')).toBe(false);
    expect(matcher.isAllowed('src/auth/db.secret')).toBe(false);
  });

  it('should filter a list of paths', () => {
    const result = matcher.filter([
      'src/auth/login.ts',
      'src/secret/keys.ts',
      'src/types/auth.ts',
      'src/auth/.env',
    ]);
    expect(result).toEqual(['src/auth/login.ts', 'src/types/auth.ts']);
  });

  it('should return denied paths', () => {
    const result = matcher.denied([
      'src/auth/login.ts',
      'src/secret/keys.ts',
    ]);
    expect(result).toEqual(['src/secret/keys.ts']);
  });
});
