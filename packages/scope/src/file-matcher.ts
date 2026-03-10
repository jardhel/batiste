/**
 * File Matcher
 *
 * Glob-based file access control using micromatch.
 */

import micromatch from 'micromatch';
import type { AccessPolicy } from './types.js';

export class FileMatcher {
  private readonly allowedPatterns: string[];
  private readonly deniedPatterns: string[];

  constructor(policy: AccessPolicy) {
    this.allowedPatterns = policy.allowedPaths;
    this.deniedPatterns = policy.deniedPaths;
  }

  /** Check if a file path is accessible under this policy. */
  isAllowed(filePath: string): boolean {
    if (this.deniedPatterns.length > 0 && micromatch.isMatch(filePath, this.deniedPatterns)) {
      return false;
    }
    return micromatch.isMatch(filePath, this.allowedPatterns);
  }

  /** Filter a list of file paths, returning only allowed ones. */
  filter(filePaths: string[]): string[] {
    return filePaths.filter((p) => this.isAllowed(p));
  }

  /** Return paths that would be denied. */
  denied(filePaths: string[]): string[] {
    return filePaths.filter((p) => !this.isAllowed(p));
  }
}
