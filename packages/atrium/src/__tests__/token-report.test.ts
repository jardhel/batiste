/**
 * Pure-function unit tests for `token-report`. We don't spin up the CLI;
 * we exercise the three calculator surfaces directly:
 *   - bucketCost / cacheSavings (the rate math)
 *   - applyEvent (window + cwd + day bucketing)
 *
 * Live jsonl scanning is covered by the smoke-test the operator runs from
 * the README and the manual integration check in CI.
 */

import { describe, expect, it } from 'vitest';
import {
  applyEvent,
  bucketCost,
  cacheSavings,
  dayKey,
  type TokenReport,
  type UsageBucket,
} from '../commands/token-report.js';
import { RATES } from '../utils/anthropic-rates.js';

function emptyReport(days = 7): TokenReport {
  const now = Date.now();
  return {
    window: {
      startIso: new Date(now - days * 86_400_000).toISOString(),
      endIso: new Date(now).toISOString(),
      days,
    },
    rates: RATES,
    perDay: {},
    perCwd: {},
    total: { input: 0, cacheRead: 0, cacheCreate: 0, output: 0, events: 0, files: 0, lines: 0 },
    costTotalUsd: 0,
    cacheSavingsUsd: 0,
    noCacheCostUsd: 0,
  };
}

describe('bucketCost', () => {
  it('sums usage * rate / 1M across the four token kinds', () => {
    const bucket: UsageBucket = {
      input: 1_000_000,
      cacheRead: 1_000_000,
      cacheCreate: 1_000_000,
      output: 1_000_000,
      events: 1,
    };
    // 1M tokens of each at the default rates: 15 + 1.50 + 18.75 + 75 = 110.25
    expect(bucketCost(bucket)).toBeCloseTo(110.25, 4);
  });

  it('zero usage costs zero', () => {
    expect(bucketCost({ input: 0, cacheRead: 0, cacheCreate: 0, output: 0, events: 0 })).toBe(0);
  });
});

describe('cacheSavings', () => {
  it('returns the input-vs-cache-read price gap times read tokens', () => {
    const bucket: UsageBucket = {
      input: 0,
      cacheRead: 2_000_000,
      cacheCreate: 0,
      output: 0,
      events: 1,
    };
    // 2M cache reads * (15 - 1.50) / 1M = $27
    expect(cacheSavings(bucket)).toBeCloseTo(27, 4);
  });
});

describe('dayKey', () => {
  it('returns YYYY-MM-DD in UTC', () => {
    expect(dayKey('2026-04-24T03:14:15.000Z')).toBe('2026-04-24');
  });
  it('handles invalid timestamps without throwing', () => {
    expect(dayKey('not-a-date')).toBe('invalid');
  });
});

describe('applyEvent', () => {
  it('skips non-assistant events', () => {
    const report = emptyReport();
    const windowStart = Date.parse(report.window.startIso);
    const ok = applyEvent(
      report,
      'cwd-x',
      { type: 'user', timestamp: new Date().toISOString(), message: { usage: { input_tokens: 5 } } },
      windowStart,
    );
    expect(ok).toBe(false);
    expect(report.total.events).toBe(0);
  });

  it('skips events older than the window', () => {
    const report = emptyReport(7);
    const windowStart = Date.parse(report.window.startIso);
    const old = new Date(windowStart - 86_400_000).toISOString();
    const ok = applyEvent(
      report,
      'cwd-x',
      { type: 'assistant', timestamp: old, message: { usage: { input_tokens: 100 } } },
      windowStart,
    );
    expect(ok).toBe(false);
    expect(report.total.events).toBe(0);
  });

  it('buckets by day and by cwd in a single pass', () => {
    const report = emptyReport(30);
    const windowStart = Date.parse(report.window.startIso);
    const events: { ts: string; cwd: string; usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number } }[] = [
      {
        ts: '2026-04-22T10:00:00.000Z',
        cwd: 'project-a',
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1_000, cache_creation_input_tokens: 200 },
      },
      {
        ts: '2026-04-22T22:00:00.000Z',
        cwd: 'project-a',
        usage: { input_tokens: 50, output_tokens: 25, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 },
      },
      {
        ts: '2026-04-23T01:00:00.000Z',
        cwd: 'project-b',
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    ];
    // Override windowStart so all events fall within the test window
    // regardless of `now`. Use Jan 1 2026.
    const fixedWindow = Date.parse('2026-01-01T00:00:00.000Z');
    for (const e of events) {
      applyEvent(report, e.cwd, { type: 'assistant', timestamp: e.ts, message: { usage: e.usage } }, fixedWindow);
    }

    expect(report.total.events).toBe(3);
    expect(report.total.input).toBe(160);
    expect(report.total.output).toBe(80);
    expect(report.total.cacheRead).toBe(1500);
    expect(report.total.cacheCreate).toBe(200);

    expect(report.perDay['2026-04-22']?.events).toBe(2);
    expect(report.perDay['2026-04-23']?.events).toBe(1);
    expect(report.perCwd['project-a']?.events).toBe(2);
    expect(report.perCwd['project-b']?.events).toBe(1);
    // Cross-check the two project-a events landed in the right cwd bucket.
    expect(report.perCwd['project-a']?.input).toBe(150);
    expect(report.perCwd['project-b']?.input).toBe(10);

    // Suppress "windowStart unused" warning — verify it was at least
    // computed (the real applyEvent path uses it).
    expect(typeof windowStart).toBe('number');
  });

  it('skips events without a usage block', () => {
    const report = emptyReport();
    const windowStart = Date.parse(report.window.startIso);
    const ok = applyEvent(
      report,
      'cwd-x',
      { type: 'assistant', timestamp: new Date().toISOString(), message: {} },
      windowStart,
    );
    expect(ok).toBe(false);
  });
});
