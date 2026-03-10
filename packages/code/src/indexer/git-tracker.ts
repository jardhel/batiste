/**
 * Git integration for change detection.
 *
 * Provides git-aware file tracking, diff computation, and repository
 * status queries. Uses execSync wrapped in Promise.resolve() for an
 * async interface that is safe to call from async contexts.
 */

import { execSync } from 'child_process';
import { join } from 'path';
import { logger } from '../utils/logger.js';

export interface GitFileInfo {
  path: string;
  relativePath: string;
  lastCommit: Date;
  commitCount: number;
  authors: string[];
}

export interface GitDiffResult {
  /** Files added since base */
  added: string[];
  /** Files modified since base */
  modified: string[];
  /** Files deleted since base */
  deleted: string[];
  /** Files renamed (old path -> new path) */
  renamed: Map<string, string>;
  /** Base commit/ref used for comparison */
  baseRef: string;
  /** Head commit/ref used for comparison */
  headRef: string;
}

export interface GitStatus {
  isGitRepo: boolean;
  branch: string;
  uncommittedChanges: string[];
  recentlyModified: GitFileInfo[];
}

export class GitTracker {
  private projectRoot: string;
  private log = logger.child('git-tracker');
  private _isGitRepo: boolean = false;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  async initialize(): Promise<boolean> {
    try {
      await Promise.resolve(
        execSync('git rev-parse --is-inside-work-tree', {
          cwd: this.projectRoot,
          stdio: 'pipe',
        })
      );
      this._isGitRepo = true;
      this.log.info('Git repository detected');
      return true;
    } catch {
      this._isGitRepo = false;
      this.log.info('Not a git repository, git-aware features disabled');
      return false;
    }
  }

  /**
   * Get files modified since a given date.
   */
  async getModifiedSince(since: Date): Promise<string[]> {
    if (!this._isGitRepo) return [];

    try {
      const dateParts = since.toISOString().split('T');
      const sinceStr = dateParts[0] ?? since.toISOString();
      const output = await Promise.resolve(
        execSync(
          `git log --since="${sinceStr}" --name-only --pretty=format: | sort -u | grep -v '^$'`,
          { cwd: this.projectRoot, stdio: 'pipe', encoding: 'utf-8' }
        )
      );
      return output.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Get uncommitted changes (staged + unstaged).
   */
  async getUncommittedChanges(): Promise<string[]> {
    if (!this._isGitRepo) return [];

    try {
      const output = await Promise.resolve(
        execSync('git status --porcelain', {
          cwd: this.projectRoot,
          stdio: 'pipe',
          encoding: 'utf-8',
        })
      );

      return output
        .split('\n')
        .filter(line => line.length > 3)
        .map(line => line.substring(3).trim())
        .filter(f => f && !f.startsWith('?'));
    } catch {
      return [];
    }
  }

  /**
   * Get files ordered by recent activity (most recently changed first).
   */
  async getRecentlyModifiedFiles(limit = 50): Promise<GitFileInfo[]> {
    if (!this._isGitRepo) return [];

    try {
      const output = await Promise.resolve(
        execSync(
          `git log --all --name-only --pretty=format:"%H|%aI|%an" -n ${limit * 2}`,
          {
            cwd: this.projectRoot,
            stdio: 'pipe',
            encoding: 'utf-8',
          }
        )
      );

      const fileMap = new Map<string, GitFileInfo>();
      let currentCommit: { date: Date; author: string } | null = null;

      for (const line of output.split('\n')) {
        if (line.includes('|')) {
          const parts = line.split('|');
          const dateStr = parts[1] ?? '';
          const author = parts[2] ?? 'unknown';
          currentCommit = { date: new Date(dateStr), author };
        } else if (line.trim() && currentCommit) {
          const relativePath = line.trim();
          const fullPath = join(this.projectRoot, relativePath);

          const existing = fileMap.get(relativePath);
          if (!existing) {
            fileMap.set(relativePath, {
              path: fullPath,
              relativePath,
              lastCommit: currentCommit.date,
              commitCount: 1,
              authors: [currentCommit.author],
            });
          } else {
            existing.commitCount++;
            if (!existing.authors.includes(currentCommit.author)) {
              existing.authors.push(currentCommit.author);
            }
          }
        }
      }

      return Array.from(fileMap.values())
        .sort((a, b) => b.lastCommit.getTime() - a.lastCommit.getTime())
        .slice(0, limit);
    } catch (err) {
      this.log.warn('Failed to get recently modified files:', err);
      return [];
    }
  }

  /**
   * Get file hash from git (for change detection).
   */
  async getFileHash(relativePath: string): Promise<string | null> {
    if (!this._isGitRepo) return null;

    try {
      const output = await Promise.resolve(
        execSync(`git hash-object "${relativePath}"`, {
          cwd: this.projectRoot,
          stdio: 'pipe',
          encoding: 'utf-8',
        })
      );
      return output.trim();
    } catch {
      return null;
    }
  }

  /**
   * Check if a file has uncommitted changes.
   */
  async hasUncommittedChanges(relativePath: string): Promise<boolean> {
    if (!this._isGitRepo) return false;

    try {
      const output = await Promise.resolve(
        execSync(`git status --porcelain "${relativePath}"`, {
          cwd: this.projectRoot,
          stdio: 'pipe',
          encoding: 'utf-8',
        })
      );
      return output.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Get current branch name.
   */
  async getCurrentBranch(): Promise<string> {
    if (!this._isGitRepo) return 'unknown';

    try {
      const output = await Promise.resolve(
        execSync('git branch --show-current', {
          cwd: this.projectRoot,
          stdio: 'pipe',
          encoding: 'utf-8',
        })
      );
      return output.trim() || 'HEAD';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Get full git status for the repository.
   */
  async getStatus(): Promise<GitStatus> {
    return {
      isGitRepo: this._isGitRepo,
      branch: await this.getCurrentBranch(),
      uncommittedChanges: await this.getUncommittedChanges(),
      recentlyModified: await this.getRecentlyModifiedFiles(20),
    };
  }

  /**
   * Get the current HEAD commit hash.
   */
  async getHeadCommit(): Promise<string | null> {
    if (!this._isGitRepo) return null;

    try {
      const output = await Promise.resolve(
        execSync('git rev-parse HEAD', {
          cwd: this.projectRoot,
          stdio: 'pipe',
          encoding: 'utf-8',
        })
      );
      return output.trim();
    } catch {
      return null;
    }
  }

  /**
   * Get diff between two refs (commits, branches, tags).
   * If headRef is not provided, uses working directory (including uncommitted changes).
   */
  async getDiff(baseRef: string, headRef?: string): Promise<GitDiffResult> {
    const result: GitDiffResult = {
      added: [],
      modified: [],
      deleted: [],
      renamed: new Map(),
      baseRef,
      headRef: headRef ?? 'HEAD',
    };

    if (!this._isGitRepo) return result;

    try {
      const diffCmd = headRef
        ? `git diff --name-status -M ${baseRef} ${headRef}`
        : `git diff --name-status -M ${baseRef}`;

      const output = await Promise.resolve(
        execSync(diffCmd, {
          cwd: this.projectRoot,
          stdio: 'pipe',
          encoding: 'utf-8',
        })
      );

      for (const line of output.trim().split('\n')) {
        if (!line) continue;

        const parts = line.split('\t');
        const status = parts[0];
        const filePath = parts[1];

        if (!status || !filePath) continue;

        if (status === 'A') {
          result.added.push(filePath);
        } else if (status === 'M') {
          result.modified.push(filePath);
        } else if (status === 'D') {
          result.deleted.push(filePath);
        } else if (status.startsWith('R')) {
          const oldPath = parts[1];
          const newPath = parts[2];
          if (oldPath && newPath) {
            result.renamed.set(oldPath, newPath);
          }
        }
      }
    } catch (err) {
      this.log.warn('Failed to get git diff:', err);
    }

    return result;
  }

  /**
   * Get files changed in working directory (uncommitted changes)
   * compared to HEAD, including staged and unstaged changes.
   */
  async getWorkingTreeChanges(): Promise<GitDiffResult> {
    const result: GitDiffResult = {
      added: [],
      modified: [],
      deleted: [],
      renamed: new Map(),
      baseRef: 'HEAD',
      headRef: 'working-tree',
    };

    if (!this._isGitRepo) return result;

    try {
      const stagedOutput = await Promise.resolve(
        execSync('git diff --name-status --cached -M', {
          cwd: this.projectRoot,
          stdio: 'pipe',
          encoding: 'utf-8',
        })
      );

      const unstagedOutput = await Promise.resolve(
        execSync('git diff --name-status -M', {
          cwd: this.projectRoot,
          stdio: 'pipe',
          encoding: 'utf-8',
        })
      );

      const untrackedOutput = await Promise.resolve(
        execSync('git ls-files --others --exclude-standard', {
          cwd: this.projectRoot,
          stdio: 'pipe',
          encoding: 'utf-8',
        })
      );

      this.parseDiffOutput(stagedOutput, result);
      this.parseDiffOutput(unstagedOutput, result);

      for (const line of untrackedOutput.trim().split('\n')) {
        if (line && !result.added.includes(line)) {
          result.added.push(line);
        }
      }
    } catch (err) {
      this.log.warn('Failed to get working tree changes:', err);
    }

    return result;
  }

  /**
   * Parse git diff --name-status output and populate result.
   */
  private parseDiffOutput(output: string, result: GitDiffResult): void {
    for (const line of output.trim().split('\n')) {
      if (!line) continue;

      const parts = line.split('\t');
      const status = parts[0];
      const filePath = parts[1];

      if (!status || !filePath) continue;

      if (status === 'A' && !result.added.includes(filePath)) {
        result.added.push(filePath);
      } else if (status === 'M' && !result.modified.includes(filePath)) {
        result.modified.push(filePath);
      } else if (status === 'D' && !result.deleted.includes(filePath)) {
        result.deleted.push(filePath);
      } else if (status.startsWith('R')) {
        const oldPath = parts[1];
        const newPath = parts[2];
        if (oldPath && newPath && !result.renamed.has(oldPath)) {
          result.renamed.set(oldPath, newPath);
        }
      }
    }
  }

  /**
   * Check if the repository is clean (no uncommitted changes).
   */
  async isClean(): Promise<boolean> {
    if (!this._isGitRepo) return true;

    try {
      const output = await Promise.resolve(
        execSync('git status --porcelain', {
          cwd: this.projectRoot,
          stdio: 'pipe',
          encoding: 'utf-8',
        })
      );
      return output.trim().length === 0;
    } catch {
      return true;
    }
  }

  /**
   * Get commit hash for a given ref (branch, tag, etc.).
   */
  async resolveRef(ref: string): Promise<string | null> {
    if (!this._isGitRepo) return null;

    try {
      const output = await Promise.resolve(
        execSync(`git rev-parse ${ref}`, {
          cwd: this.projectRoot,
          stdio: 'pipe',
          encoding: 'utf-8',
        })
      );
      return output.trim();
    } catch {
      return null;
    }
  }

  /**
   * Check if git repo is available.
   */
  isGitRepository(): boolean {
    return this._isGitRepo;
  }
}
