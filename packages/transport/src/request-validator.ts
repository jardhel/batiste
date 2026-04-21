/**
 * Request Validator
 *
 * Validates incoming HTTP requests before they reach MCP:
 * - Request body size limits
 * - Content-Type checks
 * - IP allowlisting
 * - Basic JSON-RPC structure validation
 *
 * Proxy trust (E3-B10):
 *   `getClientIp` only honours the `X-Forwarded-For` header when the
 *   TCP peer address is inside the operator-configured trusted-proxies
 *   list. Any other request is pinned to `req.socket.remoteAddress`.
 *   This prevents an internet-facing gateway from being tricked into
 *   rate-limiting or audit-logging an attacker-supplied IP.
 *
 * Compliance: SOC 2 CC6.6, ISO 27001 A.8.20, NIS2 Art. 21(2)(e).
 */

import type { IncomingMessage } from 'node:http';
import type { GatewaySecurity, ProxyTrust } from './types.js';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  statusCode?: number;
}

export class RequestValidator {
  private readonly maxBodyBytes: number;
  private readonly ipAllowList: string[] | undefined;
  private readonly proxy: ProxyTrust;

  constructor(security: GatewaySecurity) {
    this.maxBodyBytes = security.maxRequestBodyBytes;
    this.ipAllowList = security.ipAllowList;
    this.proxy = security.proxy;
  }

  /**
   * Validate an incoming request before MCP processing.
   */
  validateRequest(req: IncomingMessage): ValidationResult {
    // Check IP allowlist. Always use the proxy-aware resolver so
    // trusted upstreams get honoured and untrusted XFF is ignored.
    if (this.ipAllowList && this.ipAllowList.length > 0) {
      const clientIp = getClientIp(req, this.proxy);
      if (!this.ipAllowList.includes(clientIp)) {
        return { valid: false, error: 'IP not allowed', statusCode: 403 };
      }
    }

    // Check Content-Type for POST
    if (req.method === 'POST') {
      const contentType = req.headers['content-type'];
      if (contentType && !contentType.includes('application/json')) {
        return { valid: false, error: 'Content-Type must be application/json', statusCode: 415 };
      }
    }

    // Check Content-Length
    const contentLength = req.headers['content-length'];
    if (contentLength) {
      const length = parseInt(contentLength, 10);
      if (!isNaN(length) && length > this.maxBodyBytes) {
        return { valid: false, error: 'Request body too large', statusCode: 413 };
      }
    }

    return { valid: true };
  }

  /**
   * Validate a parsed JSON-RPC body.
   */
  validateBody(body: unknown): ValidationResult {
    if (body === undefined || body === null) {
      return { valid: true }; // GET/DELETE may have no body
    }

    if (typeof body !== 'object') {
      return { valid: false, error: 'Body must be a JSON object or array', statusCode: 400 };
    }

    // Check for jsonrpc field (single or batch)
    if (Array.isArray(body)) {
      for (const item of body) {
        if (typeof item !== 'object' || item === null || !('jsonrpc' in item)) {
          return { valid: false, error: 'Invalid JSON-RPC message in batch', statusCode: 400 };
        }
      }
    } else {
      if (!('jsonrpc' in body)) {
        return { valid: false, error: 'Missing jsonrpc field', statusCode: 400 };
      }
    }

    return { valid: true };
  }

  get maxBytes(): number {
    return this.maxBodyBytes;
  }

  /** Expose proxy config for downstream callers (gateway logging). */
  get proxyConfig(): ProxyTrust {
    return this.proxy;
  }
}

/**
 * Resolve the client IP, honouring `X-Forwarded-For` only when the TCP
 * peer itself is inside the trusted-proxies list.
 *
 * Order:
 *   1. If `trustProxy` is false → always return `socket.remoteAddress`.
 *   2. If the peer is not in `trustedProxies` → return socket address
 *      (defence-in-depth: even with trust on, unknown peers cannot
 *      spoof by setting XFF).
 *   3. Otherwise, parse the **leftmost** XFF entry. Per RFC 7239 §5.2
 *      the leftmost IP is the original client, as seen by the first
 *      proxy. We strip whitespace and do a loose sanity check so
 *      malformed headers fall back to the socket address rather than
 *      throw.
 */
export function getClientIp(req: IncomingMessage, proxy?: ProxyTrust): string {
  const socketAddr = req.socket.remoteAddress ?? '127.0.0.1';

  if (!proxy || !proxy.trustProxy) {
    return socketAddr;
  }
  if (!proxy.trustedProxies.includes(socketAddr)) {
    return socketAddr;
  }
  const raw = req.headers['x-forwarded-for'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (typeof header !== 'string' || header.length === 0) {
    return socketAddr;
  }
  // Defence in depth: cap the header size we parse so a pathological
  // XFF with thousands of entries cannot be a CPU sink.
  if (header.length > 2048) {
    return socketAddr;
  }
  const first = header.split(',')[0]?.trim() ?? '';
  return first.length > 0 ? first : socketAddr;
}
