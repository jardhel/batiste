/**
 * @batiste-aidk/transport
 *
 * Secure gateway transport for Batiste MCP servers.
 *
 * Building blocks:
 * - startGateway() — HTTPS server with TLS, rate limiting, session management
 * - startTransport() — Factory: stdio or gateway based on config
 * - RateLimiter — Token bucket rate limiting per key
 * - SessionManager — Concurrent session tracking with timeouts
 * - RequestValidator — Request size, IP, content-type validation
 */

export { startGateway, type GatewayHandle, type McpServerFactory, type SessionContext } from './secure-gateway.js';
export { PerformanceTracker, type PerformanceMetrics } from './performance-tracker.js';
export { startTransport, type TransportHandle, type StdioHandle } from './transport-factory.js';
export { RateLimiter } from './rate-limiter.js';
export { SessionManager, type SessionManagerConfig } from './session-manager.js';
export { RequestValidator, getClientIp, type ValidationResult } from './request-validator.js';
export { TlsManager } from './tls-manager.js';
export {
  decideOutbound,
  loadDpaProfile,
  DpaProfileSchema,
  SubProcessorSchema,
  DATA_REGION,
  DATA_CATEGORY,
  LEGAL_BASIS,
  SPECIAL_CATEGORIES,
  type DpaProfile,
  type SubProcessor,
  type DataRegion,
  type DataCategory,
  type LegalBasis,
  type OutboundCall,
  type GuardDecision,
  type RopaEntry,
} from './dpa-guard.js';
export {
  TransportModeSchema,
  SessionInfoSchema,
  RateLimitConfigSchema,
  TlsConfigSchema,
  CorsConfigSchema,
  GatewaySecuritySchema,
  GatewayConfigSchema,
  type TransportMode,
  type SessionInfo,
  type RateLimitConfig,
  type TlsConfig,
  type CorsConfig,
  type GatewaySecurity,
  type GatewayConfig,
} from './types.js';
