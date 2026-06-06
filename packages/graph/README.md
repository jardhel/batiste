# @batiste-aidk/graph

Code-and-knowledge graph for Batiste. Symbol, file, doc, and fact nodes;
deterministic clusters; a query surface consumed by `scope`, `audit`, and
the `code` MCP tools.

## Why this package exists

Three Batiste subsystems independently grew the same need: a shared
semantic substrate over the codebase and the firm's documents.
`scope` needs cluster-level ACLs (deny "billing/" to an agent without
naming every file). `audit` needs to annotate ledger entries with the
cluster and neighbour symbols a tool call touched. The `code` MCP
tools (`find_symbol`, `validate_code`, `summarize_codebase`) need an
indexable view of every language's AST collapsed into one graph
addressable by symbol name. The repository's `README.md`,
`ARCHITECTURE.md`, and `@batiste-aidk/scope`'s package description
already advertise this package as the landing pad for AST-level
enforcement; closing the API surface is the largest single
DD-blocking gap remaining in the platform.

## Where it sits

```
+---------------------------+      +---------------------------+
| @batiste-aidk/code        |      | atrium ingest vault       |
|   tree-sitter parsers     |      |   Obsidian → FactEntry    |
+-------------+-------------+      +-------------+-------------+
              |                                  |
              v                                  v
        +------------------------------------------------+
        |          @batiste-aidk/graph (this)            |
        |  Indexer · GraphBuilder · Clusterer · Querier  |
        +-------------------+----------------------------+
                            |
       +--------------------+-----------------------+
       v                    v                       v
+---------------+   +----------------+   +---------------------+
| scope         |   | audit          |   | code MCP tools      |
| cluster ACLs  |   | semantic       |   | find_symbol /       |
|               |   | annotations    |   | summarize_codebase  |
+---------------+   +----------------+   +---------------------+
```

The package sits between AST extractors (Phase 2a will subsume the
existing tree-sitter wiring in `@batiste-aidk/code`) and the
consumers above. It owns the data model and the abstract contracts;
implementations land in Phase 2.

## The three consumer profiles

### `@batiste-aidk/scope` — cluster ACLs

```ts
const cId = graph.clusterOf(graph.findByPath('src/billing/checkout.ts')!.id);
const cluster = cId ? graph.cluster(cId) : null;
// → { id, label: 'billing/', members: [...], cohesion: 0.74 }
// scope can deny the whole cluster without enumerating files.
```

Cluster IDs are deterministic across runs given identical input — a
hard requirement so policies stay stable.

### `@batiste-aidk/audit` — semantic annotations

```ts
const seed = graph.findByPath(toolCall.args.path);
if (seed) {
  const neighbours = graph.neighbors(seed.id, { sameCluster: true, kinds: ['symbol'], limit: 5 });
  ledger.append({ ...entry, args: { ...entry.args, _semantic: {
    cluster: graph.cluster(graph.clusterOf(seed.id)!)?.label,
    nearby: neighbours.map((n) => n.label),
  } } });
}
// → ledger entry: "this call touched the auth/ cluster, near
// SessionToken, Login, refreshToken, ..."
```

### `@batiste-aidk/code` MCP tools — `find_symbol`, `summarize_codebase`

```ts
const matches = graph.findSymbol('SessionToken', { language: 'typescript' });
const overview = graph.summarize({ scope: 'src/auth', maxTokens: 800 });
```

A single graph addressable by symbol name across every supported
tree-sitter language; a `summarize()` that produces a token-bounded
overview suitable for an LLM context window.

## Phase plan

1. **Phase 1 — public API surface (this).** No algorithms, no
   dependencies; just types, contracts, README, type-level tests.
   Unblocks Phases 2a/2b/2c (parallelisable across agents) and Phase 3.
2. **Phase 2a — `TreeSitterIndexer`.** Subsumes the existing
   TypeScript + Python wiring in `@batiste-aidk/code`, then grows to
   the ~25-language tree-sitter set targeted by the roadmap.
3. **Phase 2b — `GraphologyGraphBuilder`.** Wraps `graphology` (and
   `graphology-communities-louvain` in Phase 2c) behind the
   {@link GraphBuilder} contract. `graphology` is intentionally NOT a
   dependency of this Phase 1 package — adding it would couple the
   public API to a particular library version.
4. **Phase 2c — Louvain / Leiden clusterer.** Deterministic with a
   seed; cluster labels derived from member paths/symbols.
5. **Phase 3 — wire into consumers.** `scope` gains
   `clusterDeny`/`clusterAllow` policy fields; `audit` gains a
   `semanticAnnotator` middleware; `code` swaps its in-process AST
   indexer for `Indexer.index()`. `atrium ingest vault` finishes its
   `graphify` projection on top of this graph.
6. **Phase 4 — dogfood validation.** Run Batiste against itself,
   confirm the cluster overlay matches the human-intuitive package
   layout, and publish a reference cluster snapshot in
   `assets/graph-snapshots/`.

## Decisions deliberately deferred

- **Distributed graph.** v1 is single-process, in-memory. Sharding
  across nodes (or out-of-core graphs over RocksDB) waits for a
  validated need.
- **Cross-deployment graph federation.** Two firms cross-querying
  each other's clusters is a Batiste-2 question and depends on
  ADR-0005's federation model.
- **Realtime updates.** v1 is batch (rebuild on demand). Incremental
  updates from `code`'s `GitAwareIndexer` may land in v1.x but are
  not contracted in Phase 1.
- **Cross-language symbol identity.** Phase 2a treats per-language
  symbols as distinct nodes. Whether `Login` in `auth.py` and `Login`
  in `auth.ts` should collapse into one node is a Phase 4 question to
  be answered with real-corpus evidence.
- **Embedding-backed similarity edges.** `@batiste-aidk/memory` owns
  the vector layer; whether to project its similarity into graph
  edges is a v1.x experiment, not a Phase 1 commitment.
