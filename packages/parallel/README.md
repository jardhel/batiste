# @batiste-aidk/parallel

Spark-inspired DAG executor for Batiste. The substrate that v1.4 uses to make
every subcommand parallel-by-default.

## Why

Today's Batiste subcommands are mostly serial loops: ingest one source, then
the next; analyze one file, then the next; fan out to one MCP tool, then the
next. Any work that *can* be parallel should saturate the local machine and
the operator's API rate limits, automatically. This package is that substrate.

Two design constraints:

1. **Zero npm deps.** Node's `os`, `crypto`, `events` are enough.
2. **Same API in v1.4 and v1.4.1.** v1.4 ships an async-Promise pool. v1.4.1
   adds `worker_threads` workers behind the same `Operation.fn` boundary,
   triggered by `tag: 'cpu-bound'`. User code does not change.

## Example

```ts
import { Plan, Executor } from '@batiste-aidk/parallel';

const plan = new Plan();
const a = plan.add('fetch-trello',  async () => fetchTrelloBoard());
const b = plan.add('fetch-drive',   async () => fetchDriveFolder());
const c = plan.add(
  'compile-slides',
  { deps: [a, b], tag: 'cpu-bound' },
  async ({ deps }) => {
    const [trello, drive] = deps;
    return compile(trello, drive);
  },
);

const exec = new Executor({
  concurrency: 'auto',                  // floor(cpus / 2)
  concurrencyByTag: { 'llm-bound': 'auto' }, // reads ANTHROPIC_TIER
  onLineage: (e) => auditLedger.append(e),
});

const { results, lineage } = await exec.run(plan);
```

## Failure semantics

If an op throws, downstream ops with that op as a (transitive) dep are
skipped — they emit a synthetic lineage entry with
`error.message = 'upstream failed: <name>'`. Independent branches keep
running. `Executor.run()` always resolves; the caller decides what to do
based on the returned partial `results` map and the `lineage` log.

This matches the projection-rebuild pattern from
`docs/adr/ADR-0002-firm-memory-governance.md` — no partial rollback, the
caller re-runs the failed branch (or rebuilds the projection) when ready.

## ANTHROPIC_TIER auto-tune

`concurrencyByTag: { 'llm-bound': 'auto' }` reads `process.env.ANTHROPIC_TIER`
(`1` | `2` | `3` | `4` | `enterprise`, default `1`) and derives a steady-state
in-flight cap from the published RPM table. `enterprise` skips throttling.

## What this package is NOT

- Not a queue. There is no persistence — a `Plan` lives only in process memory.
- Not a retry library. Failure cascades; the caller re-runs.
- Not (yet) a worker_threads pool. v1.4.1 adds that for `tag: 'cpu-bound'`.
