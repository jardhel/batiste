import { describe, it, expect } from 'vitest';
import { TokenIssuer } from '../token-issuer.js';
import { TokenVerifier } from '../token-verifier.js';

const SECRET = 'test-secret-key-that-is-at-least-32-characters-long';

describe('TokenVerifier', () => {
  const issuer = new TokenIssuer({
    secretKey: SECRET,
    defaultTtlMs: 3_600_000,
    projectId: 'test-project',
  });
  const verifier = new TokenVerifier(SECRET);

  it('should verify a valid token', async () => {
    const { jwt } = await issuer.issue({
      agentId: 'test-agent',
      scope: { operations: ['read'] },
    });

    const result = await verifier.verify(jwt);
    expect(result.authenticated).toBe(true);
    expect(result.token?.agentId).toBe('test-agent');
    expect(result.token?.projectId).toBe('test-project');
  });

  it('should reject a token with wrong secret', async () => {
    const { jwt } = await issuer.issue({
      agentId: 'test-agent',
      scope: { operations: ['read'] },
    });

    const wrongVerifier = new TokenVerifier('wrong-secret-key-that-is-also-at-least-32-chars');
    const result = await wrongVerifier.verify(jwt);
    expect(result.authenticated).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('should reject an expired token', async () => {
    const shortIssuer = new TokenIssuer({
      secretKey: SECRET,
      defaultTtlMs: 1, // 1ms TTL
      projectId: 'test-project',
    });

    const { jwt } = await shortIssuer.issue({
      agentId: 'test-agent',
      scope: { operations: ['read'] },
    });

    // Wait for expiry
    await new Promise((r) => setTimeout(r, 50));

    const result = await verifier.verify(jwt);
    expect(result.authenticated).toBe(false);
    expect(result.error).toContain('exp');
  });

  it('should reject garbage tokens', async () => {
    const result = await verifier.verify('not.a.jwt');
    expect(result.authenticated).toBe(false);
  });

  it('should reject empty string', async () => {
    const result = await verifier.verify('');
    expect(result.authenticated).toBe(false);
  });

  it('should extract scope from verified token', async () => {
    const { jwt } = await issuer.issue({
      agentId: 'test-agent',
      scope: {
        tools: ['find_symbol', 'analyze_dependency'],
        files: ['src/**'],
        operations: ['read', 'write'],
        maxRequests: 100,
      },
    });

    const result = await verifier.verify(jwt);
    expect(result.authenticated).toBe(true);
    expect(result.token?.scope.tools).toEqual(['find_symbol', 'analyze_dependency']);
    expect(result.token?.scope.files).toEqual(['src/**']);
    expect(result.token?.scope.operations).toEqual(['read', 'write']);
    expect(result.token?.scope.maxRequests).toBe(100);
  });
});
