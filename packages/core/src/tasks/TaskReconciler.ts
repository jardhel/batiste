/**
 * TaskReconciler — closes the gap between the task DAG and reality.
 *
 * The board rots when work gets done but nobody flips the task to
 * `completed`. This reconciler reads git history for `Task-done:` commit
 * trailers (a git trailer, exactly like `Co-Authored-By:`), matches each
 * one against an open task by id OR exact label, and closes the match —
 * with the commit SHA recorded as evidence.
 *
 * Two doctrines are load-bearing here:
 *
 *   1. Close ONLY with evidence. A task is flipped to `completed` solely
 *      because a real commit claimed it. No commit, no closure.
 *   2. Stale only SIGNALS. Pending tasks untouched past the threshold are
 *      flagged (`staleSince`), never auto-closed. An honest board shows
 *      stale-open work; it does not fabricate completion.
 *
 * Idempotent: the newest reconciled SHA is persisted, so re-running only
 * inspects new commits and never re-closes an already-closed task.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { TaskManager } from './TaskManager.js';
import type {
  IReconcileMarkerStore,
  ReconcileAuditSink,
  ReconcileResult,
  ReconciledClosure,
  StaleCheckResult,
  StaleFlag,
  Task,
} from './types.js';

const execFileAsync = promisify(execFile);

/** The git trailer key this reconciler honours. Case-insensitive on read. */
export const TASK_DONE_TRAILER = 'Task-done';

const SECONDS_PER_DAY = 86_400;
const DEFAULT_STALE_DAYS = 14;
/** When no marker exists, how many recent commits to inspect on first run. */
const DEFAULT_INITIAL_COMMITS = 200;

export interface ReconcileOptions {
  /**
   * Explicit lower bound. A git revision (SHA/ref); only commits AFTER it
   * are inspected (`<since>..HEAD`). When omitted, the persisted marker is
   * used; with neither, the last {@link DEFAULT_INITIAL_COMMITS} are read.
   */
  since?: string;
  /** Stale threshold in days for the stale flags bundled into the result. */
  staleDays?: number;
  /** "now" override (epoch seconds) for deterministic tests. */
  now?: number;
}

export interface StaleCheckOptions {
  /** Stale threshold in days (default 14). */
  staleDays?: number;
  /** "now" override (epoch seconds) for deterministic tests. */
  now?: number;
}

/** One commit's SHA plus the `Task-done:` values it carried. */
interface ParsedCommit {
  sha: string;
  doneTrailers: string[];
}

export class TaskReconciler {
  constructor(
    private readonly manager: TaskManager,
    private readonly repoPath: string,
    private readonly markerStore: IReconcileMarkerStore,
    private readonly auditSink?: ReconcileAuditSink
  ) {}

  /**
   * Reconcile the board against git history.
   *
   * Reads commits (since the explicit `since`, else the persisted marker,
   * else the recent window), extracts `Task-done:` trailers, closes the
   * matched open tasks, records audit evidence, advances the marker, and
   * bundles a stale-check pass. Closing an already-`completed` task is a
   * silent no-op, so re-runs are safe.
   */
  async reconcileFromGit(opts: ReconcileOptions = {}): Promise<ReconcileResult> {
    const now = opts.now ?? Math.floor(Date.now() / 1000);
    const staleDays = opts.staleDays ?? DEFAULT_STALE_DAYS;

    const since = opts.since ?? this.markerStore.getLastSha() ?? undefined;
    const commits = await this.readCommits(since);

    const result: ReconcileResult = {
      closed: [],
      unmatched: [],
      stale: [],
      lastSha: this.markerStore.getLastSha(),
      commitsScanned: commits.length,
    };

    // Index open tasks once: by id and by exact label. We only ever close
    // tasks that are still open (not already completed) — that is what
    // makes re-running idempotent.
    const allTasks = await this.manager.recoverState();
    const byId = new Map<string, Task>();
    const byLabel = new Map<string, Task[]>();
    for (const task of allTasks) {
      byId.set(task.id, task);
      const bucket = byLabel.get(task.label) ?? [];
      bucket.push(task);
      byLabel.set(task.label, bucket);
    }

    const closedIds = new Set<string>();

    // git log is newest-first; reverse so the marker we persist is the
    // newest commit AND so older closures register before newer ones.
    for (const commit of [...commits].reverse()) {
      for (const value of commit.doneTrailers) {
        const match = this.resolveMatch(value, byId, byLabel);
        if (!match) {
          result.unmatched.push({ matchedBy: value, sha: commit.sha });
          continue;
        }
        if (match.status === 'completed' || closedIds.has(match.id)) {
          // Already done (idempotent re-run, or two trailers naming the
          // same task). Not an error, not a fresh closure.
          continue;
        }

        await this.manager.updateStatus(match.id, 'completed', {
          reconciledFromCommit: commit.sha,
          reconciledAt: now,
          reconciledBy: value,
        });
        closedIds.add(match.id);
        match.status = 'completed';

        const closure: ReconciledClosure = {
          taskId: match.id,
          label: match.label,
          matchedBy: value,
          sha: commit.sha,
        };
        result.closed.push(closure);

        if (this.auditSink) {
          await this.auditSink.recordClosure({
            taskId: match.id,
            label: match.label,
            commitSha: commit.sha,
            matchedBy: value,
          });
        }
      }
    }

    // Advance the high-water mark to the newest commit seen, so the next
    // run skips everything reconciled here.
    const newest = commits[0];
    if (newest) {
      this.markerStore.setLastSha(newest.sha);
      result.lastSha = newest.sha;
    }

    result.stale = this.computeStale(allTasks, staleDays, now);
    return result;
  }

  /**
   * Flag pending tasks untouched for longer than the threshold. Pure
   * signal — this method never mutates a task.
   */
  async staleCheck(opts: StaleCheckOptions = {}): Promise<StaleCheckResult> {
    const now = opts.now ?? Math.floor(Date.now() / 1000);
    const staleDays = opts.staleDays ?? DEFAULT_STALE_DAYS;
    const allTasks = await this.manager.recoverState();
    return {
      stale: this.computeStale(allTasks, staleDays, now),
      thresholdDays: staleDays,
    };
  }

  // ==================== internals ====================

  private computeStale(tasks: Task[], staleDays: number, now: number): StaleFlag[] {
    const cutoff = now - staleDays * SECONDS_PER_DAY;
    const flags: StaleFlag[] = [];
    for (const task of tasks) {
      if (task.status !== 'pending') continue;
      // Unknown age (no updatedAt) is not treated as stale — we only flag
      // on positive evidence of staleness, mirroring the closure doctrine.
      if (task.updatedAt == null) continue;
      if (task.updatedAt <= cutoff) {
        flags.push({
          taskId: task.id,
          label: task.label,
          staleSince: task.updatedAt,
          ageDays: Math.floor((now - task.updatedAt) / SECONDS_PER_DAY),
        });
      }
    }
    return flags;
  }

  /** Resolve a `Task-done:` value to an open task, by id first then label. */
  private resolveMatch(
    value: string,
    byId: Map<string, Task>,
    byLabel: Map<string, Task[]>
  ): Task | null {
    const byIdHit = byId.get(value);
    if (byIdHit) return byIdHit;

    const labelHits = byLabel.get(value) ?? [];
    // Prefer the first still-open task with this label; if all are already
    // completed, return one so the run records it as a no-op (idempotent)
    // rather than a spurious "unmatched".
    return labelHits.find((t) => t.status !== 'completed') ?? labelHits[0] ?? null;
  }

  /**
   * Read commits and their `Task-done:` trailers from git.
   *
   * Format: `%H` (full sha) then a NUL, then `%B` (raw body) then a NUL,
   * with `-z` so records are NUL-terminated. The NUL separators make the
   * parse robust against any whitespace/newlines inside commit messages.
   */
  private async readCommits(since?: string): Promise<ParsedCommit[]> {
    const args = ['-C', this.repoPath, 'log', '-z', '--format=%H%x00%B'];
    if (since) {
      args.push(`${since}..HEAD`);
    } else {
      args.push(`-n`, String(DEFAULT_INITIAL_COMMITS));
    }

    let stdout: string;
    try {
      ({ stdout } = await execFileAsync('git', args, {
        cwd: this.repoPath,
        maxBuffer: 64 * 1024 * 1024,
      }));
    } catch (err: unknown) {
      // An unknown `since` ref (e.g. history was rewritten, or the marker
      // points at a commit no longer reachable) makes git exit non-zero.
      // Fall back to the recent window rather than crashing the board.
      if (since) {
        return this.readCommits(undefined);
      }
      const e = err as Error & { stderr?: string };
      throw new Error(`git log failed in ${this.repoPath}: ${e.stderr ?? e.message}`, {
        cause: err,
      });
    }

    return this.parseGitLog(stdout);
  }

  /**
   * Parse the `-z`-terminated `%H\0%B\0` stream into commits + trailers.
   * Exposed for unit testing the trailer extraction in isolation.
   */
  parseGitLog(stdout: string): ParsedCommit[] {
    // Records are NUL-terminated; each record is "<sha>\0<body>".
    const tokens = stdout.split('\0');
    const commits: ParsedCommit[] = [];
    // Walk in pairs: [sha, body, sha, body, ...]. A trailing empty token
    // from the final NUL terminator is ignored.
    for (let i = 0; i + 1 < tokens.length; i += 2) {
      const sha = (tokens[i] ?? '').trim();
      const body = tokens[i + 1] ?? '';
      if (!sha) continue;
      commits.push({ sha, doneTrailers: extractTaskDoneTrailers(body) });
    }
    return commits;
  }
}

/**
 * Extract `Task-done:` trailer values from a commit body.
 *
 * A trailer is a `Key: value` line; multiple `Task-done:` lines per commit
 * are allowed (close several tasks in one commit). Matching is
 * case-insensitive on the key and the value is trimmed. Lines that merely
 * mention the phrase inside prose (without the `Key:` shape at line start)
 * are not trailers and are ignored.
 */
export function extractTaskDoneTrailers(body: string): string[] {
  const values: string[] = [];
  const re = new RegExp(`^${TASK_DONE_TRAILER}:\\s*(.+?)\\s*$`, 'i');
  for (const rawLine of body.split(/\r?\n/)) {
    const m = re.exec(rawLine);
    if (m?.[1]) values.push(m[1].trim());
  }
  return values;
}
