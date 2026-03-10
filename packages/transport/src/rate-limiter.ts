/**
 * Token Bucket Rate Limiter
 *
 * Prevents agent spam by limiting requests per IP or session.
 * Uses a token bucket algorithm with configurable burst and refill.
 */

import type { RateLimitConfig } from './types.js';

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly requestsPerMinute: number;
  private readonly burstSize: number;
  private readonly refillRate: number; // tokens per ms

  constructor(config: RateLimitConfig = { requestsPerMinute: 60, burstSize: 10 }) {
    this.requestsPerMinute = config.requestsPerMinute;
    this.burstSize = config.burstSize;
    this.refillRate = this.requestsPerMinute / 60_000; // per ms
  }

  /**
   * Check if a request from the given key is allowed.
   * Returns true if allowed, false if rate limited.
   */
  consume(key: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = { tokens: this.burstSize, lastRefill: now };
      this.buckets.set(key, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill;
    bucket.tokens = Math.min(
      this.burstSize,
      bucket.tokens + elapsed * this.refillRate,
    );
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }

    return false;
  }

  /**
   * Get remaining tokens for a key.
   */
  remaining(key: string): number {
    const bucket = this.buckets.get(key);
    if (!bucket) return this.burstSize;

    const elapsed = Date.now() - bucket.lastRefill;
    return Math.min(
      this.burstSize,
      bucket.tokens + elapsed * this.refillRate,
    );
  }

  /**
   * Reset a specific key's bucket.
   */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  /**
   * Clear all buckets.
   */
  clear(): void {
    this.buckets.clear();
  }

  /**
   * Get the number of tracked keys.
   */
  get size(): number {
    return this.buckets.size;
  }
}
