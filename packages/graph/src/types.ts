/**
 * @batiste-aidk/graph · types
 *
 * Public type contract for the code-and-knowledge graph. Phase 1 of
 * `@batiste-aidk/graph` ships this surface only — no graph algorithms,
 * no clustering, no AST extraction. Phase 2 plugs implementations in
 * behind the abstract interfaces declared in `./contracts.ts`.
 *
 * The shape is driven by three consumers — see README §"The three
 * consumer profiles":
 *
 *   - `@batiste-aidk/scope` — cluster-level ACLs (`clusterOf`,
 *     `cluster`, `Cluster.label`, `Cluster.members`).
 *   - `@batiste-aidk/audit` — semantic annotations on ledger entries
 *     (`findByPath`, `neighbors`, `Node.label`, `Node.kind`).
 *   - `@batiste-aidk/code` MCP tools — `find_symbol`, `validate_code`,
 *     `summarize_codebase` (`findSymbol`, `summarize`).
 *
 * Determinism is part of the contract: given identical input, an
 * implementation MUST produce identical `NodeId` / `EdgeId` /
 * `ClusterId` values across runs. Cluster ACLs in `scope` rely on this
 * to keep policies stable; audit annotations rely on it to keep the
 * ledger's semantic context reproducible.
 */

// ---------------------------------------------------------------------------
// Branded identifiers
// ---------------------------------------------------------------------------

/**
 * Branded string used to address a graph node.
 *
 * Branding prevents accidental swaps between `NodeId`, `ClusterId`,
 * and `EdgeId` at call sites — the compiler refuses to pass one where
 * another is expected, even though all three are strings at runtime.
 *
 * Construct via {@link nodeId} from a Phase 2 implementation; do NOT
 * construct by hand outside the package boundary.
 */
export type NodeId = string & { readonly __brand: 'NodeId' };

/** Branded string used to address a cluster (community) of nodes. */
export type ClusterId = string & { readonly __brand: 'ClusterId' };

/** Branded string used to address an edge. */
export type EdgeId = string & { readonly __brand: 'EdgeId' };

/**
 * Internal helpers used by Phase 2 implementations to mint branded
 * IDs. Exported for the implementation packages, not for application
 * code — application code should treat IDs as opaque.
 */
export const nodeId = (raw: string): NodeId => raw as NodeId;
export const clusterId = (raw: string): ClusterId => raw as ClusterId;
export const edgeId = (raw: string): EdgeId => raw as EdgeId;

// ---------------------------------------------------------------------------
// Node and edge kinds
// ---------------------------------------------------------------------------

/**
 * The five node kinds Phase 1 commits to.
 *
 *  - `file`    — a single file in the indexed corpus.
 *  - `symbol`  — a named declaration extracted from an AST (function,
 *                class, type, etc.); `language` is populated.
 *  - `doc`     — a documentation/markdown chunk.
 *  - `fact`    — a {@link import('@batiste-aidk/memory').FactEntry}
 *                projection (decision, precedent, clause...).
 *  - `concept` — a synthetic node minted by clustering (e.g., a
 *                cluster-as-node for cross-cluster summarization).
 *
 * Adding a new kind is a SemVer-major change to this package. The
 * union is intentionally narrow so consumers can write exhaustive
 * switches.
 */
export type NodeKind = 'file' | 'symbol' | 'doc' | 'fact' | 'concept';

/**
 * The six edge kinds Phase 1 commits to.
 *
 *  - `imports`      — file/symbol → file/symbol via import statement.
 *  - `calls`        — symbol → symbol via call expression.
 *  - `references`   — symbol → symbol via name reference (non-call).
 *  - `contains`     — file → symbol; cluster → member projections.
 *  - `links-to`     — doc/fact → doc/fact (wikilinks, hyperlinks).
 *  - `derived-from` — fact/doc → file/symbol (provenance edges minted
 *                    by atrium ingest pipelines).
 */
export type EdgeKind = 'imports' | 'calls' | 'references' | 'contains' | 'links-to' | 'derived-from';

// ---------------------------------------------------------------------------
// Core data shapes
// ---------------------------------------------------------------------------

/**
 * Metadata payload attached to every node and edge.
 *
 * Restricted to scalar values (string, number, boolean) so the entire
 * graph can be JSON-serialised without bespoke encoders. Phase 2
 * implementations may interpret well-known keys (e.g., `tree-sitter:kind`,
 * `gvs:stamp`) but the type itself stays open.
 */
export type GraphMetadata = Readonly<Record<string, string | number | boolean>>;

/** A single node in the graph. */
export interface Node {
  readonly id: NodeId;
  readonly kind: NodeKind;
  /** Human-readable label — symbol name, file basename, doc title, fact title. */
  readonly label: string;
  /** Repository-relative path; populated for `file` and `symbol` kinds. */
  readonly path?: string;
  /** Tree-sitter language ID (`typescript`, `python`, ...); populated for `symbol` kind. */
  readonly language?: string;
  readonly metadata: GraphMetadata;
}

/** A directed edge between two nodes. */
export interface Edge {
  readonly id: EdgeId;
  readonly source: NodeId;
  readonly target: NodeId;
  readonly kind: EdgeKind;
  /** Optional weight. Phase 2 clusterers may use this; consumers should not assume normalisation. */
  readonly weight?: number;
}

/** A cluster (community) of related nodes derived by Phase 2 clustering. */
export interface Cluster {
  readonly id: ClusterId;
  /** Human-readable, derived label (`auth/`, `billing/`, `ui/components/`). */
  readonly label: string;
  readonly members: readonly NodeId[];
  /**
   * Cohesion score in `[0, 1]`. Phase 2 may populate this; consumers
   * MUST treat `undefined` as "not computed" rather than zero.
   */
  readonly cohesion?: number;
}

// ---------------------------------------------------------------------------
// Query options
// ---------------------------------------------------------------------------

/**
 * Options for {@link Graph.neighbors}. All fields are optional.
 *
 * Defaults are the contract — Phase 2 implementations MUST honour
 * them so consumers can rely on the same behaviour across backends.
 */
export interface QueryOptions {
  /** Hop distance from the seed node. Default: `1`. */
  readonly hops?: number;
  /** Restrict results to the seed node's own cluster. Default: `false`. */
  readonly sameCluster?: boolean;
  /** Filter results by node kind. Default: no filter. */
  readonly kinds?: readonly NodeKind[];
  /** Maximum number of nodes to return. Default: implementation-defined (typically 100). */
  readonly limit?: number;
}

/** Options for {@link Graph.findSymbol}. */
export interface FindSymbolOptions {
  /** Restrict results to specific node kinds. Default: `['symbol']`. */
  readonly kinds?: readonly NodeKind[];
  /** Restrict results to a single tree-sitter language. */
  readonly language?: string;
}

/** Options for {@link Graph.summarize}. */
export interface SummarizeOptions {
  /**
   * Path-prefix or cluster-label scope. When provided, the summary
   * focuses on nodes under that scope. Default: whole graph.
   */
  readonly scope?: string;
  /**
   * Soft cap on summary length, measured in model tokens. Phase 2 may
   * approximate this (e.g., chars / 4). Default: implementation-defined.
   */
  readonly maxTokens?: number;
}

// ---------------------------------------------------------------------------
// The Graph surface
// ---------------------------------------------------------------------------

/**
 * Read-only view of a built graph.
 *
 * Phase 2 implementations may back this with `graphology`; this
 * package never imports `graphology` so the public type contract
 * stays library-agnostic.
 *
 * All accessors are synchronous: builders do the asynchronous work
 * (`Indexer.index` returns `Promise<Graph>`), but querying a built
 * graph is in-memory.
 */
export interface Graph {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly clusterCount: number;

  /** Resolve a node by ID, or `null` if absent. */
  node(id: NodeId): Node | null;

  /** Resolve an edge by ID, or `null` if absent. */
  edge(id: EdgeId): Edge | null;

  /** Resolve a cluster by ID, or `null` if absent. */
  cluster(id: ClusterId): Cluster | null;

  /** Cluster a node belongs to, or `null` if the node is unclustered or unknown. */
  clusterOf(nodeId: NodeId): ClusterId | null;

  /** Symbol lookup by name (typically the unqualified identifier). */
  findSymbol(name: string, opts?: FindSymbolOptions): readonly Node[];

  /** File-node lookup by repository-relative path. */
  findByPath(path: string): Node | null;

  /** Neighbour lookup; honours {@link QueryOptions}. */
  neighbors(nodeId: NodeId, opts?: QueryOptions): readonly Node[];

  /** Render a textual summary of the graph (or a sub-scope). */
  summarize(opts?: SummarizeOptions): string;
}

// ---------------------------------------------------------------------------
// Source-weighted retrieval (Phase 2d — Vault Graph RAG)
// ---------------------------------------------------------------------------

/**
 * Well-known metadata key carrying a node's *source* — the provenance
 * silo it came from (e.g. `vault`, `code`, `audit`, `external`, or a
 * vault GVS axis). Source-weighted retrieval reads this key off
 * {@link Node.metadata} to look the node's weight up in a
 * {@link SourceWeightConfig}.
 *
 * `gvs:` prefix matches the vault's six-axis GVS convention referenced
 * elsewhere in this package; using a namespaced key keeps it from
 * colliding with parser-emitted keys like `tree-sitter:kind`.
 */
export const SOURCE_METADATA_KEY = 'gvs:source';

/**
 * Opaque source label. A string at runtime; any value that appears as
 * `metadata[SOURCE_METADATA_KEY]` (or, as a fallback, a {@link NodeKind})
 * is a valid `Source`. Whitelabel tenants drive their own vocabulary
 * here via config — there is no closed union.
 */
export type Source = string;

/**
 * Per-source multipliers applied during source-weighted retrieval.
 *
 * `weights` maps a {@link Source} to a non-negative multiplier. A
 * weight of `1` is neutral; `> 1` boosts that source; `0` suppresses it
 * (the node can still appear at score 0 unless `dropZeroWeight` prunes
 * it). Sources absent from the map fall back to {@link defaultWeight}.
 *
 * The config is the whitelabel knob the benchmark turns: holding the
 * corpus, embedder, traversal, and seed fixed and varying ONLY
 * `weights` isolates the marginal effect of source-weighting on
 * ranking — the apples-to-apples discipline of the benchmark SPEC.
 */
export interface SourceWeightConfig {
  /** Source → non-negative multiplier. */
  readonly weights: Readonly<Record<Source, number>>;
  /** Multiplier for sources absent from {@link weights}. Default: `1`. */
  readonly defaultWeight?: number;
  /**
   * When `true`, candidates whose effective source weight is `0` are
   * omitted from results entirely (a hard source filter) rather than
   * returned with score `0`. Default: `false`.
   */
  readonly dropZeroWeight?: boolean;
}

/**
 * Options for source-weighted retrieval over a {@link Graph}.
 *
 * Retrieval is seeded by one or more nodes (the lexical/embedding
 * pre-selection upstream is out of scope for this package — see the
 * benchmark SPEC §4: this layer is the GRAPH expansion/re-ranking that
 * Benchmark B ablates against a flat baseline). From the seeds it walks
 * up to {@link maxHops} hops, decaying proximity by {@link hopDecay}
 * per hop, then multiplies by the per-source weight.
 */
export interface SourceWeightedQuery {
  /** Seed node(s) the retrieval expands from. At least one is required. */
  readonly seeds: readonly NodeId[];
  /** Per-source weighting. Required — it is the point of this call. */
  readonly sources: SourceWeightConfig;
  /** Max hop distance to expand from any seed. Default: `2`. */
  readonly maxHops?: number;
  /**
   * Proximity decay per hop, in `(0, 1]`. A seed scores `1`; a node at
   * hop `h` scores `hopDecay ** h` before the source multiplier.
   * Default: `0.5`.
   */
  readonly hopDecay?: number;
  /** Restrict candidates to these node kinds. Default: no filter. */
  readonly kinds?: readonly NodeKind[];
  /** Include the seed nodes themselves in the ranked output. Default: `true`. */
  readonly includeSeeds?: boolean;
  /** Maximum number of scored nodes to return. Default: `100`. */
  readonly limit?: number;
}

/**
 * A node paired with its retrieval score and the provenance of that
 * score. Returned by source-weighted retrieval, ranked by `score`
 * descending with a deterministic NodeId tie-break.
 */
export interface ScoredNode {
  readonly node: Node;
  /** Final score: `proximity * sourceWeight`. */
  readonly score: number;
  /** Hop distance from the nearest seed (`0` for a seed). */
  readonly hops: number;
  /** Proximity component before the source multiplier (`hopDecay ** hops`). */
  readonly proximity: number;
  /** The {@link Source} resolved for this node. */
  readonly source: Source;
  /** The multiplier applied for that source. */
  readonly sourceWeight: number;
}

// ---------------------------------------------------------------------------
// Result envelopes (for Phase 2 builders)
// ---------------------------------------------------------------------------

/**
 * Diagnostic envelope returned by Phase 2 builders alongside the
 * graph. Lives in `types.ts` so consumers can describe their own
 * builder return types without depending on `contracts.ts`.
 */
export interface BuildDiagnostics {
  readonly elapsedMs: number;
  readonly filesScanned: number;
  readonly filesParsed: number;
  readonly parseErrors: readonly { readonly path: string; readonly reason: string }[];
}

/** Wrapper coupling a built graph with its build-time diagnostics. */
export interface BuildResult {
  readonly graph: Graph;
  readonly diagnostics: BuildDiagnostics;
}
