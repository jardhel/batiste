import { describe, it, expect } from 'vitest';
import { RequestValidator, getClientIp } from '../request-validator.js';
import type { IncomingMessage } from 'node:http';
import type { GatewaySecurity } from '../types.js';

function mockRequest(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as unknown as IncomingMessage;
}

const defaultSecurity: GatewaySecurity = {
  tls: { enabled: false },
  rateLimit: { requestsPerMinute: 60, burstSize: 10 },
  maxRequestBodyBytes: 1_048_576,
};

describe('RequestValidator', () => {
  it('should accept valid POST request', () => {
    const validator = new RequestValidator(defaultSecurity);
    const req = mockRequest();
    const result = validator.validateRequest(req);
    expect(result.valid).toBe(true);
  });

  it('should reject wrong Content-Type for POST', () => {
    const validator = new RequestValidator(defaultSecurity);
    const req = mockRequest({
      headers: { 'content-type': 'text/plain' },
    });
    const result = validator.validateRequest(req);
    expect(result.valid).toBe(false);
    expect(result.statusCode).toBe(415);
  });

  it('should allow GET without Content-Type', () => {
    const validator = new RequestValidator(defaultSecurity);
    const req = mockRequest({ method: 'GET', headers: {} });
    const result = validator.validateRequest(req);
    expect(result.valid).toBe(true);
  });

  it('should reject oversized Content-Length', () => {
    const validator = new RequestValidator({
      ...defaultSecurity,
      maxRequestBodyBytes: 100,
    });
    const req = mockRequest({
      headers: {
        'content-type': 'application/json',
        'content-length': '200',
      },
    });
    const result = validator.validateRequest(req);
    expect(result.valid).toBe(false);
    expect(result.statusCode).toBe(413);
  });

  it('should accept Content-Length within limit', () => {
    const validator = new RequestValidator(defaultSecurity);
    const req = mockRequest({
      headers: {
        'content-type': 'application/json',
        'content-length': '500',
      },
    });
    const result = validator.validateRequest(req);
    expect(result.valid).toBe(true);
  });

  it('should enforce IP allowlist', () => {
    const validator = new RequestValidator({
      ...defaultSecurity,
      ipAllowList: ['10.0.0.1', '10.0.0.2'],
    });

    const allowed = mockRequest({
      socket: { remoteAddress: '10.0.0.1' } as never,
    });
    expect(validator.validateRequest(allowed).valid).toBe(true);

    const blocked = mockRequest({
      socket: { remoteAddress: '192.168.1.1' } as never,
    });
    const result = validator.validateRequest(blocked);
    expect(result.valid).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it('should allow all IPs when no allowlist', () => {
    const validator = new RequestValidator(defaultSecurity);
    const req = mockRequest({
      socket: { remoteAddress: '192.168.1.100' } as never,
    });
    expect(validator.validateRequest(req).valid).toBe(true);
  });
});

describe('validateBody', () => {
  const validator = new RequestValidator(defaultSecurity);

  it('should accept valid JSON-RPC body', () => {
    const result = validator.validateBody({
      jsonrpc: '2.0',
      method: 'tools/list',
      id: 1,
    });
    expect(result.valid).toBe(true);
  });

  it('should accept null/undefined body (GET/DELETE)', () => {
    expect(validator.validateBody(null).valid).toBe(true);
    expect(validator.validateBody(undefined).valid).toBe(true);
  });

  it('should reject non-object body', () => {
    const result = validator.validateBody('string');
    expect(result.valid).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  it('should reject body missing jsonrpc field', () => {
    const result = validator.validateBody({ method: 'test' });
    expect(result.valid).toBe(false);
  });

  it('should accept batch requests', () => {
    const result = validator.validateBody([
      { jsonrpc: '2.0', method: 'a', id: 1 },
      { jsonrpc: '2.0', method: 'b', id: 2 },
    ]);
    expect(result.valid).toBe(true);
  });

  it('should reject invalid batch items', () => {
    const result = validator.validateBody([
      { jsonrpc: '2.0', method: 'a', id: 1 },
      { method: 'b' }, // missing jsonrpc
    ]);
    expect(result.valid).toBe(false);
  });
});

describe('getClientIp', () => {
  it('should extract IP from X-Forwarded-For', () => {
    const req = mockRequest({
      headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' },
    });
    expect(getClientIp(req)).toBe('10.0.0.1');
  });

  it('should fall back to socket address', () => {
    const req = mockRequest({
      headers: {},
      socket: { remoteAddress: '192.168.1.1' } as never,
    });
    expect(getClientIp(req)).toBe('192.168.1.1');
  });

  it('should default to 127.0.0.1', () => {
    const req = mockRequest({
      headers: {},
      socket: {} as never,
    });
    expect(getClientIp(req)).toBe('127.0.0.1');
  });
});
