/**
 * TypeScript / TSX strategy.
 *
 * Phase 2a wrapper around the long-standing
 * {@link TypeScriptStrategy} under `../../config/`. The wrapper exists
 * so the strategy file lives next to its peers under `./strategies/`,
 * which keeps "add a new language" a single-file diff. We deliberately
 * delegate `extractSymbols` / `extractImports` to the legacy
 * implementation — the TS path is the most heavily exercised in the
 * existing test suite, and re-implementing it would be a regression
 * risk for zero gain in Phase 2a.
 *
 * The legacy strategy claims `.js` / `.jsx` too. Phase 2a moves those
 * to {@link import('./javascript.js').javascriptStrategy} so JS files
 * get the JS grammar, which is friendlier to vanilla JS than the TS
 * grammar's superset semantics.
 */
import type Parser from 'tree-sitter';
import { TypeScriptStrategy as LegacyTypeScriptStrategy } from '../../config/TypeScriptStrategy.js';
import type { CodeSymbol, ImportStatement, LanguageStrategy } from './base.js';

const legacy = new LegacyTypeScriptStrategy();

export const typescriptStrategy: LanguageStrategy = {
  name: 'typescript',
  // Note: `.js` / `.jsx` intentionally moved to javascriptStrategy.
  extensions: ['.ts', '.tsx'],
  parserFactory: () => legacy.getParser(),
  getQueryPatterns: () => legacy.getQueryPatterns(),
  extractSymbols: (tree: Parser.Tree, source: string): CodeSymbol[] =>
    legacy.extractSymbols(tree, source),
  extractImports: (tree: Parser.Tree, source: string): ImportStatement[] =>
    legacy.extractImports(tree, source),
};
