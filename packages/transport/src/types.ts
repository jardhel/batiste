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

// --- Proxy Trust (E3-B10) ---

/**
 * X-Forwarded-For handling. `trustProxy` is OFF by default: when the
 * gateway is exposed directly to the network, XFF is attacker-
 * controlled and must never drive rate-limiting, IP allowlisting, or
 * audit logging. Operators running Batiste behind a reverse proxy
 * (nginx, HAProxy, an ingress controller) opt into XFF by setting
 * `trustProxy: true` and listing the trusted upstream CIDRs.
 *
 * Only requests whose socket.remoteAddress is inside `trustedProxies`
 * will have their XFF header honoured. All other requests — including
 * requests from outside the allow-list that happen to set the header —
 * fall back to the TCP peer address. This matches Express's "trust
 * proxy" semantics but is explicit and on-by-default-off.
 *
 * Compliance: SOC 2 CC6.6 (network-layer controls), NIS2 Art. 21(2)(e)
 * (supply-chain security & correct use of middleboxes), ISO 27001
 * A.8.20/A.8.21 (network controls).
 */
export const ProxyTrustSchema = z.object({
  trustProxy: z.boolean().default(false),
  trustedProxies: z.array(z.string()).default([]),
});
export type ProxyTrust = z.infer<typeof ProxyTrustSchema>;

// --- Gateway Security ---

export const GatewaySecuritySchema = z.object({
  tls: TlsConfigSchema.default({}),
  rateLimit: RateLimitConfigSchema.default({}),
  ipAllowList: z.array(z.string()).optional(),
  maxRequestBodyBytes: z.number().default(1_048_576),
  cors: CorsConfigSchema.optional(),
  proxy: ProxyTrustSchema.default({}),
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
