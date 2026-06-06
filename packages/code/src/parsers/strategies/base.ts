/**
 * Strategy Pattern · Base
 *
 * Phase 2a of `@batiste-aidk/graph` consumes parsed symbols from this
 * package. To grow from 2 → ~25 supported languages without bloating
 * `TreeSitterAdapter`, each language ships as a self-contained
 * {@link LanguageStrategy} under `./strategies/<language>.ts`. Adding a
 * new language is then a one-file commit:
 *
 *   1. Add the npm `tree-sitter-<lang>` dependency.
 *   2. Create `./strategies/<lang>.ts` exporting a strategy.
 *   3. Register it in {@link defaultRegistry}.
 *   4. Add a unit test under `./__tests__/<lang>.test.ts`.
 *
 * The strategy contract is intentionally narrow — `name`, `extensions`,
 * `parserFactory`, `extractSymbols`, `extractImports` — so Phase 2b's
 * graph builder can consume any language uniformly. Strategies are NOT
 * allowed to leak tree-sitter types into their public surface; they
 * return the canonical {@link CodeSymbol} / {@link ImportStatement}
 * shapes from `../../config/LanguageStrategy`.
 */
import type Parser from 'tree-sitter';
import type {
  CodeSymbol,
  ImportStatement,
  LanguageStrategy as LegacyLanguageStrategy,
  QueryPatterns,
} from '../../config/LanguageStrategy.js';

export type { CodeSymbol, ImportStatement, QueryPatterns };

/**
 * The Phase 2a strategy contract.
 *
 * Mirrors the legacy {@link LegacyLanguageStrategy} shape under
 * `../../config/LanguageStrategy.ts` (same field names, same return
 * types) but lives in `./strategies/` to make the strategy boundary
 * explicit and to keep the legacy interface stable for existing
 * consumers (`RecursiveScout`, `SymbolResolver`).
 *
 * Implementations MUST be pure: no I/O, no global mutation. The
 * adapter owns the `Parser` instance, sets the language, walks the
 * tree, and the strategy only performs node extraction.
 */
export interface LanguageStrategy {
  /** Stable identifier — `typescript`, `python`, `go`, ... */
  readonly name: string;
  /** File extensions handled by this strategy (lower-cased, with leading dot). */
  readonly extensions: readonly string[];
  /** Returns the tree-sitter `Language` object; called once per adapter. */
  parserFactory(): unknown;
  /** Optional — query patterns for tree-sitter `Query` API consumers. */
  getQueryPatterns?(): QueryPatterns;
  /** Walk the tree and return the canonical symbol shape. */
  extractSymbols(tree: Parser.Tree, source: string): CodeSymbol[];
  /** Walk the tree and return the canonical import shape. */
  extractImports(tree: Parser.Tree, source: string): ImportStatement[];
}

/**
 * Adapt a Phase 2a {@link LanguageStrategy} to the legacy
 * {@link LegacyLanguageStrategy} shape consumed by
 * `TreeSitterAdapter`. Keeps the strategy authors' surface narrow
 * while preserving backwards compatibility for the old contract.
 */
export function toLegacyStrategy(strategy: LanguageStrategy): LegacyLanguageStrategy {
  return {
    languageId: strategy.name,
    extensions: [...strategy.extensions],
    getParser: () => strategy.parserFactory(),
    getQueryPatterns: () =>
      strategy.getQueryPatterns?.() ?? {
        functionDefinitions: '',
        callSites: '',
      },
    extractSymbols: (tree: unknown, source: string): CodeSymbol[] =>
      strategy.extractSymbols(tree as Parser.Tree, source),
    extractImports: (tree: unknown, source: string): ImportStatement[] =>
      strategy.extractImports(tree as Parser.Tree, source),
  };
}

/**
 * Walk every named node in the tree, calling `visit` once per node.
 * Centralises the cursor dance so strategy implementations stay
 * declarative.
 */
export function walkTree(tree: Parser.Tree, visit: (node: Parser.SyntaxNode) => void): void {
  const cursor = tree.walk();
  const recurse = (): void => {
    visit(cursor.currentNode);
    if (cursor.gotoFirstChild()) {
      do {
        recurse();
      } while (cursor.gotoNextSibling());
      cursor.gotoParent();
    }
  };
  recurse();
}

/** Project a tree-sitter node's position onto the canonical 1-indexed range used by {@link CodeSymbol}. */
export function nodeRange(node: Parser.SyntaxNode): Pick<
  CodeSymbol,
  'startLine' | 'endLine' | 'startColumn' | 'endColumn'
> {
  return {
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    startColumn: node.startPosition.column,
    endColumn: node.endPosition.column,
  };
}

/** Strip surrounding `'` / `"` / `` ` `` quotes from a tree-sitter string node's text. */
export function unquoteStringLiteral(text: string): string {
  if (text.length < 2) return text;
  const first = text[0];
  const last = text[text.length - 1];
  if ((first === '"' || first === "'" || first === '`') && first === last) {
    return text.slice(1, -1);
  }
  return text;
}
