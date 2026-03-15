/**
 * Performance Tracker
 *
 * Rolling-window latency histogram (p50/p95/p99) and reliability scorer.
 *
 * Samples are kept in a circular in-memory buffer for the configured window
 * (default: 1 hour). No external dependencies — pure arithmetic.
 */

export interface PerformanceMetrics {
  /** Median latency in ms, or null when no data */
  p50: number | null;
  /** 95th-percentile latency in ms */
  p95: number | null;
  /** 99th-percentile latency in ms */
  p99: number | null;
  mean: number | null;
  min: number | null;
  max: number | null;
  /** Fraction of successful requests in the window [0, 1] */
  reliability: number;
  sampleCount: number;
  windowMs: number;
  capturedAt: string;
}

interface LatencySample {
  ts: number;
  latencyMs: number;
  success: boolean;
}

export class PerformanceTracker {
  private readonly samples: LatencySample[] = [];

  constructor(public readonly windowMs: number = 3_600_000) {}

  /** Record a single request. */
  record(latencyMs: number, success: boolean): void {
    this.samples.push({ ts: Date.now(), latencyMs, success });
    this.prune();
  }

  private prune(): void {
    const cutoff = Date.now() - this.windowMs;
    // Remove from the front (oldest first)
    let i = 0;
    while (i < this.samples.length && this.samples[i]!.ts < cutoff) i++;
    if (i > 0) this.samples.splice(0, i);
  }

  private snapshot(): LatencySample[] {
    this.prune();
    return this.samples;
  }

  /** Compute percentile (0–100). Returns null when no samples. */
  percentile(p: number): number | null {
    const data = this.snapshot().map((s) => s.latencyMs).sort((a, b) => a - b);
    if (data.length === 0) return null;
    if (data.length === 1) return data[0]!;
    const rank = (p / 100) * (data.length - 1);
    const lower = Math.floor(rank);
    const upper = Math.ceil(rank);
    const weight = rank - lower;
    return data[lower]! * (1 - weight) + data[upper]! * weight;
  }

  get p50(): number | null { return this.percentile(50); }
  get p95(): number | null { return this.percentile(95); }
  get p99(): number | null { return this.percentile(99); }

  get reliability(): number {
    const data = this.snapshot();
    if (data.length === 0) return 1;
    const successes = data.filter((s) => s.success).length;
    return successes / data.length;
  }

  get sampleCount(): number {
    return this.snapshot().length;
  }

  get mean(): number | null {
    const data = this.snapshot();
    if (data.length === 0) return null;
    return data.reduce((s, x) => s + x.latencyMs, 0) / data.length;
  }

  get min(): number | null {
    const data = this.snapshot();
    if (data.length === 0) return null;
    return Math.min(...data.map((s) => s.latencyMs));
  }

  get max(): number | null {
    const data = this.snapshot();
    if (data.length === 0) return null;
    return Math.max(...data.map((s) => s.latencyMs));
  }

  summary(): PerformanceMetrics {
    return {
      p50: this.p50,
      p95: this.p95,
      p99: this.p99,
      mean: this.mean,
      min: this.min,
      max: this.max,
      reliability: this.reliability,
      sampleCount: this.sampleCount,
      windowMs: this.windowMs,
      capturedAt: new Date().toISOString(),
    };
  }

  reset(): void {
    this.samples.splice(0);
  }
}
