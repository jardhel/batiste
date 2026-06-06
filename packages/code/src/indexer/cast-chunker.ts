/**
 * cAST — structure-aware code chunking.
 *
 * Splits a source file into retrieval chunks that respect syntactic
 * boundaries instead of cutting at fixed line/char offsets. The approach
 * follows "cAST: Enhancing Code RAG with Structural Chunking" (arXiv
 * 2506.15655): recursively split the syntax tree, then greedily merge
 * sibling units into chunks up to a size budget, so a chunk never straddles
 * the middle of a function or class.
 *
 * This consumes the canonical {@link ParseResult} from
 * {@link TreeSitterAdapter} (symbol ranges only) — no tree-sitter types
 * cross the boundary, matching the package's strategy contract. A file that
 * fails to parse (no symbols) degrades to a size-bounded line split, so the
 * chunker is total: every line of the source lands in exactly one chunk.
 */

import type { CodeSymbol } from '../config/LanguageStrategy.js';
import type { ParseResult } from '../parsers/TreeSitterAdapter.js';

export interface Chunk {
  filePath: string;
  /** 1-indexed inclusive. */
  startLine: number;
  /** 1-indexed inclusive. */
  endLine: number;
  text: string;
  /** Names of structural symbols whose body is fully contained in this chunk. */
  symbols: string[];
  /**
   * `symbol`  — one or more whole symbols (and surrounding module code).
   * `split`   — a fragment of a symbol too large to fit the budget alone.
   * `gap`     — module-level code outside any symbol (imports, top-level statements).
   */
  kind: 'symbol' | 'split' | 'gap';
}

export interface CastOptions {
  /**
   * Soft budget, in non-whitespace characters, for one chunk. Whitespace is
   * excluded because indentation inflates byte size without adding tokens of
   * signal. A symbol larger than this is split; smaller siblings are merged
   * up to it.
   */
  maxNonWsChars?: number;
  /** Hard ceiling on lines per chunk — a backstop for minified/one-line files. */
  maxLines?: number;
}

const DEFAULT_MAX_NON_WS = 1200;
const DEFAULT_MAX_LINES = 400;

/** Structural symbol kinds that bound a chunk. `call` is a reference, not a region. */
const STRUCTURAL = new Set<CodeSymbol['type']>(['function', 'method', 'class']);

type Region = { start: number; end: number }; // 1-indexed inclusive line range

/** Count of non-whitespace characters in a slice of lines [start, end] (1-indexed). */
function nonWsSize(lines: string[], start: number, end: number): number {
  let n = 0;
  for (let i = start - 1; i < end && i < lines.length; i++) {
    const line = lines[i]!;
    for (let c = 0; c < line.length; c++) {
      if (!/\s/.test(line[c]!)) n++;
    }
  }
  return n;
}

function sliceText(lines: string[], start: number, end: number): string {
  return lines.slice(start - 1, end).join('\n');
}

/**
 * Chunk a parsed source file structurally.
 *
 * @param source   Full file text.
 * @param parse    Parse result from {@link TreeSitterAdapter.parseSource}.
 * @param opts     Size budget overrides.
 */
export function chunkSource(source: string, parse: ParseResult, opts: CastOptions = {}): Chunk[] {
  const maxNonWs = opts.maxNonWsChars ?? DEFAULT_MAX_NON_WS;
  const maxLines = opts.maxLines ?? DEFAULT_MAX_LINES;
  const lines = source.split('\n');
  const lastLine = lines.length;
  if (lastLine === 0) return [];

  // Keep only well-formed structural symbols, de-duplicated by range.
  const seen = new Set<string>();
  const symbols = parse.symbols
    .filter((s) => STRUCTURAL.has(s.type) && s.endLine >= s.startLine && s.startLine >= 1)
    .filter((s) => {
      const key = `${s.startLine}:${s.endLine}:${s.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine);

  const chunks: Chunk[] = [];
  const emit = (start: number, end: number, kind: Chunk['kind']): void => {
    if (end < start) return;
    chunks.push({
      filePath: parse.filePath,
      startLine: start,
      endLine: end,
      text: sliceText(lines, start, end),
      symbols: symbols.filter((s) => s.startLine >= start && s.endLine <= end).map((s) => s.name),
      kind,
    });
  };

  packRegion({ start: 1, end: lastLine }, symbols, lines, maxNonWs, maxLines, emit);
  return chunks;
}

/**
 * Pack a line region into chunks, recursing into any single symbol that
 * exceeds the budget. `symbolsInRegion` is the set of structural symbols
 * whose ranges fall inside `region`.
 */
function packRegion(
  region: Region,
  symbolsInRegion: CodeSymbol[],
  lines: string[],
  maxNonWs: number,
  maxLines: number,
  emit: (start: number, end: number, kind: Chunk['kind']) => void,
): void {
  // Top-level symbols within this region: not contained by another symbol
  // that is itself in the region.
  const roots = symbolsInRegion.filter(
    (s) =>
      s.startLine >= region.start &&
      s.endLine <= region.end &&
      !symbolsInRegion.some(
        (p) => p !== s && p.startLine <= s.startLine && p.endLine >= s.endLine &&
          !(p.startLine === s.startLine && p.endLine === s.endLine),
      ),
  );

  // No structure here → size-bounded line split (base case).
  if (roots.length === 0) {
    hardSplit(region, lines, maxNonWs, maxLines, emit, 'gap');
    return;
  }

  // Build an ordered cover of the region: gap segments between symbols, and
  // one block per root symbol.
  type Block = { region: Region; sym?: CodeSymbol };
  const blocks: Block[] = [];
  let cursor = region.start;
  for (const sym of roots) {
    if (sym.startLine > cursor) blocks.push({ region: { start: cursor, end: sym.startLine - 1 } });
    blocks.push({ region: { start: sym.startLine, end: sym.endLine }, sym });
    cursor = sym.endLine + 1;
  }
  if (cursor <= region.end) blocks.push({ region: { start: cursor, end: region.end } });

  // Greedily merge consecutive blocks up to the budget. An oversized symbol
  // block is recursed into; an oversized gap block is hard-split.
  let bufStart: number | null = null;
  let bufEnd = 0;
  const flush = (): void => {
    if (bufStart !== null) {
      emit(bufStart, bufEnd, 'symbol');
      bufStart = null;
    }
  };

  for (const block of blocks) {
    const size = nonWsSize(lines, block.region.start, block.region.end);
    const blockLines = block.region.end - block.region.start + 1;
    const oversized = size > maxNonWs || blockLines > maxLines;

    if (oversized) {
      flush();
      if (block.sym) {
        const children = symbolsInRegion.filter(
          (c) =>
            c !== block.sym &&
            c.startLine >= block.region.start &&
            c.endLine <= block.region.end,
        );
        if (children.length > 0) {
          packRegion(block.region, children, lines, maxNonWs, maxLines, emit);
        } else {
          hardSplit(block.region, lines, maxNonWs, maxLines, emit, 'split');
        }
      } else {
        hardSplit(block.region, lines, maxNonWs, maxLines, emit, 'gap');
      }
      continue;
    }

    // Would merging overflow the buffer? Flush first.
    if (bufStart !== null && nonWsSize(lines, bufStart, block.region.end) > maxNonWs) {
      flush();
    }
    if (bufStart === null) bufStart = block.region.start;
    bufEnd = block.region.end;
  }
  flush();
}

/** Split a region into line-aligned pieces each within the budget. */
function hardSplit(
  region: Region,
  lines: string[],
  maxNonWs: number,
  maxLines: number,
  emit: (start: number, end: number, kind: Chunk['kind']) => void,
  kind: Chunk['kind'],
): void {
  let start = region.start;
  while (start <= region.end) {
    let end = start;
    while (
      end < region.end &&
      end - start + 1 < maxLines &&
      nonWsSize(lines, start, end + 1) <= maxNonWs
    ) {
      end++;
    }
    emit(start, end, kind);
    start = end + 1;
  }
}
