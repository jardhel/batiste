/**
 * @batiste-aidk/auth
 *
 * Zero-trust authentication for Batiste MCP servers.
 *
 * Building blocks:
 * - TokenIssuer — Create scoped, time-limited JWT tokens
 * - TokenVerifier — Verify and decode tokens
 * - KeyStore — SQLite-backed token storage with revocation
 * - checkScope / checkOperation — Scope enforcement
 * - createAuthMiddleware — ToolHandler wrapper with auth + scope
 */

export { TokenIssuer } from './token-issuer.js';
export { TokenVerifier } from './token-verifier.js';
export { KeyStore, type StoredToken } from './key-store.js';
export { checkScope, checkOperation, checkPromptScope, type ScopeCheckResult } from './scope.js';
export {
  createAuthMiddleware,
  extractBearerToken,
  verifyToken,
  AuthError,
  type AuthMiddlewareConfig,
  type AuthenticatedToolHandler,
} from './middleware.js';
export {
  ScopeDefinitionSchema,
  ApiTokenSchema,
  AuthResultSchema,
  TokenIssuerConfigSchema,
  IssueTokenRequestSchema,
  type ScopeDefinition,
  type ApiToken,
  type AuthResult,
  type TokenIssuerConfig,
  type IssueTokenRequest,
} from './types.js';
