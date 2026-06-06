import { describe, it, expect } from 'vitest';
import { chunkSource, type Chunk } from './cast-chunker.js';
import { TreeSitterAdapter } from '../parsers/TreeSitterAdapter.js';
import type { ParseResult } from '../parsers/TreeSitterAdapter.js';
import type { CodeSymbol } from '../config/LanguageStrategy.js';

const sym = (name: string, type: CodeSymbol['type'], startLine: number, endLine: number): CodeSymbol => ({
  name, type, startLine, endLine,
});

const parse = (filePath: string, symbols: CodeSymbol[]): ParseResult => ({
  filePath, language: 'typescript', symbols, imports: [], parseTimeMs: 0, errors: [],
});

/** A chunk set must tile the file: cover [1..N] with no gaps or overlaps. */
function assertTiles(chunks: Chunk[], lineCount: number): void {
  const sorted = [...chunks].sort((a, b) => a.startLine - b.startLine);
  expect(sorted[0]!.startLine).toBe(1);
  expect(sorted[sorted.length - 1]!.endLine).toBe(lineCount);
  for (let i = 1; i < sorted.length; i++) {
    expect(sorted[i]!.startLine).toBe(sorted[i - 1]!.endLine + 1);
  }
}

describe('cAST chunker', () => {
  it('tiles the whole file with no gaps or overlaps', () => {
    const source = Array.from({ length: 30 }, (_, i) => `line ${i + 1} content here`).join('\n');
    const chunks = chunkSource(source, parse('a.ts', [sym('foo', 'function', 3, 10), sym('bar', 'function', 12, 20)]));
    assertTiles(chunks, 30);
  });

  it('keeps a symbol that fits the budget whole in one chunk', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `  const x${i} = ${i};`);
    const source = lines.join('\n');
    const chunks = chunkSource(source, parse('a.ts', [sym('foo', 'function', 5, 12)]), { maxNonWsChars: 10_000 });
    const owning = chunks.filter((c) => c.symbols.includes('foo'));
    expect(owning).toHaveLength(1);
    expect(owning[0]!.startLine).toBeLessThanOrEqual(5);
    expect(owning[0]!.endLine).toBeGreaterThanOrEqual(12);
  });

  it('merges small adjacent symbols into a single chunk under a generous budget', () => {
    const source = Array.from({ length: 12 }, (_, i) => `f${i}();`).join('\n');
    const chunks = chunkSource(source, parse('a.ts', [
      sym('a', 'function', 1, 3), sym('b', 'function', 4, 6), sym('c', 'function', 7, 9),
    ]), { maxNonWsChars: 10_000 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.symbols).toEqual(['a', 'b', 'c']);
  });

  it('recurses into an oversized class, chunking at method boundaries', () => {
    // A class spanning 1..18 whose two methods each fit the budget but whose
    // body as a whole does not. The split must land on method boundaries, so
    // each method's body stays whole in one chunk — never straddled.
    const source = Array.from({ length: 18 }, (_, i) => `code line ${i + 1}`).join('\n');
    const chunks = chunkSource(source, parse('a.ts', [
      sym('Svc', 'class', 1, 18),
      sym('methodA', 'method', 2, 9),
      sym('methodB', 'method', 10, 17),
    ]), { maxNonWsChars: 100 });
    assertTiles(chunks, 18);
    // Each method's body lands fully within a single chunk (not straddled).
    for (const name of ['methodA', 'methodB']) {
      const owners = chunks.filter((c) => c.symbols.includes(name));
      expect(owners).toHaveLength(1);
    }
  });

  it('hard-splits an oversized leaf symbol and tags the fragments', () => {
    const source = Array.from({ length: 60 }, (_, i) => `YYYYYYYYYYYYYYY ${i + 1}`).join('\n');
    const chunks = chunkSource(source, parse('a.ts', [sym('huge', 'function', 1, 60)]), { maxNonWsChars: 100 });
    assertTiles(chunks, 60);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.kind === 'split')).toBe(true);
  });

  it('degrades to a bounded line split when nothing parses', () => {
    const source = Array.from({ length: 50 }, (_, i) => `ZZZZZZZZZZ ${i}`).join('\n');
    const chunks = chunkSource(source, parse('a.ts', []), { maxNonWsChars: 80 });
    assertTiles(chunks, 50);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.kind === 'gap')).toBe(true);
  });

  it('ignores call-site symbols as chunk boundaries', () => {
    const source = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n');
    const chunks = chunkSource(source, parse('a.ts', [sym('doThing', 'call', 5, 5)]), { maxNonWsChars: 10_000 });
    // No structural symbols → one gap chunk, call ignored.
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.kind).toBe('gap');
  });

  it('integrates with the real parser on TypeScript source', () => {
    const adapter = new TreeSitterAdapter();
    const source = [
      'import { z } from "zod";',
      '',
      'export function alpha(a: number): number {',
      '  return a + 1;',
      '}',
      '',
      'export function beta(b: number): number {',
      '  return b * 2;',
      '}',
    ].join('\n');
    const result = adapter.parseSource(source, 'demo.ts');
    expect(result.symbols.length).toBeGreaterThan(0);
    const chunks = chunkSource(source, result, { maxNonWsChars: 10_000 });
    assertTiles(chunks, source.split('\n').length);
    // Both functions are captured as structural symbols across the chunk set.
    const captured = new Set(chunks.flatMap((c) => c.symbols));
    expect(captured.has('alpha')).toBe(true);
    expect(captured.has('beta')).toBe(true);
  });
});
