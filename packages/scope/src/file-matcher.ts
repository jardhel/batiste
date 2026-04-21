/**
 * File Matcher
 *
 * Glob-based file access control using micromatch.
 *
 * The matcher evaluates a file path against two independent lists:
 *
 *   1. deny  — operator-supplied deniedPaths ∪ SECRET_PATH_PATTERNS
 *              (see secret-paths.ts). Deny always wins.
 *   2. allow — operator-supplied allowedPaths. Empty allow list means
 *              nothing is allowed (deny-by-default).
 *
 * The default secret list cannot be disabled. Operators who need to
 * read from a path that overlaps the secret list MUST add an explicit
 * path to `allowedPaths`; a glob-widening in `deniedPaths` is not
 * sufficient and will still be overridden by the secret list.
 *
 * Compliance:
 *   - GDPR Art. 32(1)(b), ISO 27001 A.5.15–A.5.18 (access control)
 *   - SOC 2 CC6.1, CC6.3 (logical and physical access)
 *   - NIS2 Art. 21(2)(d) (secret management)
 *
 * Performance note:
 *   micromatch compiles a regex per pattern on first use. For the
 *   ~60-pattern default list plus operator patterns this is O(n) in
 *   pattern count at steady state, well under 1 ms for typical
 *   workloads. No input is ever passed unescaped into a hand-built
 *   regex, which protects against catastrophic-backtracking DoS
 *   vectors (E3-B03 companion).
 */

import micromatch from 'micromatch';
import type { AccessPolicy } from './types.js';
import { SCOPE_LIMITS } from './types.js';
import { mergeDeniedPaths } from './secret-paths.js';

export class FileMatcher {
  private readonly allowedPatterns: string[];
  private readonly deniedPatterns: string[];

  constructor(policy: AccessPolicy) {
    this.allowedPatterns = policy.allowedPaths;
    // Always merge operator-supplied denied patterns with the baked-in
    // secret-path list. Operators can add, but never remove, the defaults.
    this.deniedPatterns = mergeDeniedPaths(policy.deniedPaths);
  }

  /** Check if a file path is accessible under this policy. */
  isAllowed(filePath: string): boolean {
    // Fail-closed: any invalid shape is treated as denied. This prevents
    // adversarial paths (oversized, NUL-injected, non-strings) from
    // reaching micromatch where they could trigger regex-engine edge
    // cases. We deny silently so callers cannot probe the cap via the
    // difference between `false` and a thrown exception.
    if (typeof filePath !== 'string') return false;
    if (filePath.length === 0 || filePath.length > SCOPE_LIMITS.MAX_PATH_LENGTH) return false;
    if (filePath.includes('\0')) return false;
    // Normalise: strip leading "./" so "./.env" and ".env" match the same way.
    const normalised = filePath.startsWith('./') ? filePath.slice(2) : filePath;

    if (micromatch.isMatch(normalised, this.deniedPatterns, { dot: true })) {
      return false;
    }
    if (this.allowedPatterns.length === 0) {
      return false; // deny-by-default
    }
    return micromatch.isMatch(normalised, this.allowedPatterns, { dot: true });
  }

  /** Filter a list of file paths, returning only allowed ones. */
  filter(filePaths: string[]): string[] {
    return filePaths.filter((p) => this.isAllowed(p));
  }

  /** Return paths that would be denied. */
  denied(filePaths: string[]): string[] {
    return filePaths.filter((p) => !this.isAllowed(p));
  }

  /** Inspect the effective pattern lists (for audit/debug). */
  patterns(): { allowed: readonly string[]; denied: readonly string[] } {
    return { allowed: [...this.allowedPatterns], denied: [...this.deniedPatterns] };
  }
}
