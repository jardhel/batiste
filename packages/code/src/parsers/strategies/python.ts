/**
 * Python strategy.
 *
 * Phase 2a wrapper around the long-standing
 * {@link PythonStrategy} under `../../config/`. Same rationale as
 * `./typescript.ts` — wrap, do not rewrite, to avoid regressing the
 * existing test suite.
 */
import type Parser from 'tree-sitter';
import { PythonStrategy as LegacyPythonStrategy } from '../../config/PythonStrategy.js';
import type { CodeSymbol, ImportStatement, LanguageStrategy } from './base.js';

const legacy = new LegacyPythonStrategy();

export const pythonStrategy: LanguageStrategy = {
  name: 'python',
  extensions: ['.py', '.pyi'],
  parserFactory: () => legacy.getParser(),
  getQueryPatterns: () => legacy.getQueryPatterns(),
  extractSymbols: (tree: Parser.Tree, source: string): CodeSymbol[] =>
    legacy.extractSymbols(tree, source),
  extractImports: (tree: Parser.Tree, source: string): ImportStatement[] =>
    legacy.extractImports(tree, source),
};
