/**
 * Scope Enforcement
 *
 * Checks whether a tool call is allowed by a scope definition.
 * Matches tool names and file paths against the scope.
 */

import type { ScopeDefinition } from './types.js';

export interface ScopeCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Check if a tool call is allowed by the scope.
 */
export function checkScope(
  scope: ScopeDefinition,
  toolName: string,
  args: Record<string, unknown> = {},
): ScopeCheckResult {
  // Check tool allowlist
  if (scope.tools && scope.tools.length > 0) {
    if (!scope.tools.includes(toolName)) {
      return { allowed: false, reason: `Tool '${toolName}' not in scope` };
    }
  }

  // Check file paths in arguments
  if (scope.files && scope.files.length > 0) {
    const filePaths = extractFilePaths(args);
    for (const filePath of filePaths) {
      if (!matchesAnyPattern(filePath, scope.files)) {
        return { allowed: false, reason: `File '${filePath}' not in scope` };
      }
    }
  }

  return { allowed: true };
}

/**
 * Check if a specific operation is allowed.
 */
export function checkOperation(
  scope: ScopeDefinition,
  operation: 'read' | 'write' | 'execute',
): ScopeCheckResult {
  const ops = scope.operations ?? ['read'];
  if (!ops.includes(operation)) {
    return { allowed: false, reason: `Operation '${operation}' not permitted` };
  }
  return { allowed: true };
}

/**
 * Check if a prompt is allowed by the scope.
 */
export function checkPromptScope(
  scope: ScopeDefinition,
  promptName: string,
): ScopeCheckResult {
  if (scope.prompts && scope.prompts.length > 0) {
    if (!scope.prompts.includes(promptName)) {
      return { allowed: false, reason: `Prompt '${promptName}' not in scope` };
    }
  }
  return { allowed: true };
}

/**
 * Extract file paths from tool arguments.
 * Looks for common argument patterns: paths, entryPoints, filePath, etc.
 */
function extractFilePaths(args: Record<string, unknown>): string[] {
  const paths: string[] = [];

  for (const [key, value] of Object.entries(args)) {
    if (['paths', 'entryPoints', 'files'].includes(key) && Array.isArray(value)) {
      for (const v of value) {
        if (typeof v === 'string') paths.push(v);
      }
    }
    if (['path', 'filePath', 'testFilePath', 'implementationFilePath', 'workingDir'].includes(key)) {
      if (typeof value === 'string') paths.push(value);
    }
  }

  return paths;
}

/**
 * Simple glob matching: supports * and ** patterns.
 */
function matchesAnyPattern(filePath: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (matchGlob(filePath, pattern)) return true;
  }
  return false;
}

function matchGlob(filePath: string, pattern: string): boolean {
  // Convert glob to regex
  const regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');

  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(filePath);
}
