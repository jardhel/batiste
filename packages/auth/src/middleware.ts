/**
 * Auth Middleware
 *
 * Wraps an MCP ToolHandler to enforce authentication and scope.
 * Intercepts every handleTool() call, verifies the JWT from the
 * request context, and checks the scope before delegating.
 */

import type { ToolHandler } from '@batiste-aidk/core/mcp';
import { TokenVerifier } from './token-verifier.js';
import { KeyStore } from './key-store.js';
import { checkScope } from './scope.js';
import type { AuthResult } from './types.js';

export interface AuthMiddlewareConfig {
  /** Secret key for JWT verification */
  secretKey: string;
  /** Optional key store for revocation checks */
  keyStore?: KeyStore;
  /** Called when access is denied */
  onDenied?: (toolName: string, reason: string) => void;
}

/**
 * Create an auth-enforcing wrapper around a ToolHandler.
 *
 * The wrapper expects the request context to include an `authToken` string
 * (the JWT). If auth passes, it delegates to the original handler.
 */
export function createAuthMiddleware(
  handler: ToolHandler,
  config: AuthMiddlewareConfig,
): AuthenticatedToolHandler {
  const verifier = new TokenVerifier(config.secretKey);

  return {
    /** The current auth token to verify against */
    authToken: undefined,

    async handleTool(name: string, args: Record<string, unknown>): Promise<unknown> {
      // If no auth token is set, deny
      if (!this.authToken) {
        config.onDenied?.(name, 'No auth token provided');
        throw new AuthError('Authentication required');
      }

      // Verify JWT
      const result = await verifier.verify(this.authToken);
      if (!result.authenticated || !result.token) {
        config.onDenied?.(name, result.error ?? 'Invalid token');
        throw new AuthError(result.error ?? 'Authentication failed');
      }

      // Check revocation
      if (config.keyStore && config.keyStore.isRevoked(result.token.id)) {
        config.onDenied?.(name, 'Token revoked');
        throw new AuthError('Token has been revoked');
      }

      // Check scope
      const scopeResult = checkScope(result.token.scope, name, args);
      if (!scopeResult.allowed) {
        config.onDenied?.(name, scopeResult.reason ?? 'Out of scope');
        throw new AuthError(scopeResult.reason ?? 'Access denied');
      }

      // Delegate to original handler
      return handler.handleTool(name, args);
    },

    async close(): Promise<void> {
      await handler.close?.();
    },
  };
}

export interface AuthenticatedToolHandler extends ToolHandler {
  /** Set the JWT to authenticate against */
  authToken: string | undefined;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Extract a Bearer token from an Authorization header.
 */
export function extractBearerToken(authHeader: string | undefined): string | undefined {
  if (!authHeader) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  return match?.[1];
}

/**
 * Standalone function to verify a token and return the result.
 * Useful for one-off checks without the middleware wrapper.
 */
export async function verifyToken(
  jwt: string,
  secretKey: string,
  keyStore?: KeyStore,
): Promise<AuthResult> {
  const verifier = new TokenVerifier(secretKey);
  const result = await verifier.verify(jwt);

  if (result.authenticated && result.token && keyStore) {
    if (keyStore.isRevoked(result.token.id)) {
      return { authenticated: false, error: 'Token has been revoked' };
    }
  }

  return result;
}
