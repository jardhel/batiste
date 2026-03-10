/**
 * RecursiveScout - Walks import graphs using Tree-Sitter AST navigation
 *
 * Builds dependency graphs from entry points, resolves imports,
 * and detects circular dependencies.
 */

import { resolve, dirname } from 'path';
import { existsSync, statSync } from 'fs';
import { TreeSitterAdapter, ParseResult } from '../parsers/TreeSitterAdapter.js';
import type { CodeSymbol, ImportStatement } from '../config/LanguageStrategy.js';

export interface DependencyNode {
  filePath: string;
  imports: ImportStatement[];
  symbols: CodeSymbol[];
  dependencies: string[];
  dependents: string[];
}

export interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  roots: string[];
  leaves: string[];
  circularDeps: string[][];
}

export interface ScoutOptions {
  maxDepth?: number;
  includeNodeModules?: boolean;
  extensions?: string[];
  excludeDirs?: string[];
}

const DEFAULT_OPTIONS: Required<ScoutOptions> = {
  maxDepth: 50,
  includeNodeModules: false,
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.py'],
  excludeDirs: ['node_modules', '.git', 'dist', 'build', '__pycache__'],
};

export class RecursiveScout {
  private adapter: TreeSitterAdapter;
  private options: Required<ScoutOptions>;
  private parseCache: Map<string, ParseResult>;

  constructor(adapter?: TreeSitterAdapter, options?: ScoutOptions) {
    this.adapter = adapter ?? new TreeSitterAdapter();
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.parseCache = new Map();
  }

  async buildDependencyGraph(entryPoints: string[]): Promise<DependencyGraph> {
    const nodes = new Map<string, DependencyNode>();
    const visited = new Set<string>();
    const circularDeps: string[][] = [];

    for (const entry of entryPoints) {
      const resolvedEntry = resolve(entry);
      if (!existsSync(resolvedEntry)) {
        continue;
      }
      await this.walkDependencies(resolvedEntry, nodes, visited, [], circularDeps);
    }

    // Build reverse dependencies
    for (const [filePath, node] of nodes) {
      for (const dep of node.dependencies) {
        const depNode = nodes.get(dep);
        if (depNode && !depNode.dependents.includes(filePath)) {
          depNode.dependents.push(filePath);
        }
      }
    }

    const roots: string[] = [];
    const leaves: string[] = [];

    for (const [filePath, node] of nodes) {
      if (node.dependents.length === 0) {
        roots.push(filePath);
      }
      if (node.dependencies.length === 0) {
        leaves.push(filePath);
      }
    }

    return { nodes, roots, leaves, circularDeps };
  }

  private async walkDependencies(
    filePath: string,
    nodes: Map<string, DependencyNode>,
    visited: Set<string>,
    currentPath: string[],
    circularDeps: string[][],
    depth: number = 0
  ): Promise<void> {
    if (depth > this.options.maxDepth) return;

    const cycleIndex = currentPath.indexOf(filePath);
    if (cycleIndex !== -1) {
      const cycle = [...currentPath.slice(cycleIndex), filePath];
      circularDeps.push(cycle);
      return;
    }

    if (visited.has(filePath)) return;
    visited.add(filePath);

    if (!this.adapter.isSupported(filePath)) return;

    const parseResult = await this.parseFile(filePath);
    const dependencies: string[] = [];

    for (const imp of parseResult.imports) {
      const resolved = this.resolveImport(imp.modulePath, filePath);
      if (resolved && !dependencies.includes(resolved)) {
        dependencies.push(resolved);
      }
    }

    const node: DependencyNode = {
      filePath,
      imports: parseResult.imports,
      symbols: parseResult.symbols,
      dependencies,
      dependents: [],
    };
    nodes.set(filePath, node);

    const newPath = [...currentPath, filePath];
    for (const dep of dependencies) {
      await this.walkDependencies(dep, nodes, visited, newPath, circularDeps, depth + 1);
    }
  }

  private async parseFile(filePath: string): Promise<ParseResult> {
    if (this.parseCache.has(filePath)) {
      return this.parseCache.get(filePath)!;
    }

    const result = await this.adapter.parseFile(filePath);
    this.parseCache.set(filePath, result);
    return result;
  }

  resolveImport(importPath: string, fromFile: string): string | null {
    if (
      !this.options.includeNodeModules &&
      !importPath.startsWith('.') &&
      !importPath.startsWith('/')
    ) {
      return null;
    }

    const fromDir = dirname(fromFile);

    if (importPath.startsWith('.')) {
      return this.resolveRelativeImport(importPath, fromDir);
    }

    if (importPath.startsWith('/')) {
      return this.resolveWithExtensions(importPath);
    }

    return null;
  }

  private resolveRelativeImport(importPath: string, fromDir: string): string | null {
    const basePath = resolve(fromDir, importPath);
    return this.resolveWithExtensions(basePath);
  }

  private resolveWithExtensions(basePath: string): string | null {
    if (existsSync(basePath) && statSync(basePath).isFile()) {
      return basePath;
    }

    let basePathWithoutExt = basePath;
    for (const ext of this.options.extensions) {
      if (basePath.endsWith(ext)) {
        basePathWithoutExt = basePath.slice(0, -ext.length);
        break;
      }
    }

    for (const ext of this.options.extensions) {
      const withExt = basePathWithoutExt + ext;
      if (existsSync(withExt) && statSync(withExt).isFile()) {
        return withExt;
      }
    }

    for (const ext of this.options.extensions) {
      const indexPath = resolve(basePathWithoutExt, 'index' + ext);
      if (existsSync(indexPath) && statSync(indexPath).isFile()) {
        return indexPath;
      }
    }

    return null;
  }

  async findSymbolDefinitions(
    symbolName: string,
    graph: DependencyGraph
  ): Promise<{ filePath: string; symbol: CodeSymbol }[]> {
    const results: { filePath: string; symbol: CodeSymbol }[] = [];

    for (const [filePath, node] of graph.nodes) {
      for (const symbol of node.symbols) {
        if (symbol.name === symbolName && symbol.type !== 'call') {
          results.push({ filePath, symbol });
        }
      }
    }

    return results;
  }

  async findCallSites(
    symbolName: string,
    graph: DependencyGraph
  ): Promise<{ filePath: string; symbol: CodeSymbol }[]> {
    const results: { filePath: string; symbol: CodeSymbol }[] = [];

    for (const [filePath, node] of graph.nodes) {
      for (const symbol of node.symbols) {
        if (symbol.type === 'call' && symbol.callee === symbolName) {
          results.push({ filePath, symbol });
        }
      }
    }

    return results;
  }

  findImportPath(fromFile: string, toFile: string, graph: DependencyGraph): string[] | null {
    const visited = new Set<string>();
    const queue: { file: string; path: string[] }[] = [{ file: fromFile, path: [fromFile] }];

    while (queue.length > 0) {
      const { file, path } = queue.shift()!;

      if (file === toFile) return path;
      if (visited.has(file)) continue;
      visited.add(file);

      const node = graph.nodes.get(file);
      if (node) {
        for (const dep of node.dependencies) {
          if (!visited.has(dep)) {
            queue.push({ file: dep, path: [...path, dep] });
          }
        }
      }
    }

    return null;
  }

  getGraphStats(graph: DependencyGraph): {
    totalFiles: number;
    totalImports: number;
    totalSymbols: number;
    avgDependencies: number;
    maxDependencies: { file: string; count: number };
    circularCount: number;
  } {
    let totalImports = 0;
    let totalSymbols = 0;
    let maxDeps = { file: '', count: 0 };

    for (const [filePath, node] of graph.nodes) {
      totalImports += node.imports.length;
      totalSymbols += node.symbols.length;
      if (node.dependencies.length > maxDeps.count) {
        maxDeps = { file: filePath, count: node.dependencies.length };
      }
    }

    const totalFiles = graph.nodes.size;
    const avgDependencies =
      totalFiles > 0
        ? Array.from(graph.nodes.values()).reduce((sum, n) => sum + n.dependencies.length, 0) /
          totalFiles
        : 0;

    return {
      totalFiles,
      totalImports,
      totalSymbols,
      avgDependencies: Math.round(avgDependencies * 100) / 100,
      maxDependencies: maxDeps,
      circularCount: graph.circularDeps.length,
    };
  }

  clearCache(): void {
    this.parseCache.clear();
  }
}
