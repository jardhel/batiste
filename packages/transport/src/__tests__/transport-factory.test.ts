import { describe, it, expect } from 'vitest';
import { GatewayConfigSchema, TransportModeSchema, SessionInfoSchema, RateLimitConfigSchema } from '../types.js';

describe('TransportModeSchema', () => {
  it('should accept stdio', () => {
    expect(TransportModeSchema.parse('stdio')).toBe('stdio');
  });

  it('should accept gateway', () => {
    expect(TransportModeSchema.parse('gateway')).toBe('gateway');
  });

  it('should reject invalid mode', () => {
    expect(() => TransportModeSchema.parse('websocket')).toThrow();
  });
});

describe('GatewayConfigSchema', () => {
  it('should parse with all defaults', () => {
    const config = GatewayConfigSchema.parse({});
    expect(config.mode).toBe('stdio');
    expect(config.port).toBe(3100);
    expect(config.host).toBe('127.0.0.1');
    expect(config.maxConcurrentSessions).toBe(10);
    expect(config.sessionTimeoutMs).toBe(3_600_000);
    expect(config.security.rateLimit.requestsPerMinute).toBe(60);
    expect(config.security.rateLimit.burstSize).toBe(10);
    expect(config.security.maxRequestBodyBytes).toBe(1_048_576);
  });

  it('should parse custom config', () => {
    const config = GatewayConfigSchema.parse({
      mode: 'gateway',
      port: 8080,
      host: '0.0.0.0',
      maxConcurrentSessions: 50,
      security: {
        tls: { enabled: true, certPath: '/cert.pem', keyPath: '/key.pem' },
        rateLimit: { requestsPerMinute: 120, burstSize: 20 },
        ipAllowList: ['10.0.0.0/8'],
      },
    });
    expect(config.mode).toBe('gateway');
    expect(config.port).toBe(8080);
    expect(config.security.tls.enabled).toBe(true);
    expect(config.security.tls.certPath).toBe('/cert.pem');
    expect(config.security.ipAllowList).toEqual(['10.0.0.0/8']);
  });
});

describe('SessionInfoSchema', () => {
  it('should parse a valid session', () => {
    const session = SessionInfoSchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      connectedAt: '2025-01-01T00:00:00.000Z',
      lastActiveAt: '2025-01-01T00:00:00.000Z',
      ip: '127.0.0.1',
    });
    expect(session.requestCount).toBe(0);
    expect(session.bytesTransferred).toBe(0);
  });
});

describe('RateLimitConfigSchema', () => {
  it('should apply defaults', () => {
    const config = RateLimitConfigSchema.parse({});
    expect(config.requestsPerMinute).toBe(60);
    expect(config.burstSize).toBe(10);
  });
});
