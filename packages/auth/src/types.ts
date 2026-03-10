/**
 * Auth Types
 *
 * Zod schemas for scope definitions, API tokens, and auth results.
 */

import { z } from 'zod';

// --- Scope Definition ---

export const ScopeDefinitionSchema = z.object({
  /** Allowed tool names (empty = all tools) */
  tools: z.array(z.string()).optional(),
  /** Allowed file glob patterns */
  files: z.array(z.string()).optional(),
  /** Allowed operations */
  operations: z.array(z.enum(['read', 'write', 'execute'])).default(['read']),
  /** Max requests per token lifetime */
  maxRequests: z.number().optional(),
  /** Max context token budget */
  maxTokensBudget: z.number().optional(),
  /** Allowed prompt names (empty/undefined = all prompts) */
  prompts: z.array(z.string()).optional(),
});
export type ScopeDefinition = z.infer<typeof ScopeDefinitionSchema>;

// --- API Token ---

export const ApiTokenSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string(),
  projectId: z.string(),
  scope: ScopeDefinitionSchema,
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  revoked: z.boolean().default(false),
});
export type ApiToken = z.infer<typeof ApiTokenSchema>;

// --- Auth Result ---

export const AuthResultSchema = z.object({
  authenticated: z.boolean(),
  token: ApiTokenSchema.optional(),
  error: z.string().optional(),
});
export type AuthResult = z.infer<typeof AuthResultSchema>;

// --- Token Issuer Config ---

export const TokenIssuerConfigSchema = z.object({
  /** HMAC secret key for signing JWTs */
  secretKey: z.string().min(32),
  /** Default TTL in ms (default: 1 hour) */
  defaultTtlMs: z.number().default(3_600_000),
  /** Project ID this issuer is for */
  projectId: z.string(),
});
export type TokenIssuerConfig = z.infer<typeof TokenIssuerConfigSchema>;

// --- Issue Token Request ---

export const IssueTokenRequestSchema = z.object({
  agentId: z.string(),
  scope: ScopeDefinitionSchema,
  /** TTL in ms (overrides default) */
  ttlMs: z.number().optional(),
});
export type IssueTokenRequest = z.infer<typeof IssueTokenRequestSchema>;
