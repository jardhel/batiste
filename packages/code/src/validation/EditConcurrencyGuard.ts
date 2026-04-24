/**
 * EditConcurrencyGuard — GVS-style SHA gate for Edit operations.
 *
 * Wraps Claude Code's native Edit tool (and equivalents) with SHA-256 pre/post
 * comparison to detect concurrent file modifications between Read and Edit.
 *
 * Context (bug 2026-04-23-edit-tool-no-sha-compare.md): the native Edit tool
 * compares `old_string` byte-exact against file content, without re-hashing
 * between Read and Edit. When the user (or an LSP/linter/Obsidian plugin)
 * modifies the file concurrently — for example by injecting a non-breaking
 * space (U+00A0) before `**bold**` — the Edit fails silently with
 * "String to replace not found", not with "file changed since Read".
 *
 * This module provides:
 *   - `recordRead(path, content, agentId)` — snapshot SHA at Read time
 *   - `checkBeforeEdit(path)` — compare current disk SHA to snapshot
 *   - `updateAfterEdit(path, newContent)` — re-snapshot after a successful Edit
 *
 * Contracts:
 *   - Snapshots are per-agent, keyed by absolute path.
 *   - `checkBeforeEdit` returns `{ ok: false, reason: 'no snapshot' }` if no
 *     prior Read was recorded — caller should Read first.
 *   - When SHAs disagree, the guard returns the concurrency error and
 *     callers MUST NOT proceed with the byte-exact Edit (stale mental model
 *     of file contents).
 *
 * Usage sketch (middleware):
 *
 *     const guard = new EditConcurrencyGuard();
 *     // intercept Read:
 *     const content = await fs.readFile(path, 'utf8');
 *     guard.recordRead(path, content, agentId);
 *     // ...agent plans Edit...
 *     const check = guard.checkBeforeEdit(path);
 *     if (!check.ok) {
 *       emitAuditEvent('edit.concurrent_modification_detected', check);
 *       throw new ConcurrentEditError(check.reason!);
 *     }
 *     // apply edit, re-snapshot
 *     await fs.writeFile(path, newContent, 'utf8');
 *     guard.updateAfterEdit(path, newContent);
 *
 * Integration point: `@batiste-aidk/audit` emits `edit.concurrent_modification_detected`
 * events into the event log so session replays can see churn hotspots.
 */

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ReadRecord {
  path: string;
  shaAtRead: string;
  bytesAtRead: number;
  ts: string;
  agentId: string;
}

export interface ConcurrencyCheckResult {
  ok: boolean;
  expectedSha?: string;
  actualSha?: string;
  reason?: string;
}

function sha256(content: string | Buffer): string {
  const hash = createHash('sha256');
  hash.update(content);
  return hash.digest('hex');
}

export class EditConcurrencyGuard {
  private readonly snapshots = new Map<string, ReadRecord>();

  /**
   * Called when an agent reads a file. Records the SHA-256 of the content at
   * Read time, keyed by absolute path.
   */
  recordRead(path: string, content: string | Buffer, agentId: string): ReadRecord {
    const absPath = resolve(path);
    const contentBuf = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    const record: ReadRecord = {
      path: absPath,
      shaAtRead: sha256(contentBuf),
      bytesAtRead: contentBuf.length,
      ts: new Date().toISOString(),
      agentId,
    };
    this.snapshots.set(absPath, record);
    return record;
  }

  /**
   * Called before an Edit. Re-hashes the file from disk and compares against
   * the recorded snapshot. Does NOT apply any edit.
   */
  checkBeforeEdit(path: string): ConcurrencyCheckResult {
    const absPath = resolve(path);
    const snapshot = this.snapshots.get(absPath);
    if (!snapshot) {
      return {
        ok: false,
        reason:
          'no snapshot for this path; agent must Read the file before Edit so ' +
          'the concurrency guard can establish a baseline SHA.',
      };
    }
    let currentBuf: Buffer;
    try {
      currentBuf = readFileSync(absPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        reason: `cannot re-read file at edit time: ${msg}`,
      };
    }
    const currentSha = sha256(currentBuf);
    if (currentSha !== snapshot.shaAtRead) {
      return {
        ok: false,
        expectedSha: snapshot.shaAtRead,
        actualSha: currentSha,
        reason:
          `file changed between Read (${snapshot.ts}) and Edit. ` +
          `Expected SHA ${snapshot.shaAtRead.slice(0, 12)} but disk has ${currentSha.slice(0, 12)}. ` +
          'Re-read the file and re-plan the edit against current content.',
      };
    }
    return { ok: true, expectedSha: snapshot.shaAtRead, actualSha: currentSha };
  }

  /**
   * Called after a successful Edit. Updates the snapshot to the post-edit
   * content so subsequent Edits in the same agent session have a correct
   * baseline.
   */
  updateAfterEdit(path: string, newContent: string | Buffer, agentId?: string): ReadRecord {
    const absPath = resolve(path);
    const contentBuf = typeof newContent === 'string' ? Buffer.from(newContent, 'utf8') : newContent;
    const existing = this.snapshots.get(absPath);
    const record: ReadRecord = {
      path: absPath,
      shaAtRead: sha256(contentBuf),
      bytesAtRead: contentBuf.length,
      ts: new Date().toISOString(),
      agentId: agentId ?? existing?.agentId ?? 'unknown',
    };
    this.snapshots.set(absPath, record);
    return record;
  }

  /**
   * Drop the snapshot for a path. Useful when an agent explicitly closes a
   * file or the session ends.
   */
  forget(path: string): void {
    this.snapshots.delete(resolve(path));
  }

  /**
   * Drop all snapshots. Useful between sessions.
   */
  reset(): void {
    this.snapshots.clear();
  }

  /**
   * Introspection — number of paths currently tracked.
   */
  get trackedCount(): number {
    return this.snapshots.size;
  }

  /**
   * Introspection — snapshot for a given path, if present.
   */
  getSnapshot(path: string): ReadRecord | undefined {
    return this.snapshots.get(resolve(path));
  }

  /**
   * Diagnostic helper — returns `true` if the file on disk matches the
   * snapshot (i.e., safe to Edit). Convenience around `checkBeforeEdit`.
   */
  isSafeToEdit(path: string): boolean {
    return this.checkBeforeEdit(path).ok;
  }

  /**
   * Convenience — stat-based staleness heuristic (mtime changed after Read).
   * Cheaper than re-hashing on very large files, but not authoritative —
   * some editors rewrite files without changing mtime, or vice versa.
   * Use only as a quick filter before the authoritative SHA check.
   */
  isStaleByMtime(path: string): boolean {
    const absPath = resolve(path);
    const snapshot = this.snapshots.get(absPath);
    if (!snapshot) {
      return true;
    }
    try {
      const mtime = statSync(absPath).mtime.toISOString();
      return mtime > snapshot.ts;
    } catch {
      return true;
    }
  }
}

export class ConcurrentEditError extends Error {
  readonly expectedSha?: string;
  readonly actualSha?: string;

  constructor(result: ConcurrencyCheckResult) {
    super(result.reason ?? 'concurrent edit detected');
    this.name = 'ConcurrentEditError';
    this.expectedSha = result.expectedSha;
    this.actualSha = result.actualSha;
  }
}
