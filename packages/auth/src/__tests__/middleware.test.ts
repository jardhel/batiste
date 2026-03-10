import { describe, it, expect } from 'vitest';
import { TokenIssuer } from '../token-issuer.js';
import { createAuthMiddleware, extractBearerToken, AuthError } from '../middleware.js';
import type { ToolHandler } from '@batiste/core/mcp';

const SECRET = 'test-secret-key-that-is-at-least-32-characters-long';

const mockHandler: ToolHandler = {
  async handleTool(name: string, args: Record<string, unknown>) {
    return { tool: name, args };
  },
};

describe('createAuthMiddleware', () => {
  const issuer = new TokenIssuer({
    secretKey: SECRET,
    defaultTtlMs: 3_600_000,
    projectId: 'test-project',
  });

  it('should deny when no auth token', async () => {
    const secured = createAuthMiddleware(mockHandler, { secretKey: SECRET });
    await expect(secured.handleTool('find_symbol', {})).rejects.toThrow(AuthError);
  });

  it('should allow with valid token', async () => {
    const secured = createAuthMiddleware(mockHandler, { secretKey: SECRET });
    const { jwt } = await issuer.issue({
      agentId: 'test-agent',
      scope: { operations: ['read'] },
    });

    secured.authToken = jwt;
    const result = await secured.handleTool('find_symbol', {});
    expect(result).toEqual({ tool: 'find_symbol', args: {} });
  });

  it('should deny with invalid token', async () => {
    const secured = createAuthMiddleware(mockHandler, { secretKey: SECRET });
    secured.authToken = 'invalid.jwt.token';
    await expect(secured.handleTool('find_symbol', {})).rejects.toThrow(AuthError);
  });

  it('should enforce tool scope', async () => {
    const secured = createAuthMiddleware(mockHandler, { secretKey: SECRET });
    const { jwt } = await issuer.issue({
      agentId: 'test-agent',
      scope: {
        tools: ['find_symbol'],
        operations: ['read'],
      },
    });

    secured.authToken = jwt;
    // Allowed tool
    await expect(secured.handleTool('find_symbol', {})).resolves.toBeDefined();
    // Denied tool
    await expect(secured.handleTool('execute_sandbox', {})).rejects.toThrow('not in scope');
  });

  it('should enforce file scope', async () => {
    const secured = createAuthMiddleware(mockHandler, { secretKey: SECRET });
    const { jwt } = await issuer.issue({
      agentId: 'test-agent',
      scope: {
        files: ['src/auth/**'],
        operations: ['read'],
      },
    });

    secured.authToken = jwt;
    await expect(
      secured.handleTool('find_symbol', { entryPoints: ['src/auth/login.ts'] }),
    ).resolves.toBeDefined();
    await expect(
      secured.handleTool('find_symbol', { entryPoints: ['src/secret/keys.ts'] }),
    ).rejects.toThrow('not in scope');
  });

  it('should call onDenied callback', async () => {
    const denied: Array<{ tool: string; reason: string }> = [];
    const secured = createAuthMiddleware(mockHandler, {
      secretKey: SECRET,
      onDenied: (tool, reason) => denied.push({ tool, reason }),
    });

    // No token
    try { await secured.handleTool('test', {}); } catch { /* expected */ }
    expect(denied).toHaveLength(1);
    expect(denied[0]!.tool).toBe('test');
  });

  it('should delegate close to original handler', async () => {
    let closed = false;
    const closeable: ToolHandler = {
      async handleTool() { return {}; },
      async close() { closed = true; },
    };

    const secured = createAuthMiddleware(closeable, { secretKey: SECRET });
    await secured.close?.();
    expect(closed).toBe(true);
  });
});

describe('extractBearerToken', () => {
  it('should extract token from Bearer header', () => {
    expect(extractBearerToken('Bearer abc123')).toBe('abc123');
  });

  it('should handle case-insensitive Bearer', () => {
    expect(extractBearerToken('bearer abc123')).toBe('abc123');
  });

  it('should return undefined for missing header', () => {
    expect(extractBearerToken(undefined)).toBeUndefined();
  });

  it('should return undefined for non-Bearer auth', () => {
    expect(extractBearerToken('Basic abc123')).toBeUndefined();
  });
});
