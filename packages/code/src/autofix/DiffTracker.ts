/**
 * DiffTracker - Captures file states and generates before/after diffs
 *
 * Used by auto_fix to show users exactly what changed.
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

export interface LineDiff {
  line: number;
  type: 'add' | 'remove' | 'change';
  before?: string;
  after?: string;
}

export interface FileDiff {
  file: string;
  changes: LineDiff[];
  additions: number;
  deletions: number;
}

interface FileSnapshot {
  content: string;
  lines: string[];
}

export class DiffTracker {
  private snapshots: Map<string, FileSnapshot> = new Map();

  async snapshot(paths: string[]): Promise<void> {
    const readPromises = paths.map(async (path) => {
      if (!existsSync(path)) return;

      try {
        const content = await readFile(path, 'utf-8');
        const lines = content.split('\n');
        if (lines[lines.length - 1] === '') {
          lines.pop();
        }
        this.snapshots.set(path, { content, lines });
      } catch {
        // Ignore read errors
      }
    });

    await Promise.all(readPromises);
  }

  hasSnapshot(path: string): boolean {
    return this.snapshots.has(path);
  }

  async diff(): Promise<FileDiff[]> {
    const diffs: FileDiff[] = [];

    for (const [path, snapshot] of this.snapshots.entries()) {
      if (!existsSync(path)) {
        diffs.push({
          file: path,
          changes: snapshot.lines.map((line, i) => ({
            line: i + 1,
            type: 'remove' as const,
            before: line,
          })),
          additions: 0,
          deletions: snapshot.lines.length,
        });
        continue;
      }

      try {
        const currentContent = await readFile(path, 'utf-8');
        if (currentContent === snapshot.content) continue;

        const currentLines = currentContent.split('\n');
        if (currentLines[currentLines.length - 1] === '') {
          currentLines.pop();
        }

        const changes = this.computeLineDiffs(snapshot.lines, currentLines);
        if (changes.length > 0) {
          diffs.push({
            file: path,
            changes,
            additions: changes.filter(c => c.type === 'add').length,
            deletions: changes.filter(c => c.type === 'remove').length,
          });
        }
      } catch {
        // Ignore read errors
      }
    }

    return diffs;
  }

  private computeLineDiffs(before: string[], after: string[]): LineDiff[] {
    const changes: LineDiff[] = [];
    const lcs = this.longestCommonSubsequence(before, after);

    let beforeIdx = 0;
    let afterIdx = 0;
    let lcsIdx = 0;

    while (beforeIdx < before.length || afterIdx < after.length) {
      if (lcsIdx < lcs.length &&
          beforeIdx < before.length &&
          before[beforeIdx] === lcs[lcsIdx]) {
        if (afterIdx < after.length && after[afterIdx] === lcs[lcsIdx]) {
          beforeIdx++;
          afterIdx++;
          lcsIdx++;
        } else {
          changes.push({ line: afterIdx + 1, type: 'add', after: after[afterIdx] });
          afterIdx++;
        }
      } else if (lcsIdx < lcs.length &&
                 afterIdx < after.length &&
                 after[afterIdx] === lcs[lcsIdx]) {
        changes.push({ line: beforeIdx + 1, type: 'remove', before: before[beforeIdx] });
        beforeIdx++;
      } else if (beforeIdx < before.length && afterIdx < after.length) {
        changes.push({
          line: beforeIdx + 1,
          type: 'change',
          before: before[beforeIdx],
          after: after[afterIdx],
        });
        beforeIdx++;
        afterIdx++;
      } else if (beforeIdx < before.length) {
        changes.push({ line: beforeIdx + 1, type: 'remove', before: before[beforeIdx] });
        beforeIdx++;
      } else if (afterIdx < after.length) {
        changes.push({ line: afterIdx + 1, type: 'add', after: after[afterIdx] });
        afterIdx++;
      }
    }

    return changes;
  }

  private longestCommonSubsequence(a: string[], b: string[]): string[] {
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0) as number[]);

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) {
          dp[i]![j] = dp[i - 1]![j - 1]! + 1;
        } else {
          dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
        }
      }
    }

    const lcs: string[] = [];
    let i = m, j = n;
    while (i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) {
        lcs.unshift(a[i - 1]!);
        i--;
        j--;
      } else if (dp[i - 1]![j]! > dp[i]![j - 1]!) {
        i--;
      } else {
        j--;
      }
    }

    return lcs;
  }

  getSummary(diffs: FileDiff[]): string {
    if (diffs.length === 0) return 'No changes detected';

    const totalChanges = diffs.reduce((sum, d) => sum + d.changes.length, 0);
    const totalAdditions = diffs.reduce((sum, d) => sum + d.additions, 0);
    const totalDeletions = diffs.reduce((sum, d) => sum + d.deletions, 0);

    const parts: string[] = [
      `${diffs.length} file${diffs.length !== 1 ? 's' : ''} changed`,
      `${totalChanges} change${totalChanges !== 1 ? 's' : ''}`,
    ];

    if (totalAdditions > 0) parts.push(`+${totalAdditions}`);
    if (totalDeletions > 0) parts.push(`-${totalDeletions}`);

    return parts.join(', ');
  }

  reset(): void {
    this.snapshots.clear();
  }
}
