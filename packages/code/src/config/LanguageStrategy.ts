/**
 * Language Strategy Interfaces
 *
 * Defines the contract for language-specific code parsing.
 * Each language (TypeScript, Python, etc.) implements these interfaces.
 */

export interface CodeSymbol {
  name: string;
  type: 'function' | 'method' | 'class' | 'call';
  startLine: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
  parameters?: string[];
  returnType?: string;
  className?: string;
  parentClass?: string;
  callee?: string;
  isExported?: boolean;
  isAsync?: boolean;
}

export interface ImportStatement {
  modulePath: string;
  importedSymbols: string[];
  isDefault: boolean;
  isNamespace: boolean;
  line: number;
}

export interface QueryPatterns {
  functionDefinitions: string;
  callSites: string;
  classDefinitions?: string;
  methodDefinitions?: string;
}

export interface LanguageStrategy {
  languageId: string;
  extensions: string[];
  getParser(): unknown;
  getQueryPatterns(): QueryPatterns;
  extractSymbols(tree: unknown, sourceCode: string): CodeSymbol[];
  extractImports(tree: unknown, sourceCode: string): ImportStatement[];
}
