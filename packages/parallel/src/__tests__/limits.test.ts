import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getCpuConcurrency,
  getRpmLimit,
  getAvailableMemoryBytes,
  rpmToConcurrency,
} from '../limits.js';

const TIERS: Array<['1' | '2' | '3' | '4', { opus: number; sonnet: number; haiku: number }]> = [
  ['1', { opus: 50, sonnet: 1000, haiku: 2000 }],
  ['2', { opus: 1000, sonnet: 2000, haiku: 4000 }],
  ['3', { opus: 2000, sonnet: 4000, haiku: 4000 }],
  ['4', { opus: 4000, sonnet: 8000, haiku: 8000 }],
];

describe('limits', () => {
  describe('getRpmLimit', () => {
    for (const [tier, expected] of TIERS) {
      it(`tier ${tier} matches the published table`, () => {
        expect(getRpmLimit('opus', tier)).toBe(expected.opus);
        expect(getRpmLimit('sonnet', tier)).toBe(expected.sonnet);
        expect(getRpmLimit('haiku', tier)).toBe(expected.haiku);
      });
    }

    it('returns null for enterprise (skip throttling)', () => {
      expect(getRpmLimit('opus', 'enterprise')).toBeNull();
      expect(getRpmLimit('sonnet', 'enterprise')).toBeNull();
      expect(getRpmLimit('haiku', 'enterprise')).toBeNull();
    });

    it('returns null for unknown tier', () => {
      expect(getRpmLimit('opus', 'bogus')).toBeNull();
    });

    describe('with ANTHROPIC_TIER env override', () => {
      const original = process.env.ANTHROPIC_TIER;
      afterEach(() => {
        if (original === undefined) delete process.env.ANTHROPIC_TIER;
        else process.env.ANTHROPIC_TIER = original;
      });

      it('reads ANTHROPIC_TIER when no explicit tier passed', () => {
        process.env.ANTHROPIC_TIER = '3';
        expect(getRpmLimit('opus')).toBe(2000);
        expect(getRpmLimit('sonnet')).toBe(4000);
      });

      it('defaults to tier 1 when env unset', () => {
        delete process.env.ANTHROPIC_TIER;
        expect(getRpmLimit('opus')).toBe(50);
      });

      it('explicit tier arg beats env', () => {
        process.env.ANTHROPIC_TIER = '4';
        expect(getRpmLimit('opus', '1')).toBe(50);
      });
    });
  });

  describe('getCpuConcurrency', () => {
    it('returns a positive integer', () => {
      const n = getCpuConcurrency();
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getAvailableMemoryBytes', () => {
    it('returns a non-negative number', () => {
      expect(getAvailableMemoryBytes()).toBeGreaterThanOrEqual(0);
    });
  });

  describe('rpmToConcurrency', () => {
    it('returns null when rpm is null (enterprise/skip)', () => {
      expect(rpmToConcurrency(null)).toBeNull();
    });
    it('produces a positive integer for a real rpm', () => {
      const n = rpmToConcurrency(1000, 4000);
      expect(n).not.toBeNull();
      expect(Number.isInteger(n!)).toBe(true);
      expect(n!).toBeGreaterThanOrEqual(1);
    });
  });
});

// Touch beforeEach to silence noUnusedImports in some configs.
beforeEach(() => undefined);
