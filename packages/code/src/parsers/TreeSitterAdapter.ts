/**
 * TreeSitter Adapter
 *
 * Unified interface for parsing multiple languages using tree-sitter.
 * Registers language strategies and provides caching for parse results.
 */

import Parser from 'tree-sitter';
import { readFile } from 'fs/promises';
import { extname } from 'path';
import type {
  LanguageStrategy,
  CodeSymbol,
  ImportStatement,
} from '../config/LanguageStrategy.js';
import { TypeScriptStrategy } from '../config/TypeScriptStrategy.js';
import { PythonStrategy } from '../config/PythonStrategy.js';

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
  private strategies: Map<string, LanguageStrategy>;
  private extensionMap: Map<string, LanguageStrategy>;
  private cache: Map<string, CachedParse>;

  constructor() {
    this.parser = new Parser();
    this.strategies = new Map();
    this.extensionMap = new Map();
    this.cache = new Map();

    this.registerStrategy(new TypeScriptStrategy());
    this.registerStrategy(new PythonStrategy());
  }

  registerStrategy(strategy: LanguageStrategy): void {
    this.strategies.set(strategy.languageId, strategy);
    for (const ext of strategy.extensions) {
      this.extensionMap.set(ext, strategy);
    }
  }

  getStrategyForFile(filePath: string): LanguageStrategy | null {
    const ext = extname(filePath).toLowerCase();
    return this.extensionMap.get(ext) ?? null;
  }

  isSupported(filePath: string): boolean {
    return this.getStrategyForFile(filePath) !== null;
  }

  getSupportedExtensions(): string[] {
    return Array.from(this.extensionMap.keys());
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

  parseSource(source: string, filePath: string, strategy?: LanguageStrategy): ParseResult {
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
