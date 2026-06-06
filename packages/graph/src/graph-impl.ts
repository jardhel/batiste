/**
 * @batiste-aidk/graph · graph-impl
 *
 * Phase 2b implementation of {@link Graph} backed by `graphology`.
 *
 * Design notes:
 *
 *   - We use `MultiDirectedGraph` so two file→file edges with different
 *     kinds (e.g. `imports` + `references`) can coexist without the
 *     library merging them. Edge IDs from {@link types.EdgeId} are used
 *     verbatim as graphology keys via `addDirectedEdgeWithKey`.
 *
 *   - The full `Node` and `Edge` objects are stored as the graphology
 *     attribute payload under a single `data` key. Branded IDs survive
 *     the round-trip because they are plain strings at runtime.
 *
 *   - Cluster info is **read-only** in Phase 2b: the builder accepts
 *     pre-computed `Cluster[]` and pre-built membership; Phase 2c will
 *     add the algorithm that produces these. {@link clusterOf} returns
 *     `null` when no cluster overlay was supplied.
 *
 *   - All accessors return `null` (never throw) for unknown IDs, per
 *     the Phase 1 contract in `types.ts`.
 *
 *   - Determinism: the builder is responsible for deterministic
 *     insertion order; this class never mutates after construction.
 *     `summarize()` walks data in a stable order so its output is
 *     byte-stable across runs of identical input.
 */

import { MultiDirectedGraph } from 'graphology';
import type {
  Cluster,
  ClusterId,
  Edge,
  EdgeId,
  FindSymbolOptions,
  Graph,
  Node,
  NodeId,
  QueryOptions,
  SummarizeOptions,
} from './types.js';
import { edgeId as toEdgeId, nodeId as toNodeId } from './types.js';

/** Per-node attribute payload. Stored under the `data` key in graphology. */
interface NodeAttrs {
  readonly data: Node;
}

/** Per-edge attribute payload. Stored under the `data` key in graphology. */
interface EdgeAttrs {
  readonly data: Edge;
}

/** Default neighbour-query limit when {@link QueryOptions.limit} is omitted. */
const DEFAULT_NEIGHBOR_LIMIT = 100;

/**
 * Default `summarize` cap when {@link SummarizeOptions.maxTokens} is
 * omitted. Picked to comfortably fit a model context envelope without
 * trimming the top-cluster / top-hub blocks for typical mid-sized repos.
 */
const DEFAULT_SUMMARIZE_MAX_TOKENS = 1_024;

/**
 * Internal construction payload. Pre-validated, stably-ordered. The
 * builder constructs this; consumers never see it.
 */
export interface GraphImplData {
  /** Sorted by `id` ascending for deterministic insertion. */
  readonly nodes: readonly Node[];
  /** Sorted by `id` ascending for deterministic insertion. */
  readonly edges: readonly Edge[];
  /** Sorted by `id` ascending for deterministic insertion. */
  readonly clusters: readonly Cluster[];
  /** Membership map; only populated for clustered nodes. */
  readonly membership: ReadonlyMap<NodeId, ClusterId>;
}

/** Concrete {@link Graph} implementation backed by `graphology`. */
export class GraphologyGraph implements Graph {
  private readonly g: MultiDirectedGraph<NodeAttrs, EdgeAttrs>;
  private readonly clustersById: ReadonlyMap<ClusterId, Cluster>;
  private readonly membership: ReadonlyMap<NodeId, ClusterId>;
  /** Sorted node IDs for deterministic iteration in `summarize`. */
  private readonly sortedNodeIds: readonly string[];

  constructor(data: GraphImplData) {
    this.g = new MultiDirectedGraph<NodeAttrs, EdgeAttrs>();

    // Inputs are pre-sorted by the builder; we still copy defensively
    // so external mutation cannot leak into our store.
    for (const node of data.nodes) {
      this.g.addNode(node.id, { data: node });
    }
    for (const edge of data.edges) {
      this.g.addDirectedEdgeWithKey(edge.id, edge.source, edge.target, { data: edge });
    }

    const clusters = new Map<ClusterId, Cluster>();
    for (const c of data.clusters) {
      clusters.set(c.id, c);
    }
    this.clustersById = clusters;
    this.membership = new Map(data.membership);
    this.sortedNodeIds = data.nodes.map((n) => n.id as string);
  }

  // ---------------------------------------------------------------------------
  // Counts
  // ---------------------------------------------------------------------------

  get nodeCount(): number {
    return this.g.order;
  }

  get edgeCount(): number {
    return this.g.size;
  }

  get clusterCount(): number {
    return this.clustersById.size;
  }

  // ---------------------------------------------------------------------------
  // Direct lookups
  // ---------------------------------------------------------------------------

  node(id: NodeId): Node | null {
    if (!this.g.hasNode(id)) return null;
    return this.g.getNodeAttribute(id, 'data');
  }

  edge(id: EdgeId): Edge | null {
    if (!this.g.hasEdge(id)) return null;
    return this.g.getEdgeAttribute(id, 'data');
  }

  cluster(id: ClusterId): Cluster | null {
    return this.clustersById.get(id) ?? null;
  }

  clusterOf(nodeId: NodeId): ClusterId | null {
    return this.membership.get(nodeId) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  findSymbol(name: string, opts?: FindSymbolOptions): readonly Node[] {
    const allowedKinds = opts?.kinds ?? (['symbol'] as const);
    const language = opts?.language;
    const out: Node[] = [];

    // Walk in deterministic sorted order so callers see stable results.
    for (const id of this.sortedNodeIds) {
      const n = this.g.getNodeAttribute(id, 'data');
      if (n.label !== name) continue;
      if (!allowedKinds.includes(n.kind)) continue;
      if (language !== undefined && n.language !== language) continue;
      out.push(n);
    }
    return out;
  }

  findByPath(path: string): Node | null {
    for (const id of this.sortedNodeIds) {
      const n = this.g.getNodeAttribute(id, 'data');
      if (n.kind === 'file' && n.path === path) return n;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Neighbourhood traversal
  // ---------------------------------------------------------------------------

  neighbors(seed: NodeId, opts?: QueryOptions): readonly Node[] {
    if (!this.g.hasNode(seed)) return [];

    const hops = Math.max(0, opts?.hops ?? 1);
    const limit = opts?.limit ?? DEFAULT_NEIGHBOR_LIMIT;
    const allowedKinds = opts?.kinds;
    const sameClusterOnly = opts?.sameCluster === true;
    const seedCluster = sameClusterOnly ? this.membership.get(seed) ?? null : null;

    if (hops === 0) return [];

    // BFS, treating the multi-directed graph as undirected (a neighbour
    // is anything sharing an edge with the current frontier). Visited
    // tracks every node we've seen so we don't re-emit; we explicitly
    // skip the seed in the output.
    const visited = new Set<string>([seed]);
    let frontier: string[] = [seed];
    const out: Node[] = [];

    for (let hop = 0; hop < hops; hop++) {
      const next: string[] = [];
      // Iterate frontier in stable sorted order so result order is deterministic.
      const orderedFrontier = [...frontier].sort();
      for (const current of orderedFrontier) {
        // graphology's `neighbors()` returns the union of in/out neighbours.
        const adj = this.g.neighbors(current).slice().sort();
        for (const candidateId of adj) {
          if (visited.has(candidateId)) continue;
          visited.add(candidateId);
          next.push(candidateId);

          const candidate = this.g.getNodeAttribute(candidateId, 'data');
          if (allowedKinds && !allowedKinds.includes(candidate.kind)) continue;
          if (sameClusterOnly) {
            const candCluster = this.membership.get(toNodeId(candidateId)) ?? null;
            if (candCluster !== seedCluster) continue;
          }
          out.push(candidate);
          if (out.length >= limit) return out;
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }

    return out;
  }

  // ---------------------------------------------------------------------------
  // Summarisation
  // ---------------------------------------------------------------------------

  summarize(opts?: SummarizeOptions): string {
    const maxTokens = opts?.maxTokens ?? DEFAULT_SUMMARIZE_MAX_TOKENS;
    const charBudget = Math.max(64, maxTokens * 4);
    const scope = opts?.scope;

    // Top-5 clusters by member count. Tie-break by cluster id ascending
    // so the output is deterministic given identical input.
    const clusterRanking = [...this.clustersById.values()]
      .slice()
      .sort((a, b) => {
        if (b.members.length !== a.members.length) return b.members.length - a.members.length;
        return (a.id as string).localeCompare(b.id as string);
      })
      .slice(0, 5);

    // Top-3 hubs by total degree. Tie-break by node id ascending.
    const hubRanking = [...this.sortedNodeIds]
      .map((id) => ({ id, degree: this.g.degree(id) }))
      .sort((a, b) => {
        if (b.degree !== a.degree) return b.degree - a.degree;
        return a.id.localeCompare(b.id);
      })
      .slice(0, 3);

    const lines: string[] = [];
    lines.push(
      `graph: ${String(this.nodeCount)} nodes, ${String(this.edgeCount)} edges, ${String(this.clusterCount)} clusters`,
    );
    if (scope !== undefined) {
      lines.push(`scope: ${scope}`);
    }

    if (clusterRanking.length > 0) {
      lines.push('top clusters:');
      for (const c of clusterRanking) {
        lines.push(`  - ${c.label} (${String(c.members.length)} members)`);
      }
    }

    if (hubRanking.length > 0) {
      lines.push('top hubs:');
      for (const h of hubRanking) {
        const node = this.g.getNodeAttribute(h.id, 'data');
        lines.push(`  - ${node.label} [${node.kind}] (degree ${String(h.degree)})`);
      }
    }

    // Greedy character-budget trim — drop trailing lines until we fit.
    // We never trim the headline, even if maxTokens is absurdly small.
    let text = lines.join('\n');
    while (text.length > charBudget && lines.length > 1) {
      lines.pop();
      text = lines.join('\n');
    }
    return text;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers (test-only friends)
  // ---------------------------------------------------------------------------

  /**
   * Internal escape hatch for tests / Phase 2c: lists every edge ID in
   * insertion order. Not part of the {@link Graph} contract.
   */
  edgeIds(): readonly EdgeId[] {
    return this.g.edges().map((id) => toEdgeId(id));
  }

  /**
   * Phase 2c hook — iterate every NodeId in deterministic sorted order.
   * Not part of the {@link Graph} contract; provided so the clusterer
   * (and other internal consumers that need to enumerate vertices)
   * does not have to reach into the graphology backend.
   */
  *nodes(): IterableIterator<NodeId> {
    for (const id of this.sortedNodeIds) {
      yield toNodeId(id);
    }
  }

  /**
   * Phase 2c hook — iterate every edge as a `{source, target}` pair in
   * deterministic edge-ID-sorted order. Not part of the {@link Graph}
   * contract; provided for the clusterer's edge-counting passes.
   */
  *edges(): IterableIterator<{ source: NodeId; target: NodeId; kind: Edge['kind'] }> {
    // Sort edge IDs so iteration order matches the builder's input ordering.
    const sortedEdgeIds = [...this.g.edges()].sort();
    for (const eid of sortedEdgeIds) {
      const data = this.g.getEdgeAttribute(eid, 'data');
      yield { source: data.source, target: data.target, kind: data.kind };
    }
  }
}
