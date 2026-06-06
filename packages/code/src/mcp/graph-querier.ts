/**
 * GraphQuerier
 *
 * Phase 3 wiring of `@batiste-aidk/graph` into `@batiste-aidk/code`.
 *
 * This module is deliberately a *thin adapter* around an already-built
 * {@link Graph}. It does no parsing, no clustering, no I/O — it only
 * shapes the graph's existing read API into the projections the MCP
 * tools (`find_symbol`, `summarize_codebase`) want.
 *
 * Why an adapter at all?
 * ----------------------
 * 1. Stable shape for the MCP layer. The graph package can grow new
 *    methods without forcing handler.ts to learn them.
 * 2. Single integration seam for tests. Handler tests can mock this
 *    adapter without standing up a graph.
 * 3. Per-tool framing. `find_symbol` wants `(name, language) → hits +
 *    cluster`; `summarize_codebase` wants `cluster summary text`. Both
 *    fall out of the same Graph but with different shaping.
 *
 * Backward compatibility note
 * ---------------------------
 * The MCP tools fall back to their existing tree-sitter / LSP paths
 * when no graph is provided. `GraphQuerier` therefore only ever sees
 * the case where a graph IS available; absence is handled at the call
 * site in `handler.ts`.
 */

import type { FindSymbolOptions, Graph, Node } from '@batiste-aidk/graph';

/**
 * Per-hit shape returned by {@link GraphQuerier.findSymbol}.
 *
 * Every hit carries the canonical Graph node plus the resolved cluster
 * label (when available). Cluster context is the headline value-add
 * over the existing tree-sitter symbol scan — "show me all auth-cluster
 * references to SessionToken" requires that label to live alongside
 * the hit.
 */
export interface GraphSymbolHit {
  readonly node: Node;
  readonly cluster: { readonly id: string; readonly label: string } | null;
}

/**
 * Per-cluster row returned by {@link GraphQuerier.clusterSummary}.
 *
 * Sorted by `memberCount` descending — handler code usually wants the
 * top-N clusters for a one-screen overview.
 */
export interface ClusterSummaryRow {
  readonly id: string;
  readonly label: string;
  readonly memberCount: number;
  readonly cohesion?: number;
}

/**
 * Stateless adapter. Holding a single instance per service is fine —
 * all state lives in the wrapped graph.
 */
export class GraphQuerier {
  constructor(private readonly graph: Graph) {}

  /** Return the wrapped graph for callers that need the raw surface. */
  raw(): Graph {
    return this.graph;
  }

  /**
   * Symbol search with cluster context.
   *
   * Mirrors `Graph.findSymbol` but enriches each hit with its cluster.
   * The graph's own ordering is deterministic, so callers see stable
   * results across runs.
   */
  findSymbol(name: string, opts?: FindSymbolOptions): GraphSymbolHit[] {
    const hits = this.graph.findSymbol(name, opts);
    return hits.map((node) => {
      const cId = this.graph.clusterOf(node.id);
      const cluster = cId ? this.graph.cluster(cId) : null;
      return {
        node,
        cluster: cluster ? { id: cluster.id as string, label: cluster.label } : null,
      };
    });
  }

  /**
   * Filter `findSymbol` hits to a single cluster label.
   *
   * Cluster matching is exact on the cluster's *label*, not its ID —
   * IDs are hash-derived and not author-friendly. Callers who need
   * glob matching can layer micromatch over the result.
   */
  findSymbolInCluster(name: string, clusterLabel: string, opts?: FindSymbolOptions): GraphSymbolHit[] {
    return this.findSymbol(name, opts).filter((h) => h.cluster?.label === clusterLabel);
  }

  /**
   * Per-cluster summary suitable for `summarize_codebase`. Sorted by
   * member count (desc) with stable ID-based tiebreak so output is
   * byte-stable across runs.
   *
   * `limit` caps the number of rows returned; defaults to 25, which
   * fits a typical mid-sized repo on one screen without blowing the
   * token budget.
   */
  clusterSummary(limit = 25): ClusterSummaryRow[] {
    const rows: ClusterSummaryRow[] = [];
    // The Graph contract does not expose cluster iteration directly,
    // but the implementation backs `clusterCount` with an iterable map.
    // To stay strictly contract-bound, we walk every node and collect
    // unique cluster IDs from `clusterOf`. This is O(N) but only runs
    // when the MCP tool is invoked, not on every request.
    //
    // Phase 4 follow-up: lift `Graph.clusters(): Iterable<Cluster>` so
    // callers do not need this enumeration trick.
    const seen = new Set<string>();
    // Use the implementation-side `nodes()` iterator when present; fall
    // back to scanning by `nodeCount` lookups would require yet another
    // contract extension we do not own here.
    const iterable = (this.graph as unknown as { nodes?: () => Iterable<{ valueOf?: unknown }> })
      .nodes?.();
    if (!iterable) {
      // Cannot enumerate — return empty rather than throw; the tool
      // will fall back to its tree-sitter path.
      return [];
    }
    for (const id of iterable as Iterable<unknown>) {
      const cId = this.graph.clusterOf(id as never);
      if (!cId || seen.has(cId as string)) continue;
      seen.add(cId as string);
      const c = this.graph.cluster(cId);
      if (!c) continue;
      rows.push({
        id: c.id as string,
        label: c.label,
        memberCount: c.members.length,
        ...(c.cohesion !== undefined ? { cohesion: c.cohesion } : {}),
      });
    }
    rows.sort((a, b) => {
      if (b.memberCount !== a.memberCount) return b.memberCount - a.memberCount;
      return a.id.localeCompare(b.id);
    });
    return rows.slice(0, limit);
  }

  /**
   * Project the underlying `Graph.summarize` text but with handler-
   * friendly defaults — used directly by `summarize_codebase`'s
   * graph-backed path.
   */
  summarize(maxTokens = 2_000, scope?: string): string {
    return this.graph.summarize({
      maxTokens,
      ...(scope ? { scope } : {}),
    });
  }
}
