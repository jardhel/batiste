---
"@batiste-aidk/core": minor
"@batiste-aidk/code": minor
---

task-sync: reconcile the task DAG from `Task-done` commit trailers + stale-check

The task board no longer rots. Two additions keep `$PROJECT_ROOT/.batiste/tasks.db` honest with reality:

- **`reconcile` (Task-done trailer)** — commits carry a `Task-done: <label-or-id>` trailer (same shape as `Co-Authored-By`, multiple allowed per commit). `reconcileFromGit(repoPath, { since? })` reads the git log from a persisted marker (or the last N commits), extracts the trailers, matches each by **label or id** against the board, and marks the match `completed` — writing the commit SHA into the audit ledger (`@batiste-aidk/audit` task-log) as evidence. It is **idempotent**: it persists the last reconciled SHA and never re-closes an already-`completed` task. Exposed via `batiste-direct manage_task '{"action":"reconcile"}'`.

- **stale-check** — tasks `pending` past a threshold (default 14 days with no `updatedAt` movement) are **flagged** with a `staleSince` marker. Flagging surfaces the task; it does **not** change its status.

Integrity by construction: a task closes only with commit evidence, and stale tasks are signalled, never auto-closed.

Supporting (non-versioned) changes: the `Task-done` convention is documented in `CONTRIBUTING.md` and `CLAUDE.md`; a fail-soft `scripts/hooks/post-merge` hook runs reconcile on every merge/pull; CI runs the reconcile/stale-check logic tests (the live `--check` gate runs locally / in the hook, where a real `tasks.db` exists).
