import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdir, rm, writeFile } from 'fs/promises';
import { execFileSync } from 'child_process';
import { SQLiteTaskStore } from './SQLiteTaskStore.js';
import { SQLiteReconcileMarkerStore } from './SQLiteReconcileMarkerStore.js';
import { TaskManager } from './TaskManager.js';
import { TaskReconciler, extractTaskDoneTrailers } from './TaskReconciler.js';
import type { ReconcileAuditSink } from './types.js';

// Mirror TaskManager.test.ts: better-sqlite3 native bindings don't build on
// GitHub Actions, and these tests also shell out to git. Skip in CI so the
// pipeline stays green; they run locally where both are available.
const describeWithSQLite = process.env.CI ? describe.skip : describe;

/** Minimal git repo fixture; commits carry whatever body we pass. */
class GitFixture {
  private n = 0;
  constructor(readonly dir: string) {}

  init(): void {
    const opts = { cwd: this.dir };
    execFileSync('git', ['init', '-q'], opts);
    execFileSync('git', ['config', 'user.email', 'test@batiste.dev'], opts);
    execFileSync('git', ['config', 'user.name', 'Batiste Test'], opts);
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], opts);
  }

  /** Create a commit with the given message body; returns its full SHA. */
  async commit(message: string): Promise<string> {
    const file = join(this.dir, `f${this.n++}.txt`);
    await writeFile(file, `change ${this.n}\n`);
    const opts = { cwd: this.dir };
    execFileSync('git', ['add', '-A'], opts);
    execFileSync('git', ['commit', '-q', '-m', message], opts);
    return execFileSync('git', ['rev-parse', 'HEAD'], opts).toString().trim();
  }
}

/** Capturing audit sink for asserting evidence is recorded. */
function makeSink(): ReconcileAuditSink & {
  calls: { taskId: string; label: string; commitSha: string; matchedBy: string }[];
} {
  const calls: { taskId: string; label: string; commitSha: string; matchedBy: string }[] = [];
  return { calls, recordClosure: (e) => void calls.push(e) };
}

describe('extractTaskDoneTrailers', () => {
  it('extracts a single Task-done trailer', () => {
    const body = 'feat: thing\n\nTask-done: build-feature\n';
    expect(extractTaskDoneTrailers(body)).toEqual(['build-feature']);
  });

  it('extracts multiple trailers from one commit', () => {
    const body = 'feat: x\n\nTask-done: a\nTask-done: b\nCo-Authored-By: y\n';
    expect(extractTaskDoneTrailers(body)).toEqual(['a', 'b']);
  });

  it('is case-insensitive on the key and trims the value', () => {
    expect(extractTaskDoneTrailers('x\n\ntask-done:   spaced  \n')).toEqual(['spaced']);
  });

  it('ignores the phrase when it is not a trailer line', () => {
    expect(extractTaskDoneTrailers('We have a Task-done thing in prose\n')).toEqual([]);
  });
});

describeWithSQLite('TaskReconciler', () => {
  let testDir: string;
  let repoDir: string;
  let store: SQLiteTaskStore;
  let markerStore: SQLiteReconcileMarkerStore;
  let manager: TaskManager;
  let git: GitFixture;

  beforeEach(async () => {
    testDir = join(tmpdir(), `batiste-recon-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    repoDir = join(testDir, 'repo');
    await mkdir(repoDir, { recursive: true });
    store = new SQLiteTaskStore(join(testDir, 'tasks.db'));
    markerStore = new SQLiteReconcileMarkerStore(join(testDir, 'reconcile.db'));
    manager = new TaskManager(store);
    git = new GitFixture(repoDir);
    git.init();
  });

  afterEach(async () => {
    store.close();
    markerStore.close();
    await rm(testDir, { recursive: true, force: true });
  });

  it('closes a task matched by exact label via a single trailer', async () => {
    const task = await manager.createRootGoal('ship the radar');
    await git.commit('initial');
    const sha = await git.commit('feat: radar\n\nTask-done: ship the radar\n');

    const sink = makeSink();
    const reconciler = new TaskReconciler(manager, repoDir, markerStore, sink);
    const result = await reconciler.reconcileFromGit();

    expect(result.closed).toHaveLength(1);
    expect(result.closed[0]).toMatchObject({ taskId: task.id, label: 'ship the radar', sha });
    expect((await manager.getTask(task.id))?.status).toBe('completed');
    // audit evidence written with the commit sha
    expect(sink.calls).toHaveLength(1);
    expect(sink.calls[0]).toMatchObject({ taskId: task.id, commitSha: sha });
  });

  it('closes a task matched by id', async () => {
    const task = await manager.createRootGoal('opaque label');
    const sha = await git.commit(`fix: stuff\n\nTask-done: ${task.id}\n`);

    const reconciler = new TaskReconciler(manager, repoDir, markerStore);
    const result = await reconciler.reconcileFromGit();

    expect(result.closed).toHaveLength(1);
    expect(result.closed[0]).toMatchObject({ taskId: task.id, matchedBy: task.id, sha });
    expect((await manager.getTask(task.id))?.status).toBe('completed');
  });

  it('closes multiple tasks from multiple trailers in one commit', async () => {
    const a = await manager.createRootGoal('task A');
    const b = await manager.createRootGoal('task B');
    await git.commit('feat: both\n\nTask-done: task A\nTask-done: task B\n');

    const reconciler = new TaskReconciler(manager, repoDir, markerStore);
    const result = await reconciler.reconcileFromGit();

    expect(result.closed.map((c) => c.taskId).sort()).toEqual([a.id, b.id].sort());
    expect((await manager.getTask(a.id))?.status).toBe('completed');
    expect((await manager.getTask(b.id))?.status).toBe('completed');
  });

  it('is idempotent: a second run closes nothing new and does not duplicate audit', async () => {
    const task = await manager.createRootGoal('idempotent');
    await git.commit('feat\n\nTask-done: idempotent\n');

    const sink = makeSink();
    const reconciler = new TaskReconciler(manager, repoDir, markerStore, sink);

    const first = await reconciler.reconcileFromGit();
    expect(first.closed).toHaveLength(1);
    expect(sink.calls).toHaveLength(1);

    const second = await reconciler.reconcileFromGit();
    expect(second.closed).toHaveLength(0);
    expect(sink.calls).toHaveLength(1); // no new audit entry
    expect((await manager.getTask(task.id))?.status).toBe('completed');
  });

  it('treats an unknown label as a silent no-op (surfaced as unmatched, not error)', async () => {
    await manager.createRootGoal('real task');
    const sha = await git.commit('feat\n\nTask-done: does not exist\n');

    const reconciler = new TaskReconciler(manager, repoDir, markerStore);
    const result = await reconciler.reconcileFromGit();

    expect(result.closed).toHaveLength(0);
    expect(result.unmatched).toEqual([{ matchedBy: 'does not exist', sha }]);
  });

  it('persists the marker so re-runs only inspect new commits', async () => {
    const a = await manager.createRootGoal('first');
    await git.commit('feat\n\nTask-done: first\n');

    const reconciler = new TaskReconciler(manager, repoDir, markerStore);
    const r1 = await reconciler.reconcileFromGit();
    expect(r1.closed).toHaveLength(1);
    expect(markerStore.getLastSha()).toBe(r1.lastSha);

    // New work + new commit; the second run should only see the new commit.
    const b = await manager.createRootGoal('second');
    const sha2 = await git.commit('feat\n\nTask-done: second\n');
    const r2 = await reconciler.reconcileFromGit();
    expect(r2.commitsScanned).toBe(1);
    expect(r2.closed).toHaveLength(1);
    expect(r2.closed[0]).toMatchObject({ taskId: b.id, sha: sha2 });
    void a;
  });

  it('stale-check flags old pending tasks without closing them', async () => {
    const fresh = await manager.createRootGoal('fresh');
    const old = await manager.createRootGoal('old');

    // Backdate the "old" task's updatedAt to 30 days ago directly in SQLite.
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 86_400;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (store as any).db
      .prepare('UPDATE tasks SET updatedAt = ? WHERE id = ?')
      .run(thirtyDaysAgo, old.id);

    const reconciler = new TaskReconciler(manager, repoDir, markerStore);
    const { stale, thresholdDays } = await reconciler.staleCheck({ staleDays: 14 });

    expect(thresholdDays).toBe(14);
    expect(stale.map((s) => s.taskId)).toEqual([old.id]);
    expect(stale[0]?.ageDays).toBeGreaterThanOrEqual(29);
    // NOT closed — stale only signals.
    expect((await manager.getTask(old.id))?.status).toBe('pending');
    expect((await manager.getTask(fresh.id))?.status).toBe('pending');
  });

  it('reconcileFromGit bundles a stale pass alongside closures', async () => {
    const done = await manager.createRootGoal('done task');
    const stalePending = await manager.createRootGoal('stale pending');
    await git.commit('feat\n\nTask-done: done task\n');

    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 86_400;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (store as any).db
      .prepare('UPDATE tasks SET updatedAt = ? WHERE id = ?')
      .run(thirtyDaysAgo, stalePending.id);

    const reconciler = new TaskReconciler(manager, repoDir, markerStore);
    const result = await reconciler.reconcileFromGit({ staleDays: 14 });

    expect(result.closed.map((c) => c.taskId)).toEqual([done.id]);
    expect(result.stale.map((s) => s.taskId)).toEqual([stalePending.id]);
  });

  it('does not flag an already-completed task as stale', async () => {
    const t = await manager.createRootGoal('completed but old');
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 86_400;
    await manager.updateStatus(t.id, 'completed');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (store as any).db
      .prepare('UPDATE tasks SET updatedAt = ? WHERE id = ?')
      .run(thirtyDaysAgo, t.id);

    const reconciler = new TaskReconciler(manager, repoDir, markerStore);
    const { stale } = await reconciler.staleCheck({ staleDays: 14 });
    expect(stale).toHaveLength(0);
  });

  it('recovers from an unknown since ref by falling back to the recent window', async () => {
    const task = await manager.createRootGoal('survivor');
    await git.commit('feat\n\nTask-done: survivor\n');

    const reconciler = new TaskReconciler(manager, repoDir, markerStore);
    // A bogus ref must not crash the board.
    const result = await reconciler.reconcileFromGit({ since: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' });
    expect(result.closed).toHaveLength(1);
    expect(result.closed[0]?.taskId).toBe(task.id);
  });
});
