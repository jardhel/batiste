import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PerformanceTracker } from '../performance-tracker.js';

let tracker: PerformanceTracker;

beforeEach(() => {
  tracker = new PerformanceTracker(60_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PerformanceTracker', () => {
  it('starts with null percentiles and sampleCount 0', () => {
    expect(tracker.p50).toBeNull();
    expect(tracker.p95).toBeNull();
    expect(tracker.p99).toBeNull();
    expect(tracker.sampleCount).toBe(0);
  });

  it('returns sample as p50/p95/p99 when only one sample', () => {
    tracker.record(42, true);
    expect(tracker.p50).toBe(42);
    expect(tracker.p95).toBe(42);
    expect(tracker.p99).toBe(42);
  });

  it('computes correct median for odd number of samples', () => {
    [10, 30, 20].forEach((ms) => tracker.record(ms, true));
    // sorted: [10, 20, 30] → p50 = 20
    expect(tracker.p50).toBeCloseTo(20, 1);
  });

  it('computes correct median for even number of samples', () => {
    [10, 20, 30, 40].forEach((ms) => tracker.record(ms, true));
    // sorted: [10, 20, 30, 40] → p50 interpolated = 25
    expect(tracker.p50).toBeCloseTo(25, 1);
  });

  it('computes p95 correctly', () => {
    // 20 samples 1–20
    for (let i = 1; i <= 20; i++) tracker.record(i, true);
    const p95 = tracker.p95!;
    expect(p95).toBeGreaterThanOrEqual(18);
    expect(p95).toBeLessThanOrEqual(20);
  });

  it('computes mean, min, max', () => {
    [10, 20, 30].forEach((ms) => tracker.record(ms, true));
    expect(tracker.mean).toBeCloseTo(20, 1);
    expect(tracker.min).toBe(10);
    expect(tracker.max).toBe(30);
  });

  it('reliability is 1 when all succeed', () => {
    tracker.record(10, true);
    tracker.record(20, true);
    expect(tracker.reliability).toBe(1);
  });

  it('reliability degrades on failures', () => {
    tracker.record(10, true);
    tracker.record(20, false);
    expect(tracker.reliability).toBeCloseTo(0.5, 2);
  });

  it('reliability is 1 when empty (no data)', () => {
    expect(tracker.reliability).toBe(1);
  });

  it('prunes samples outside the window', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    tracker.record(10, true);
    tracker.record(20, true);
    // Advance time beyond the 60s window
    vi.setSystemTime(now + 61_000);
    // Add one fresh sample to trigger prune
    tracker.record(5, true);
    expect(tracker.sampleCount).toBe(1);
    expect(tracker.p50).toBe(5);
  });

  it('summary returns all fields', () => {
    tracker.record(15, true);
    const s = tracker.summary();
    expect(typeof s.p50).toBe('number');
    expect(typeof s.p95).toBe('number');
    expect(typeof s.p99).toBe('number');
    expect(typeof s.mean).toBe('number');
    expect(typeof s.min).toBe('number');
    expect(typeof s.max).toBe('number');
    expect(typeof s.reliability).toBe('number');
    expect(s.sampleCount).toBe(1);
    expect(s.windowMs).toBe(60_000);
    expect(typeof s.capturedAt).toBe('string');
  });

  it('reset clears all samples', () => {
    tracker.record(10, true);
    tracker.record(20, false);
    tracker.reset();
    expect(tracker.sampleCount).toBe(0);
    expect(tracker.p50).toBeNull();
    expect(tracker.reliability).toBe(1);
  });
});
