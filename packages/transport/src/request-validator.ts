/**
 * Request Validator
 *
 * Validates incoming HTTP requests before they reach MCP:
 * - Request body size limits
 * - Content-Type checks
 * - IP allowlisting
 * - Basic JSON-RPC structure validation
 */

import type { IncomingMessage } from 'node:http';
import type { GatewaySecurity } from './types.js';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  statusCode?: number;
}

export class RequestValidator {
  private readonly maxBodyBytes: number;
  private readonly ipAllowList: string[] | undefined;

  constructor(security: GatewaySecurity) {
    this.maxBodyBytes = security.maxRequestBodyBytes;
    this.ipAllowList = security.ipAllowList;
  }

  /**
   * Validate an incoming request before MCP processing.
   */
  validateRequest(req: IncomingMessage): ValidationResult {
    // Check IP allowlist
    if (this.ipAllowList && this.ipAllowList.length > 0) {
      const clientIp = getClientIp(req);
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
}

/**
 * Extract client IP from request headers, falling back to socket address.
 */
export function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0]?.trim() ?? '127.0.0.1';
  }
  return req.socket.remoteAddress ?? '127.0.0.1';
}
