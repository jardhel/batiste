/**
 * Configuration utilities for @batiste/code
 */

import { join } from 'path';

export interface Config {
  projectRoot: string;
  dataDir: string;
  ignorePatterns: string[];
}

export const LANGUAGE_EXTENSIONS: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
};

export function getLanguageFromExtension(ext: string): string | undefined {
  return LANGUAGE_EXTENSIONS[ext];
}

const DEFAULT_IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/.next/**',
  '**/coverage/**',
  '**/__pycache__/**',
  '**/target/**',
  '**/vendor/**',
];

export function loadConfig(overrides?: Partial<Config>): Config {
  const projectRoot = overrides?.projectRoot ?? process.cwd();
  const dataDir = overrides?.dataDir ?? join(projectRoot, '.batiste');

  return {
    projectRoot,
    dataDir,
    ignorePatterns: overrides?.ignorePatterns ?? DEFAULT_IGNORE_PATTERNS,
  };
}
