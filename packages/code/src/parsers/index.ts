/**
 * `@batiste-aidk/code` · parsers public surface.
 *
 * Re-exports the adapter (legacy entry point), the Phase 2a strategy
 * registry, and every default strategy. Phase 2b's graph builder
 * imports from here when it needs the canonical list of supported
 * languages.
 */
export { TreeSitterAdapter, type ParseResult } from './TreeSitterAdapter.js';
export {
  DEFAULT_STRATEGIES,
  LanguageRegistry,
  defaultRegistry,
  defaultRegistrySync,
  toLegacyStrategy,
  nodeRange,
  unquoteStringLiteral,
  walkTree,
  typescriptStrategy,
  pythonStrategy,
  javascriptStrategy,
  goStrategy,
  rustStrategy,
  type LanguageStrategy,
  type CodeSymbol,
  type ImportStatement,
  type QueryPatterns,
} from './strategies/index.js';
