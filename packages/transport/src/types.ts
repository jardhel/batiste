/**
 * Transport Types
 *
 * Zod schemas and TypeScript types for gateway configuration,
 * session tracking, and rate limiting.
 */

import { z } from 'zod';

// --- Transport Mode ---

export const TransportModeSchema = z.enum(['stdio', 'gateway']);
export type TransportMode = z.infer<typeof TransportModeSchema>;

// --- Session Info ---

export const SessionInfoSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string().optional(),
  connectedAt: z.string().datetime(),
  lastActiveAt: z.string().datetime(),
  ip: z.string(),
  requestCount: z.number().default(0),
  bytesTransferred: z.number().default(0),
  metadata: z.record(z.unknown()).optional(),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;

// --- Rate Limit Config ---

export const RateLimitConfigSchema = z.object({
  requestsPerMinute: z.number().default(60),
  burstSize: z.number().default(10),
});
export type RateLimitConfig = z.infer<typeof RateLimitConfigSchema>;

// --- TLS Config ---

export const TlsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  certPath: z.string().optional(),
  keyPath: z.string().optional(),
});
export type TlsConfig = z.infer<typeof TlsConfigSchema>;

// --- CORS Config ---

export const CorsConfigSchema = z.object({
  origins: z.array(z.string()).default([]),
});
export type CorsConfig = z.infer<typeof CorsConfigSchema>;

// --- Gateway Security ---

export const GatewaySecuritySchema = z.object({
  tls: TlsConfigSchema.default({}),
  rateLimit: RateLimitConfigSchema.default({}),
  ipAllowList: z.array(z.string()).optional(),
  maxRequestBodyBytes: z.number().default(1_048_576),
  cors: CorsConfigSchema.optional(),
});
export type GatewaySecurity = z.infer<typeof GatewaySecuritySchema>;

// --- Full Gateway Config ---

export const GatewayConfigSchema = z.object({
  mode: TransportModeSchema.default('stdio'),
  port: z.number().default(3100),
  host: z.string().default('127.0.0.1'),
  security: GatewaySecuritySchema.default({}),
  maxConcurrentSessions: z.number().default(10),
  sessionTimeoutMs: z.number().default(3_600_000),
  label: z.string().optional(),
});
export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;
