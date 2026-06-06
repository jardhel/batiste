/**
 * @batiste-aidk/graph · contracts
 *
 * Abstract interfaces that Phase 2 implementations satisfy. Keeping
 * these distinct from {@link ./types.ts} makes the boundary explicit:
 *
 *   - `types.ts` defines the data the graph holds.
 *   - `contracts.ts` defines the operations that build, cluster,
 *     index, and query that data.
 *
 * Phase 2 will land three implementations behind these contracts:
 *
 *   - 2a — `TreeSitterIndexer` (extends `Indexer`) covering the
 *     existing TypeScript + Python parsers and growing to ~25
 *     languages.
 *   - 2b — `GraphologyGraphBuilder` (extends `GraphBuilder`) wrapping
 *     `graphology` with our deterministic ID and cluster contract.
 *   - 2c — `LouvainClusterer` / `LeidenClusterer` (extends
 *     `Clusterer`) producing the cluster overlay consumed by scope.
 *
 * No implementations live here in Phase 1 — only the type-level
 * contracts that pin the API surface.
 */

import type {
  BuildResult,
  Cluster,
  ClusterId,
  Edge,
  EdgeId,
  Graph,
  Node,
  NodeId,
} from './types.js';

// ---------------------------------------------------------------------------
// Builder inputs
// ---------------------------------------------------------------------------

/**
 * Input shape accepted by {@link GraphBuilder.build}. The shape is
 * deliberately simple: a list of nodes and edges. Phase 2 builders
 * may accept richer inputs (an entire workspace path, an audit
 * ledger), but every higher-level entry point ultimately reduces to
 * this primitive.
 */
export interface GraphInput {
  readonly nodes: readonly Node[];
  readonly edges: readonly Edge[];
}

/**
 * Input shape accepted by {@link Indexer.index}. Phase 2a's
 * `TreeSitterIndexer` walks `paths` with the tree-sitter languages
 * named in `languages`.
 */
export interface IndexerInput {
  readonly paths: readonly string[];
  /**
   * Tree-sitter language IDs to enable. When omitted, the indexer
   * autodetects from file extensions. Phase 2a's MVP supports
   * `typescript` and `python`; the roadmap targets ~25 languages.
   */
  readonly languages?: readonly string[];
  /**
   * Glob deny-list applied before parsing. The same patterns honoured
   * by `@batiste-aidk/scope` should be honoured here so policy
   * violations cannot enter the graph.
   */
  readonly ignore?: readonly string[];
}

/**
 * Input shape accepted by {@link Clusterer.cluster}.
 *
 * The clusterer is given the built graph; it returns a cluster
 * overlay rather than mutating the graph in place. Phase 2 may
 * provide multiple algorithms (Louvain, Leiden, Label Propagation)
 * behind this single contract.
 */
export interface ClustererInput {
  readonly graph: Graph;
  /**
   * Target cluster size hint (members per cluster). Implementations
   * should treat this as a soft target, not a hard cap.
   */
  readonly targetSize?: number;
  /**
   * Resolution parameter for modularity-based algorithms. Higher =
   * more, smaller clusters. Default is implementation-defined.
   */
  readonly resolution?: number;
  /**
   * Deterministic seed. Implementations MUST be reproducible across
   * runs given the same `(graph, targetSize, resolution, seed)`
   * tuple — this is what keeps cluster ACLs in `scope` stable.
   */
  readonly seed?: number;
}

/** Output of a clusterer run. */
export interface ClusterOverlay {
  readonly clusters: readonly Cluster[];
  /** Membership map. Implementations MUST cover every node in the input graph. */
  readonly assignment: ReadonlyMap<NodeId, ClusterId>;
}

// ---------------------------------------------------------------------------
// Abstract operations
// ---------------------------------------------------------------------------

/**
 * Builds a {@link Graph} from a primitive `(nodes, edges)` input.
 * Phase 2's `GraphologyGraphBuilder` is the canonical implementation.
 */
export interface GraphBuilder {
  build(input: GraphInput): BuildResult;
}

/**
 * Indexes a workspace into a built graph. Phase 2a's
 * `TreeSitterIndexer` is the canonical implementation.
 *
 * Returns `Promise<BuildResult>` — indexing is I/O-bound (file walk,
 * parser bootstrap), but querying the resulting graph is synchronous.
 */
export interface Indexer {
  index(input: IndexerInput): Promise<BuildResult>;
}

/**
 * Computes a cluster overlay over a built graph. Phase 2c's Louvain
 * and Leiden adapters satisfy this contract.
 */
export interface Clusterer {
  cluster(input: ClustererInput): ClusterOverlay;
}

/**
 * Read-only query interface used by `audit` (semantic annotations)
 * and `code` MCP tools. Mirrors a subset of {@link Graph}; exists as
 * its own type so consumers can mock it in isolation.
 */
export interface Querier {
  findByPath(path: string): NodeId | null;
  neighbors(
    nodeId: NodeId,
    opts?: { hops?: number; sameCluster?: boolean },
  ): readonly Node[];
  edge(id: EdgeId): Edge | null;
  cluster(id: ClusterId): Cluster | null;
}
