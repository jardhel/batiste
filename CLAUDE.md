# CLAUDE.md — Batiste repo working agreement

**Read this in full before the first tool call of any session in this repo.** This file is the binding instruction for Claude Code agents working inside `~/Documents/git/batiste/`. Memory entries in `~/.claude/projects/-Users-jardhel-Documents-git-batiste/memory/` are advisory; this file is authoritative. When the two disagree, this file wins; the memory entry is stale and must be updated.

The two-line summary, in case nothing else gets read:

1. **Use Batiste tools by default for every task that has a Batiste equivalent.** The mapping table below is the single source of truth. If you call a native Claude Code tool when a Batiste equivalent exists, you owe a one-line justification in the same turn.
2. **Default to maximum parallelism.** Independent file writes and reads go in a single message with parallel tool calls. Independent multi-step workstreams go to sub-agents in parallel. Sequential calls only when there is a real dependency.

---

## Tool mapping — Batiste-first

| If you would do this with a native Claude Code tool | Use this Batiste tool instead | Why |
|---|---|---|
| `Bash(grep …)` to find a symbol | `mcp__batiste__find_symbol` | LSP + tree-sitter aware; returns definition + all call sites; one structured payload |
| `Bash(grep …)` to scan files | `mcp__batiste__find_symbol` (if symbol) OR continue with `Bash(grep)` if pure text search | grep is fine for plain-text search; the rule is symbol-aware vs literal |
| `Bash(pnpm typecheck)` / `pnpm test` for lint check | `mcp__batiste__validate_code` | Runs ESLint + tsc together with structured truncation; ledgered as a tool call |
| `Bash(pnpm -r build)` to verify build | `Bash(pnpm -r build)` is fine — no Batiste equivalent yet | Acceptable native fallback |
| Reading multiple files to understand a package | `mcp__batiste__summarize_codebase` | Compressed summary instead of N reads (NB: as of 2026-04-24 this tool errors on TS dirs — bug task `2c8a0e6d`; until fixed, fall back to Read with justification) |
| TaskCreate / TaskUpdate | `mcp__batiste__manage_task` | Persistent DAG with status, parent/child, idempotent; survives across sessions |
| Quick "how does this codebase work" | `mcp__batiste__summarize_codebase` (when bug fixed) OR Explore agent | Prefer Batiste once the bug is fixed |
| `Bash(grep imports)` to find dependencies | `mcp__batiste__analyze_dependency` | Structured import graph with circulars surfaced |
| Writing test → impl → re-test loop | `mcp__batiste__run_tdd` | RED-GREEN cycle in one tool, validates code quality at the end |
| Auto-fix lint errors | `mcp__batiste__auto_fix` | Goes through eslint-with-fix + tsc reverification |
| Run an arbitrary shell command in a clean sandbox | `mcp__batiste__execute_sandbox` | Isolates the call, captures output, can ledger |
| Retrieve from Firm Memory | `node packages/atrium/bin/batiste-fm.js retrieve "<query>"` | The actual product surface. Use this whenever you need cross-silo recall |
| Ingest a source into FM | `node packages/atrium/bin/batiste-fm.js ingest <source>` | Same — operator surface, audit-emitted |

If a row above does not have a Batiste equivalent, native is fine. If a row has one, use it. If you skip the Batiste tool, the same turn must include a one-line justification ("Batiste equivalent unavailable because X").

---

## Self-audit at end of every multi-step task

Before declaring a task complete, scan your own turn for the pattern:

> "Did I use a native tool where a Batiste tool was listed in the table above?"

If yes, do one of: (a) re-do the work with the Batiste tool, (b) note the gap as a one-line debt in the response, or (c) file a `mcp__batiste__manage_task` task for the bug if the Batiste tool is broken.

This is not optional. It is the structural cure for the dogfood drift the founder has called out three times: the rule existed in memory, was forgotten across sessions, and got selectively followed. CLAUDE.md is loaded into context at session start; the rule does not depend on remembering.

---

## Maximum parallelism

Default to parallel where independent. Concretely:

- Writing N files that do not depend on each other → N `Write` calls in one message.
- Reading M files for context → M `Read` calls in one message.
- N independent multi-step workstreams → N `Agent` calls in one message with `run_in_background: true`.
- Smoke-testing a CLI + reading docs at the same time → batched.

Sequential only when the second call genuinely needs the first call's output. "I want to be careful" is not a sequential reason; it is a polite anti-pattern.

When spawning sub-agents in parallel, partition the file space cleanly so they cannot collide. The current cap is "as many as the work demands." There is no soft limit.

---

## Sub-agent caveat (Loop 5 — known platform limitation)

Claude Code sub-agents launched via the `Agent` tool do **not** inherit the Batiste MCP connection. They have only Bash / Read / Write / Edit. They cannot dogfood. This is a platform limitation, not a process failure.

What this means in practice:

- Tasks that need Batiste tools (validate_code, find_symbol, manage_task, etc.) must run in the **main session**, not via sub-agents.
- Tasks that are pure file-write / build / test runs are fine in sub-agents (they run pnpm directly).
- When a sub-agent finishes, the main-session integrator may run Batiste tools on the agent's output (validate_code on new files, etc.) to close the dogfood loop.

A v1.4 fix is tracked (`c56d0d58` in batiste TaskLog) to make sub-agents inherit MCP context. Until then: main-session does the Batiste calls; sub-agents do the bulk.

---

## Batiste-first applies to writing prose too

When writing release docs, ADRs, or memory entries that reference the codebase, prefer to **query Firm Memory first** (`batiste-fm retrieve "<topic>"`) over speculating from training data. Cross-silo retrieval is now real (66+ MD entries imported, retrievable via lexical + vector hybrid). Founder context, project history, deal status — all in FM as of 2026-04-24. If FM does not have it, then Read the source files directly. Speculate last.

---

## When in doubt

Default to the more conservative choice **for the user's data and trust**, and the more aggressive choice **for parallelism and Batiste-tool usage**. Asymmetric error costs: missing a parallel opportunity costs minutes; mishandling user data costs trust.

---

**Updated:** 2026-04-24. Maintainer: founder. To propose a change to this file, prefer a turn that opens with "I propose updating CLAUDE.md to …" so the change is explicit. Do not silently rewrite this file mid-task.
