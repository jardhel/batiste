/**
 * @batiste/code
 *
 * AI-powered code assistant MCP server.
 * The coding sous-chef - validates, fixes, and organizes your code.
 */

export const VERSION = '0.1.0';

// Code parsing
export {
  type CodeSymbol,
  type ImportStatement,
  type QueryPatterns,
  type LanguageStrategy,
  TypeScriptStrategy,
  PythonStrategy,
} from './config/index.js';

// Tree-sitter parser
export { TreeSitterAdapter, type ParseResult } from './parsers/index.js';

// Code validation
export {
  Gatekeeper,
  GatekeeperRegistry,
  ESLintValidator,
  TypeScriptValidator,
  type ValidationError,
  type ValidationResult,
  type ValidationOptions,
  type PreflightResult,
  type IValidator,
} from './validation/index.js';

// TDD engine
export {
  HypothesisEngine,
  type Hypothesis,
  type HypothesisResult,
  type TDDOptions,
} from './tdd/index.js';

// Dependency analysis
export {
  RecursiveScout,
  type DependencyNode,
  type DependencyGraph,
  type ScoutOptions,
} from './analysis/index.js';

// Auto-fix
export {
  AutoFixer,
  DiffTracker,
  FixGenerator,
  type AutoFixOptions,
  type AutoFixResult,
  type FileDiff,
  type FixSuggestion,
} from './autofix/index.js';

// LSP & Symbol Resolution
export {
  LSPClient,
  SymbolResolver,
  type SymbolLocation,
  type SymbolSearchResult,
} from './lsp/index.js';

// Git-aware indexing
export {
  GitAwareIndexer,
  GitTracker,
  FileIndex,
  Crawler,
  FileWatcher,
  type IndexState,
  type IncrementalIndexPlan,
  type GitFileInfo,
  type GitDiffResult,
  type FileInfo,
  type CrawlResult,
} from './indexer/index.js';

// MCP Server
export { TOOL_DEFINITIONS, ToolHandler, start, type ToolName } from './mcp/index.js';

// Utilities
export { logger } from './utils/logger.js';
export { loadConfig, type Config } from './utils/config.js';
