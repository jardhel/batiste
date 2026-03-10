/**
 * FixGenerator - Generates fix suggestions from validation errors
 *
 * Uses pattern matching for common errors.
 */

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import type { ValidationError } from '../validation/types.js';

export interface FixSuggestion {
  file: string;
  line: number;
  action: 'replace' | 'remove' | 'insert';
  replacement?: string;
  insertAfter?: string;
  confidence: 'high' | 'medium' | 'low';
  description: string;
}

interface FixPattern {
  match: (error: ValidationError, lineContent: string) => boolean;
  generate: (error: ValidationError, lineContent: string, context: string[]) => FixSuggestion | null;
}

export class FixGenerator {
  private patterns: FixPattern[] = [];

  constructor() {
    this.registerBuiltinPatterns();
  }

  private registerBuiltinPatterns(): void {
    // Missing semicolon
    this.patterns.push({
      match: (error) =>
        error.rule === 'semi' ||
        error.message.toLowerCase().includes('missing semicolon'),
      generate: (error, lineContent) => ({
        file: error.file,
        line: error.line,
        action: 'replace',
        replacement: lineContent.trimEnd() + ';',
        confidence: 'high',
        description: 'Add missing semicolon',
      }),
    });

    // Prefer const over let
    this.patterns.push({
      match: (error) =>
        error.rule === 'prefer-const' ||
        error.message.includes("Use 'const' instead"),
      generate: (error, lineContent) => ({
        file: error.file,
        line: error.line,
        action: 'replace',
        replacement: lineContent.replace(/\blet\b/, 'const'),
        confidence: 'high',
        description: 'Use const instead of let',
      }),
    });

    // Unused variable
    this.patterns.push({
      match: (error) =>
        error.rule === '@typescript-eslint/no-unused-vars' ||
        error.rule === 'no-unused-vars' ||
        (error.message.includes('is declared but') && error.message.includes('never')),
      generate: (error, lineContent, _context) => {
        const trimmed = lineContent.trim();
        if (trimmed.startsWith('const ') || trimmed.startsWith('let ') || trimmed.startsWith('var ')) {
          if (!trimmed.includes('{') && !trimmed.includes('[')) {
            return {
              file: error.file,
              line: error.line,
              action: 'remove',
              confidence: 'high',
              description: 'Remove unused variable declaration',
            };
          }
        }
        return null;
      },
    });

    // Missing return type
    this.patterns.push({
      match: (error) =>
        error.rule === '@typescript-eslint/explicit-function-return-type' ||
        error.message.includes('Missing return type'),
      generate: (error, lineContent, context) => {
        const returnType = this.inferReturnType(context);
        if (!returnType) return null;

        const match = lineContent.match(/^(.*\([^)]*\))\s*(\{?)(.*)$/);
        if (match) {
          const [, beforeBrace, brace, after] = match;
          return {
            file: error.file,
            line: error.line,
            action: 'replace',
            replacement: `${beforeBrace}: ${returnType} ${brace}${after}`.trim(),
            confidence: 'medium',
            description: `Add return type annotation: ${returnType}`,
          };
        }
        return null;
      },
    });

    // Trailing comma
    this.patterns.push({
      match: (error) =>
        error.rule === 'comma-dangle' ||
        error.message.includes('trailing comma'),
      generate: (error, lineContent) => ({
        file: error.file,
        line: error.line,
        action: 'replace',
        replacement: lineContent.trimEnd().replace(/([^,])\s*$/, '$1,'),
        confidence: 'high',
        description: 'Add trailing comma',
      }),
    });

    // Quote style
    this.patterns.push({
      match: (error) =>
        error.rule === 'quotes' ||
        error.message.includes('must use singlequote') ||
        error.message.includes('must use doublequote'),
      generate: (error, lineContent) => {
        const useSingle = error.message.includes('singlequote');
        const [from, to] = useSingle ? ['"', "'"] : ["'", '"'];

        let inString = false;
        let stringChar = '';
        let result = '';

        for (let i = 0; i < lineContent.length; i++) {
          const char = lineContent[i]!;
          const prevChar = lineContent[i - 1];

          if (!inString && (char === '"' || char === "'")) {
            inString = true;
            stringChar = char;
            result += char === from ? to : char;
          } else if (inString && char === stringChar && prevChar !== '\\') {
            inString = false;
            result += char === from ? to : char;
          } else {
            result += char;
          }
        }

        return {
          file: error.file,
          line: error.line,
          action: 'replace',
          replacement: result,
          confidence: 'medium',
          description: `Use ${useSingle ? 'single' : 'double'} quotes`,
        };
      },
    });
  }

  private inferReturnType(context: string[]): string | null {
    const fullContext = context.join('\n');
    const returnMatch = fullContext.match(/return\s+([^;]+)/);
    if (!returnMatch) return 'void';

    const returnExpr = returnMatch[1]!.trim();

    if (returnExpr.startsWith('`') || returnExpr.startsWith('"') || returnExpr.startsWith("'")) {
      return 'string';
    }
    if (/^\d+$/.test(returnExpr)) return 'number';
    if (returnExpr === 'true' || returnExpr === 'false') return 'boolean';
    if (returnExpr.startsWith('[')) return 'unknown[]';
    if (returnExpr.startsWith('{')) return 'object';

    return null;
  }

  async generateFixes(errors: ValidationError[]): Promise<FixSuggestion[]> {
    const suggestions: FixSuggestion[] = [];

    const errorsByFile = new Map<string, ValidationError[]>();
    for (const error of errors) {
      const existing = errorsByFile.get(error.file) ?? [];
      existing.push(error);
      errorsByFile.set(error.file, existing);
    }

    for (const [filePath, fileErrors] of errorsByFile) {
      if (!existsSync(filePath)) continue;

      try {
        const content = await readFile(filePath, 'utf-8');
        const lines = content.split('\n');

        for (const error of fileErrors) {
          const lineIndex = error.line - 1;
          if (lineIndex < 0 || lineIndex >= lines.length) continue;

          const lineContent = lines[lineIndex]!;
          const contextStart = Math.max(0, lineIndex - 5);
          const contextEnd = Math.min(lines.length, lineIndex + 6);
          const context = lines.slice(contextStart, contextEnd);

          for (const pattern of this.patterns) {
            if (pattern.match(error, lineContent)) {
              const fix = pattern.generate(error, lineContent, context);
              if (fix) {
                suggestions.push(fix);
                break;
              }
            }
          }
        }
      } catch {
        // Skip files we can't read
      }
    }

    return suggestions;
  }

  async applyFixes(fixes: FixSuggestion[]): Promise<{ applied: number; failed: number }> {
    const fixesByFile = new Map<string, FixSuggestion[]>();
    for (const fix of fixes) {
      const existing = fixesByFile.get(fix.file) ?? [];
      existing.push(fix);
      fixesByFile.set(fix.file, existing);
    }

    let applied = 0;
    let failed = 0;

    for (const [filePath, fileFixes] of fixesByFile) {
      try {
        const content = await readFile(filePath, 'utf-8');
        const lines = content.split('\n');

        fileFixes.sort((a, b) => b.line - a.line);

        for (const fix of fileFixes) {
          const lineIndex = fix.line - 1;
          if (lineIndex < 0 || lineIndex >= lines.length) {
            failed++;
            continue;
          }

          switch (fix.action) {
            case 'replace':
              if (fix.replacement !== undefined) {
                lines[lineIndex] = fix.replacement;
                applied++;
              }
              break;
            case 'remove':
              lines.splice(lineIndex, 1);
              applied++;
              break;
            case 'insert':
              if (fix.insertAfter !== undefined) {
                lines.splice(lineIndex + 1, 0, fix.insertAfter);
                applied++;
              }
              break;
          }
        }

        await writeFile(filePath, lines.join('\n'));
      } catch {
        failed += fileFixes.length;
      }
    }

    return { applied, failed };
  }

  registerPattern(pattern: FixPattern): void {
    this.patterns.push(pattern);
  }
}
