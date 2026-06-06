/**
 * TreeSitter Adapter
 *
 * Unified interface for parsing multiple languages using tree-sitter.
 * Phase 2a refactor — the adapter now holds a {@link LanguageRegistry}
 * (`./strategies/`) and delegates language lookup to it. Adding a new
 * language is now a one-file commit under `./strategies/<lang>.ts`
 * plus one line in `DEFAULT_STRATEGIES` — the adapter itself never
 * needs to change.
 *
 * The legacy `LanguageStrategy` shape (`config/LanguageStrategy.ts`)
 * is preserved so consumers that constructed strategies by hand
 * (`adapter.registerStrategy(new TypeScriptStrategy())`) keep working.
 * Internally we wrap Phase 2a strategies into the legacy shape via
 * {@link toLegacyStrategy} so the adapter's parsing loop stays
 * unchanged.
 */

import Parser from 'tree-sitter';
import { readFile } from 'fs/promises';
import { extname } from 'path';
import type {
  LanguageStrategy as LegacyLanguageStrategy,
  CodeSymbol,
  ImportStatement,
} from '../config/LanguageStrategy.js';
import {
  DEFAULT_STRATEGIES,
  LanguageRegistry,
  toLegacyStrategy,
  type LanguageStrategy as Phase2aStrategy,
} from './strategies/index.js';

export interface ParseResult {
  filePath: string;
  language: string;
  symbols: CodeSymbol[];
  imports: ImportStatement[];
  parseTimeMs: number;
  errors: string[];
}

interface CachedParse {
  result: ParseResult;
  sourceHash: string;
  cachedAt: number;
}

export class TreeSitterAdapter {
  private parser: Parser;
  private registry: LanguageRegistry;
  /** Keeps the legacy shape callers received from `getStrategyForFile`. */
  private legacyByName: Map<string, LegacyLanguageStrategy>;
  private legacyByExt: Map<string, LegacyLanguageStrategy>;
  private cache: Map<string, CachedParse>;

  constructor() {
    this.parser = new Parser();
    this.registry = new LanguageRegistry();
    this.legacyByName = new Map();
    this.legacyByExt = new Map();
    this.cache = new Map();

    // Load every default strategy. The registry de-dupes by name/ext
    // so a later `registerStrategy` call from user code still wins.
    for (const strategy of DEFAULT_STRATEGIES) {
      this.registerPhase2aStrategy(strategy);
    }
  }

  /** Phase 2a entry point — register a strategy authored against `./strategies/base.ts`. */
  registerPhase2aStrategy(strategy: Phase2aStrategy): void {
    this.registry.register(strategy);
    this.indexLegacy(toLegacyStrategy(strategy));
  }

  /**
   * Legacy entry point — register a strategy authored against the
   * pre-Phase-2a `LanguageStrategy` shape. Preserved so existing
   * downstream code (`adapter.registerStrategy(new TypeScriptStrategy())`)
   * keeps working unchanged.
   */
  registerStrategy(strategy: LegacyLanguageStrategy): void {
    this.indexLegacy(strategy);
  }

  private indexLegacy(strategy: LegacyLanguageStrategy): void {
    this.legacyByName.set(strategy.languageId, strategy);
    for (const ext of strategy.extensions) {
      this.legacyByExt.set(ext.toLowerCase(), strategy);
    }
  }

  /** Public registry access — Phase 2b graph builder consumes this. */
  getRegistry(): LanguageRegistry {
    return this.registry;
  }

  getStrategyForFile(filePath: string): LegacyLanguageStrategy | null {
    const ext = extname(filePath).toLowerCase();
    return this.legacyByExt.get(ext) ?? null;
  }

  getStrategyForName(name: string): LegacyLanguageStrategy | null {
    return this.legacyByName.get(name) ?? null;
  }

  isSupported(filePath: string): boolean {
    return this.getStrategyForFile(filePath) !== null;
  }

  getSupportedExtensions(): string[] {
    return Array.from(this.legacyByExt.keys());
  }

  getSupportedLanguages(): string[] {
    return Array.from(this.legacyByName.keys());
  }

  async parseFile(filePath: string): Promise<ParseResult> {
    const strategy = this.getStrategyForFile(filePath);
    if (!strategy) {
      return {
        filePath,
        language: 'unknown',
        symbols: [],
        imports: [],
        parseTimeMs: 0,
        errors: [`Unsupported file type: ${extname(filePath)}`],
      };
    }

    try {
      const source = await readFile(filePath, 'utf-8');
      return this.parseSource(source, filePath, strategy);
    } catch (error) {
      return {
        filePath,
        language: strategy.languageId,
        symbols: [],
        imports: [],
        parseTimeMs: 0,
        errors: [`Failed to read file: ${(error as Error).message}`],
      };
    }
  }

  parseSource(source: string, filePath: string, strategy?: LegacyLanguageStrategy): ParseResult {
    const resolvedStrategy = strategy ?? this.getStrategyForFile(filePath);
    if (!resolvedStrategy) {
      return {
        filePath,
        language: 'unknown',
        symbols: [],
        imports: [],
        parseTimeMs: 0,
        errors: [`Unsupported file type: ${extname(filePath)}`],
      };
    }

    const sourceHash = this.hashSource(source);
    const cached = this.cache.get(filePath);
    if (cached && cached.sourceHash === sourceHash) {
      return cached.result;
    }

    const startTime = performance.now();
    const errors: string[] = [];

    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      this.parser.setLanguage(resolvedStrategy.getParser() as never);
      const tree = this.parser.parse(source);

      if (tree.rootNode.hasError) {
        errors.push('Parse tree contains errors');
      }

      const symbols = resolvedStrategy.extractSymbols(tree, source);
      const imports = resolvedStrategy.extractImports(tree, source);
      const parseTimeMs = performance.now() - startTime;

      const result: ParseResult = {
        filePath,
        language: resolvedStrategy.languageId,
        symbols,
        imports,
        parseTimeMs,
        errors,
      };

      this.cache.set(filePath, { result, sourceHash, cachedAt: Date.now() });
      return result;
    } catch (error) {
      return {
        filePath,
        language: resolvedStrategy.languageId,
        symbols: [],
        imports: [],
        parseTimeMs: performance.now() - startTime,
        errors: [`Parse error: ${(error as Error).message}`],
      };
    }
  }

  async parseFiles(filePaths: string[]): Promise<ParseResult[]> {
    return Promise.all(filePaths.map(fp => this.parseFile(fp)));
  }

  async getFunctions(filePath: string): Promise<CodeSymbol[]> {
    const result = await this.parseFile(filePath);
    return result.symbols.filter(s => s.type === 'function');
  }

  async getClasses(filePath: string): Promise<CodeSymbol[]> {
    const result = await this.parseFile(filePath);
    return result.symbols.filter(s => s.type === 'class');
  }

  async getCallSites(filePath: string): Promise<CodeSymbol[]> {
    const result = await this.parseFile(filePath);
    return result.symbols.filter(s => s.type === 'call');
  }

  async getImports(filePath: string): Promise<ImportStatement[]> {
    const result = await this.parseFile(filePath);
    return result.imports;
  }

  clearCache(): void {
    this.cache.clear();
  }

  invalidateCache(filePath: string): void {
    this.cache.delete(filePath);
  }

  getCacheStats(): { size: number; files: string[] } {
    return {
      size: this.cache.size,
      files: Array.from(this.cache.keys()),
    };
  }

  private hashSource(source: string): string {
    let hash = 0;
    for (let i = 0; i < source.length; i++) {
      const char = source.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }
}
