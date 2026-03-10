/**
 * Token Issuer
 *
 * Creates scoped, time-limited JWT tokens for agent access.
 * Uses HMAC-SHA256 signing (no external auth service needed).
 */

import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import type { ApiToken, IssueTokenRequest, ScopeDefinition, TokenIssuerConfig } from './types.js';

export class TokenIssuer {
  private readonly secretKey: Uint8Array;
  private readonly defaultTtlMs: number;
  private readonly projectId: string;

  constructor(config: TokenIssuerConfig) {
    this.secretKey = new TextEncoder().encode(config.secretKey);
    this.defaultTtlMs = config.defaultTtlMs;
    this.projectId = config.projectId;
  }

  /**
   * Issue a new scoped JWT token.
   * Returns both the signed JWT string and the parsed token metadata.
   */
  async issue(request: IssueTokenRequest): Promise<{ jwt: string; token: ApiToken }> {
    const now = new Date();
    const ttlMs = request.ttlMs ?? this.defaultTtlMs;
    const expiresAt = new Date(now.getTime() + ttlMs);
    const tokenId = randomUUID();

    const token: ApiToken = {
      id: tokenId,
      agentId: request.agentId,
      projectId: this.projectId,
      scope: normalizeScope(request.scope),
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      revoked: false,
    };

    const jwt = await new SignJWT({
      sub: request.agentId,
      jti: tokenId,
      pid: this.projectId,
      scope: token.scope,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(expiresAt)
      .setIssuer('batiste')
      .sign(this.secretKey);

    return { jwt, token };
  }
}

function normalizeScope(scope: ScopeDefinition): ScopeDefinition {
  return {
    ...scope,
    operations: scope.operations ?? ['read'],
  };
}
