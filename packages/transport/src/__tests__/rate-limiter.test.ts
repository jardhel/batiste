import { describe, it, expect, beforeEach } from 'vitest';
import { RateLimiter } from '../rate-limiter.js';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter({ requestsPerMinute: 60, burstSize: 5 });
  });

  it('should allow requests within burst limit', () => {
    for (let i = 0; i < 5; i++) {
      expect(limiter.consume('test-ip')).toBe(true);
    }
  });

  it('should deny requests beyond burst limit', () => {
    for (let i = 0; i < 5; i++) {
      limiter.consume('test-ip');
    }
    expect(limiter.consume('test-ip')).toBe(false);
  });

  it('should track different keys independently', () => {
    for (let i = 0; i < 5; i++) {
      limiter.consume('ip-1');
    }
    expect(limiter.consume('ip-1')).toBe(false);
    expect(limiter.consume('ip-2')).toBe(true);
  });

  it('should report remaining tokens', () => {
    expect(limiter.remaining('new-ip')).toBe(5);
    limiter.consume('new-ip');
    // remaining should be close to 4 (may be slightly above due to refill)
    expect(limiter.remaining('new-ip')).toBeLessThanOrEqual(5);
    expect(limiter.remaining('new-ip')).toBeGreaterThanOrEqual(3);
  });

  it('should reset a specific key', () => {
    for (let i = 0; i < 5; i++) {
      limiter.consume('test-ip');
    }
    expect(limiter.consume('test-ip')).toBe(false);
    limiter.reset('test-ip');
    expect(limiter.consume('test-ip')).toBe(true);
  });

  it('should clear all buckets', () => {
    limiter.consume('ip-1');
    limiter.consume('ip-2');
    expect(limiter.size).toBe(2);
    limiter.clear();
    expect(limiter.size).toBe(0);
  });

  it('should refill tokens over time', async () => {
    // Use a high rate for testing (600 per minute = 10/sec)
    const fastLimiter = new RateLimiter({ requestsPerMinute: 600, burstSize: 2 });

    // Exhaust burst
    fastLimiter.consume('test');
    fastLimiter.consume('test');
    expect(fastLimiter.consume('test')).toBe(false);

    // Wait for refill (100ms should give ~1 token at 10/sec)
    await new Promise((r) => setTimeout(r, 150));

    expect(fastLimiter.consume('test')).toBe(true);
  });

  it('should initialize with default config', () => {
    const defaultLimiter = new RateLimiter();
    // Default burst is 10
    for (let i = 0; i < 10; i++) {
      expect(defaultLimiter.consume('test')).toBe(true);
    }
    expect(defaultLimiter.consume('test')).toBe(false);
  });
});
