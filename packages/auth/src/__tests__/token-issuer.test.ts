import { describe, it, expect } from 'vitest';
import { TokenIssuer } from '../token-issuer.js';
import { TokenVerifier } from '../token-verifier.js';

const SECRET = 'test-secret-key-that-is-at-least-32-characters-long';

describe('TokenIssuer', () => {
  const issuer = new TokenIssuer({
    secretKey: SECRET,
    defaultTtlMs: 3_600_000,
    projectId: 'test-project',
  });

  it('should issue a valid JWT', async () => {
    const { jwt, token } = await issuer.issue({
      agentId: 'rust-refactorer',
      scope: {
        tools: ['find_symbol', 'analyze_dependency'],
        operations: ['read'],
      },
    });

    expect(jwt).toBeTruthy();
    expect(typeof jwt).toBe('string');
    expect(jwt.split('.')).toHaveLength(3); // JWT has 3 parts
    expect(token.agentId).toBe('rust-refactorer');
    expect(token.projectId).toBe('test-project');
    expect(token.revoked).toBe(false);
  });

  it('should embed scope in the token', async () => {
    const { token } = await issuer.issue({
      agentId: 'test-agent',
      scope: {
        tools: ['find_symbol'],
        files: ['src/auth/**'],
        operations: ['read'],
      },
    });

    expect(token.scope.tools).toEqual(['find_symbol']);
    expect(token.scope.files).toEqual(['src/auth/**']);
    expect(token.scope.operations).toEqual(['read']);
  });

  it('should set expiry based on TTL', async () => {
    const { token } = await issuer.issue({
      agentId: 'test-agent',
      scope: { operations: ['read'] },
      ttlMs: 60_000, // 1 minute
    });

    const issued = new Date(token.issuedAt).getTime();
    const expires = new Date(token.expiresAt).getTime();
    expect(expires - issued).toBeGreaterThanOrEqual(59_000);
    expect(expires - issued).toBeLessThanOrEqual(61_000);
  });

  it('should generate unique token IDs', async () => {
    const { token: t1 } = await issuer.issue({
      agentId: 'agent-1',
      scope: { operations: ['read'] },
    });
    const { token: t2 } = await issuer.issue({
      agentId: 'agent-2',
      scope: { operations: ['read'] },
    });
    expect(t1.id).not.toBe(t2.id);
  });

  it('should create tokens verifiable by TokenVerifier', async () => {
    const verifier = new TokenVerifier(SECRET);

    const { jwt } = await issuer.issue({
      agentId: 'verified-agent',
      scope: {
        tools: ['echo'],
        operations: ['read', 'write'],
      },
    });

    const result = await verifier.verify(jwt);
    expect(result.authenticated).toBe(true);
    expect(result.token?.agentId).toBe('verified-agent');
    expect(result.token?.scope.tools).toEqual(['echo']);
  });
});
