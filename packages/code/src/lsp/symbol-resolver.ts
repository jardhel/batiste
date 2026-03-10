/**
 * SymbolResolver - Hybrid symbol resolution using LSP with TreeSitter fallback
 *
 * Uses the Language Server Protocol for accurate symbol resolution when available,
 * and falls back to TreeSitter-based AST analysis via RecursiveScout when LSP
 * is unavailable or returns no results.
 */

import { LSPClient } from './client.js';
import { RecursiveScout } from '../analysis/RecursiveScout.js';
import { TreeSitterAdapter } from '../parsers/TreeSitterAdapter.js';
import { logger } from '../utils/logger.js';
import type { CodeSymbol } from '../config/LanguageStrategy.js';

export interface SymbolLocation {
  file: string;
  line: number;
  type: string;
  name: string;
  source: 'lsp' | 'tree-sitter';
}

export interface SymbolSearchResult {
  symbolName: string;
  definitions: SymbolLocation[];
  references: SymbolLocation[];
  definitionCount: number;
  referenceCount: number;
  source: 'lsp' | 'tree-sitter' | 'hybrid';
}

export class SymbolResolver {
  private projectRoot: string;
  private lspClient: LSPClient | null = null;
  private scout: RecursiveScout;
  private log = logger.child('symbol-resolver');
  private _initialized = false;
  private _lspAvailable = false;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    const adapter = new TreeSitterAdapter();
    this.scout = new RecursiveScout(adapter);
  }

  /**
   * Initialize the resolver. Attempts to start the LSP client.
   * If LSP startup fails, the resolver continues with TreeSitter only.
   */
  async initialize(): Promise<void> {
    if (this._initialized) {
      return;
    }

    try {
      this.lspClient = new LSPClient();
      await this.lspClient.initialize(this.projectRoot);
      this._lspAvailable = true;
      this.log.info('LSP client initialized - using LSP for symbol resolution');
    } catch (err) {
      this.log.warn('Failed to initialize LSP client, falling back to TreeSitter:', err);
      this.lspClient = null;
      this._lspAvailable = false;
    }

    this._initialized = true;
  }

  /**
   * Check whether the LSP client is available and connected.
   */
  isLSPAvailable(): boolean {
    return this._lspAvailable && (this.lspClient?.isInitialized() === true);
  }

  /**
   * Find all definitions and references for the given symbol name.
   *
   * Strategy:
   * 1. If LSP is available, attempt LSP-based resolution first.
   * 2. If LSP returns results, return them.
   * 3. Otherwise, fall back to TreeSitter-based resolution via RecursiveScout.
   */
  async findSymbol(
    symbolName: string,
    entryPoints: string[]
  ): Promise<SymbolSearchResult> {
    if (!this._initialized) {
      await this.initialize();
    }

    // Try LSP first
    if (this.isLSPAvailable()) {
      try {
        const lspResult = await this.findSymbolWithLSP(symbolName, entryPoints);
        if (lspResult.definitionCount > 0 || lspResult.referenceCount > 0) {
          return lspResult;
        }
        this.log.debug(
          `LSP returned no results for '${symbolName}', falling back to TreeSitter`
        );
      } catch (err) {
        this.log.warn('LSP symbol search failed, falling back to TreeSitter:', err);
      }
    }

    // Fall back to TreeSitter
    return this.findSymbolWithTreeSitter(symbolName, entryPoints);
  }

  /**
   * Shut down the resolver, releasing resources.
   */
  async stop(): Promise<void> {
    if (this.lspClient) {
      await this.lspClient.shutdown();
      this.lspClient = null;
    }
    this._lspAvailable = false;
    this._initialized = false;
    this.log.info('SymbolResolver stopped');
  }

  // -- Private: LSP-based resolution --

  private async findSymbolWithLSP(
    symbolName: string,
    entryPoints: string[]
  ): Promise<SymbolSearchResult> {
    const definitions: SymbolLocation[] = [];
    const references: SymbolLocation[] = [];

    if (!this.lspClient) {
      return {
        symbolName,
        definitions,
        references,
        definitionCount: 0,
        referenceCount: 0,
        source: 'lsp',
      };
    }

    for (const entryPoint of entryPoints) {
      const { lineIndex, column } = await this.findSymbolPosition(
        entryPoint,
        symbolName
      );

      if (lineIndex < 0) {
        continue;
      }

      // Find definitions
      const defs = await this.lspClient.findDefinition(entryPoint, lineIndex, column);
      for (const def of defs) {
        if (!definitions.some((d) => d.file === def.file && d.line === def.line)) {
          definitions.push({
            file: def.file,
            line: def.line + 1, // Convert 0-indexed to 1-indexed
            type: 'unknown',
            name: symbolName,
            source: 'lsp',
          });
        }
      }

      // Find references
      const refs = await this.lspClient.findReferences(entryPoint, lineIndex, column);
      for (const ref of refs) {
        if (!references.some((r) => r.file === ref.file && r.line === ref.line)) {
          references.push({
            file: ref.file,
            line: ref.line + 1, // Convert 0-indexed to 1-indexed
            type: 'reference',
            name: symbolName,
            source: 'lsp',
          });
        }
      }
    }

    return {
      symbolName,
      definitions,
      references,
      definitionCount: definitions.length,
      referenceCount: references.length,
      source: 'lsp',
    };
  }

  /**
   * Scan a file for the first occurrence of the symbol name and return
   * its 0-indexed line and column position.
   */
  private async findSymbolPosition(
    filePath: string,
    symbolName: string
  ): Promise<{ lineIndex: number; column: number }> {
    try {
      const { readFile } = await import('fs/promises');
      const content = await readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) {
          continue;
        }
        const col = line.indexOf(symbolName);
        if (col !== -1) {
          return { lineIndex: i, column: col };
        }
      }
    } catch {
      // File not readable
    }

    return { lineIndex: -1, column: -1 };
  }

  // -- Private: TreeSitter-based resolution --

  private async findSymbolWithTreeSitter(
    symbolName: string,
    entryPoints: string[]
  ): Promise<SymbolSearchResult> {
    const graph = await this.scout.buildDependencyGraph(entryPoints);
    const defs = await this.scout.findSymbolDefinitions(symbolName, graph);
    const callSites = await this.scout.findCallSites(symbolName, graph);

    const definitions: SymbolLocation[] = defs.map(
      (d: { filePath: string; symbol: CodeSymbol }) => ({
        file: d.filePath,
        line: d.symbol.startLine,
        type: d.symbol.type,
        name: d.symbol.name,
        source: 'tree-sitter' as const,
      })
    );

    const references: SymbolLocation[] = callSites.map(
      (c: { filePath: string; symbol: CodeSymbol }) => ({
        file: c.filePath,
        line: c.symbol.startLine,
        type: 'call',
        name: symbolName,
        source: 'tree-sitter' as const,
      })
    );

    return {
      symbolName,
      definitions,
      references,
      definitionCount: definitions.length,
      referenceCount: references.length,
      source: 'tree-sitter',
    };
  }
}
