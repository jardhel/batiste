/**
 * Token Verifier
 *
 * Verifies and decodes JWT tokens.
 * Checks expiry, signature, and extracts the embedded scope.
 */

import { jwtVerify, type JWTPayload } from 'jose';
import { ApiTokenSchema, type ApiToken, type AuthResult, type ScopeDefinition } from './types.js';

export class TokenVerifier {
  private readonly secretKey: Uint8Array;

  constructor(secretKey: string) {
    this.secretKey = new TextEncoder().encode(secretKey);
  }

  /**
   * Verify a JWT string. Returns an AuthResult.
   */
  async verify(jwt: string): Promise<AuthResult> {
    try {
      const { payload } = await jwtVerify(jwt, this.secretKey, {
        issuer: 'batiste',
      });

      const token = payloadToToken(payload);
      if (!token) {
        return { authenticated: false, error: 'Invalid token payload' };
      }

      return { authenticated: true, token };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Verification failed';
      return { authenticated: false, error: message };
    }
  }
}

function payloadToToken(payload: JWTPayload): ApiToken | null {
  try {
    const scope = payload['scope'] as ScopeDefinition | undefined;
    if (!scope) return null;

    return ApiTokenSchema.parse({
      id: payload.jti,
      agentId: payload.sub,
      projectId: payload['pid'],
      scope,
      issuedAt: payload.iat
        ? new Date(payload.iat * 1000).toISOString()
        : new Date().toISOString(),
      expiresAt: payload.exp
        ? new Date(payload.exp * 1000).toISOString()
        : new Date().toISOString(),
      revoked: false,
    });
  } catch {
    return null;
  }
}
