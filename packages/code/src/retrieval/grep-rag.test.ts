import { describe, it, expect } from 'vitest';
import { mergeOverlappingHits, rerankByBm25, tokenize, type RetrievalHit } from './grep-rag.js';

const hit = (filePath: string, startLine: number, endLine: number, text: string, score?: number): RetrievalHit =>
  ({ filePath, startLine, endLine, text, score });

describe('mergeOverlappingHits', () => {
  it('collapses overlapping hits in the same file into one', () => {
    const merged = mergeOverlappingHits([
      hit('a.ts', 10, 12, 'a'),
      hit('a.ts', 11, 15, 'bb'),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ startLine: 10, endLine: 15 });
  });

  it('merges hits within the gap window even when not overlapping', () => {
    const merged = mergeOverlappingHits([hit('a.ts', 10, 10, 'x'), hit('a.ts', 11, 11, 'y')], new Map(), 1);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ startLine: 10, endLine: 11 });
  });

  it('keeps hits in different files separate', () => {
    const merged = mergeOverlappingHits([hit('a.ts', 1, 5, 'x'), hit('b.ts', 1, 5, 'y')]);
    expect(merged).toHaveLength(2);
  });

  it('does not merge hits separated by more than the gap', () => {
    const merged = mergeOverlappingHits([hit('a.ts', 1, 2, 'x'), hit('a.ts', 10, 11, 'y')], new Map(), 1);
    expect(merged).toHaveLength(2);
  });

  it('rebuilds merged text from file lines when provided', () => {
    const lines = ['l1', 'l2', 'l3', 'l4', 'l5'];
    const merged = mergeOverlappingHits(
      [hit('a.ts', 1, 2, 'stale'), hit('a.ts', 2, 4, 'stale')],
      new Map([['a.ts', lines]]),
    );
    expect(merged[0]!.text).toBe('l1\nl2\nl3\nl4');
  });

  it('takes the max score across merged hits', () => {
    const merged = mergeOverlappingHits([hit('a.ts', 1, 3, 'x', 0.4), hit('a.ts', 2, 4, 'y', 0.9)]);
    expect(merged[0]!.score).toBe(0.9);
  });
});

describe('tokenize', () => {
  it('explodes camelCase and snake_case into parts plus the whole token', () => {
    expect(tokenize('parseLedgerEntry')).toEqual(expect.arrayContaining(['parseledgerentry', 'parse', 'ledger', 'entry']));
    expect(tokenize('audit_log_table')).toEqual(expect.arrayContaining(['audit_log_table', 'audit', 'log', 'table']));
  });
});

describe('rerankByBm25', () => {
  it('ranks the hit containing the query identifier first', () => {
    const ranked = rerankByBm25('tokenTotals', [
      hit('a.ts', 1, 3, 'function unrelated() { return computeSomethingElse(); }'),
      hit('b.ts', 1, 3, 'function tokenTotals() { return sumInputTokens(); }'),
    ]);
    expect(ranked[0]!.filePath).toBe('b.ts');
    expect(ranked[0]!.score!).toBeGreaterThan(ranked[1]!.score!);
  });

  it('weights identifier terms above common words', () => {
    // "the" appears everywhere; "AuditLedger" is the real signal.
    const ranked = rerankByBm25('the AuditLedger', [
      hit('a.ts', 1, 1, 'the the the the the the'),
      hit('b.ts', 1, 1, 'class AuditLedger { append() {} }'),
    ]);
    expect(ranked[0]!.filePath).toBe('b.ts');
  });

  it('is a pure function — does not mutate inputs', () => {
    const input = [hit('a.ts', 1, 1, 'foo')];
    rerankByBm25('foo', input);
    expect(input[0]!.score).toBeUndefined();
  });

  it('returns empty for empty input', () => {
    expect(rerankByBm25('q', [])).toEqual([]);
  });
});
