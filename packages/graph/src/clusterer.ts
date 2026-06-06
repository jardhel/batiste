/**
 * @batiste-aidk/graph · clusterer
 *
 * Phase 2c — community-detection clustering for the code-and-knowledge
 * graph. Wraps `graphology-communities-louvain` (the modularity-based
 * Louvain algorithm) so callers receive a {@link ClusterOverlay} that
 * can be attached to a built {@link Graph} without mutating it.
 *
 * Algorithm choice
 * ----------------
 * Phase 2c ships **Louvain only**. Leiden (Traag et al. 2019) is on
 * the roadmap as Phase 2c.1. Although `@aflsolutions/graphology-
 * communities-leiden` exists, it is a recently published single-
 * maintainer package (1.0.0, ~April 2026). Until it has hardened — or
 * until we vendor a known-good implementation — Louvain is the safer
 * production default. Callers that pass `algorithm: 'leiden'` get
 * Louvain back with `overlay.algorithm === 'louvain-leiden-fallback'`
 * so consumers can detect the substitution without throwing.
 *
 * Determinism
 * -----------
 * `graphology-communities-louvain` accepts a `rng` callback and
 * `randomWalk: false` for deterministic local moves. Combined with our
 * deterministic cluster IDs (sha256 over sorted member-ID list), the
 * same `(graph, seed)` pair produces byte-identical overlays across
 * runs — a hard requirement for `@batiste-aidk/scope` cluster ACLs to
 * stay stable.
 *
 * Cluster IDs
 * -----------
 * Louvain returns an integer per node (community 0, 1, 2, ...). Those
 * indices are not stable across runs even with a fixed seed if node
 * insertion order shifts. We therefore derive cluster IDs from the
 * SHA-256 of the cluster's sorted member-ID list (truncated to 16
 * chars, prefixed `cluster:`). Two runs that produce the same
 * partition produce the same cluster IDs, regardless of internal
 * numbering.
 */

import { createHash } from 'node:crypto';

// graphology and graphology-communities-louvain are both CJS packages.
// Under Node's strict ESM loader, named imports from a CJS module fail
// with "Named export 'X' not found". We therefore import the default
// (the entire `module.exports`) and pull named members off of it. The
// .d.ts files are written as ESM, which gives TypeScript the wrong
// idea — but the runtime shape is what counts.
//
// We type the imports loosely; the boundary between this file and the
// graphology API is small enough that hand-typed shims are clearer
// than wrestling esModuleInterop edge cases.
import graphologyPkg from 'graphology';
import louvainPkg from 'graphology-communities-louvain';

interface UndirectedGraphLike {
  readonly size: number;
  addNode(id: string): void;
  hasNode(id: string): boolean;
  hasEdge(source: string, target: string): boolean;
  addEdge(source: string, target: string, attrs?: Record<string, unknown>): string;
  getEdgeAttribute(source: string, target: string, attr: string): unknown;
  setEdgeAttribute(source: string, target: string, attr: string, value: unknown): void;
}

interface UndirectedGraphCtor {
  new (options?: { multi?: boolean; allowSelfLoops?: boolean }): UndirectedGraphLike;
}

interface LouvainFn {
  (graph: UndirectedGraphLike, options?: Record<string, unknown>): Record<string, number>;
  detailed: (
    graph: UndirectedGraphLike,
    options?: Record<string, unknown>,
  ) => { communities: Record<string, number>; modularity: number; count: number };
}

const UndirectedGraph: UndirectedGraphCtor = (
  graphologyPkg as unknown as { UndirectedGraph: UndirectedGraphCtor }
).UndirectedGraph;
const louvain: LouvainFn = louvainPkg as unknown as LouvainFn;

import type { Clusterer, ClustererInput, ClusterOverlay } from './contracts.js';
import {
  type Cluster,
  type ClusterId,
  type Graph,
  type Node,
  type NodeId,
  clusterId as toClusterId,
} from './types.js';

// ---------------------------------------------------------------------------
// Public extension of the contract surface
// ---------------------------------------------------------------------------

/**
 * Richer overlay returned by {@link CommunityDetectionClusterer.cluster}.
 *
 * Adds two diagnostics on top of the Phase 1 {@link ClusterOverlay}
 * contract: which algorithm actually ran, and the Newman modularity Q
 * of the partition. Both are advisory — consumers that only care
 * about `clusters` / `assignment` can keep treating the result as a
 * plain `ClusterOverlay`.
 */
export interface RichClusterOverlay extends ClusterOverlay {
  /** Algorithm tag, e.g. `'louvain'` or `'louvain-leiden-fallback'`. */
  readonly algorithm: string;
  /** Newman's modularity Q in `[-0.5, 1]`. `0` for empty/single-node graphs. */
  readonly modularityScore: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const DEFAULT_RESOLUTION = 1.0;
const TARGET_SIZE_MAX_ITERATIONS = 6;
const TARGET_SIZE_TOLERANCE = 0.25; // ±25% of target size is good enough

/**
 * Production clusterer. Implements the Phase 1 {@link Clusterer}
 * contract using graphology + Louvain.
 *
 * Usage:
 * ```ts
 * const clusterer = new CommunityDetectionClusterer();
 * const overlay = clusterer.cluster({ graph, seed: 42 });
 * ```
 */
export class CommunityDetectionClusterer implements Clusterer {
  cluster(input: ClustererInput): RichClusterOverlay {
    const { graph } = input;
    const requestedAlgorithm = (input as ClustererInput & { algorithm?: string }).algorithm ?? 'louvain';
    const seed = input.seed ?? 0;

    const algorithmTag =
      requestedAlgorithm === 'leiden' ? 'louvain-leiden-fallback' : 'louvain';

    // Edge cases -----------------------------------------------------------
    if (graph.nodeCount === 0) {
      return Object.freeze({
        clusters: [],
        assignment: new Map<NodeId, ClusterId>(),
        algorithm: algorithmTag,
        modularityScore: 0,
      });
    }

    // Materialise the contract Graph into a graphology Graph. We snapshot
    // node IDs here once so determinism does not depend on the host
    // implementation's iteration order.
    const nodeIds = collectNodeIds(graph);

    if (nodeIds.length === 1) {
      const onlyId = nodeIds[0]!;
      const onlyNode = graph.node(onlyId);
      const cId = deriveClusterId([onlyId]);
      const cluster: Cluster = {
        id: cId,
        label: labelFor([onlyNode].filter(isPresent), cId),
        members: [onlyId],
        cohesion: 1,
      };
      const assignment = new Map<NodeId, ClusterId>([[onlyId, cId]]);
      return Object.freeze({
        clusters: [cluster],
        assignment,
        algorithm: algorithmTag,
        modularityScore: 0,
      });
    }

    // Run Louvain, optionally tuning resolution to hit a target avg size.
    const initialResolution = input.resolution ?? DEFAULT_RESOLUTION;
    const targetSize = input.targetSize;
    const { mapping, modularity, resolutionUsed } = runLouvainWithTargetSize({
      graph,
      nodeIds,
      seed,
      initialResolution,
      targetSize,
    });
    void resolutionUsed; // kept for future diagnostics — not exposed yet

    // Build clusters keyed by the Louvain community index, then derive
    // stable IDs from sorted member lists.
    const membersByCommunity = new Map<number, NodeId[]>();
    for (const nid of nodeIds) {
      const community = mapping[nid] ?? 0;
      let bucket = membersByCommunity.get(community);
      if (!bucket) {
        bucket = [];
        membersByCommunity.set(community, bucket);
      }
      bucket.push(nid);
    }

    const intraEdgeCounts = new Map<number, number>();
    const interEdgeCounts = new Map<number, number>();
    countEdges(graph, mapping, intraEdgeCounts, interEdgeCounts);

    const clusters: Cluster[] = [];
    const assignment = new Map<NodeId, ClusterId>();

    // Sort communities by their (deterministic) cluster ID so the
    // overlay's `clusters` array is itself deterministic — useful for
    // snapshot tests downstream.
    const ordered: Array<{ community: number; members: NodeId[]; cId: ClusterId }> = [];
    for (const [community, members] of membersByCommunity) {
      const sortedMembers = [...members].sort();
      ordered.push({ community, members: sortedMembers, cId: deriveClusterId(sortedMembers) });
    }
    ordered.sort((a, b) => (a.cId < b.cId ? -1 : a.cId > b.cId ? 1 : 0));

    for (const { community, members, cId } of ordered) {
      const intra = intraEdgeCounts.get(community) ?? 0;
      const inter = interEdgeCounts.get(community) ?? 0;
      const cohesion = intra + inter === 0 ? 0 : intra / (intra + inter);

      const memberNodes = members
        .map((nid) => graph.node(nid))
        .filter(isPresent);

      const cluster: Cluster = {
        id: cId,
        label: labelFor(memberNodes, cId),
        members,
        cohesion,
      };
      clusters.push(cluster);
      for (const m of members) assignment.set(m, cId);
    }

    return Object.freeze({
      clusters,
      assignment,
      algorithm: algorithmTag,
      modularityScore: modularity,
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers — graph materialisation
// ---------------------------------------------------------------------------

/**
 * Collect node IDs from the contract {@link Graph}. The interface does
 * not expose iteration directly, but it does expose `nodeCount` and
 * lookups; we therefore require implementations to also expose either
 * a `nodes()` iterator (preferred) or fall back to scanning their
 * stored membership map.
 *
 * In practice every Phase 2b builder will expose `nodes()`; this guard
 * keeps the clusterer functional against minimal stubs in tests.
 */
function collectNodeIds(graph: Graph): NodeId[] {
  // Prefer an iterator if the implementation exposes one.
  const maybeIterable = graph as unknown as {
    nodes?: () => Iterable<NodeId>;
    allNodeIds?: () => readonly NodeId[];
  };
  if (typeof maybeIterable.nodes === 'function') {
    return [...maybeIterable.nodes()];
  }
  if (typeof maybeIterable.allNodeIds === 'function') {
    return [...maybeIterable.allNodeIds()];
  }
  throw new Error(
    'CommunityDetectionClusterer: Graph implementation must expose a `nodes()` ' +
      'iterator or `allNodeIds()` method so the clusterer can enumerate vertices. ' +
      "(Phase 2b's GraphologyGraphBuilder does this; minimal stubs must add it.)",
  );
}

/**
 * Iterate every edge in the contract {@link Graph}. Mirrors
 * {@link collectNodeIds} — implementations expose `edges()` (preferred)
 * or `allEdges()`; tests using minimal stubs must provide one of the
 * two.
 */
function* iterateEdges(
  graph: Graph,
): Generator<{ source: NodeId; target: NodeId }, void, unknown> {
  const maybeIterable = graph as unknown as {
    edges?: () => Iterable<{ source: NodeId; target: NodeId }>;
    allEdges?: () => Iterable<{ source: NodeId; target: NodeId }>;
  };
  const it = maybeIterable.edges?.() ?? maybeIterable.allEdges?.();
  if (!it) {
    throw new Error(
      'CommunityDetectionClusterer: Graph implementation must expose an `edges()` ' +
        'iterator or `allEdges()` method so the clusterer can score cohesion. ' +
        "(Phase 2b's GraphologyGraphBuilder does this; minimal stubs must add it.)",
    );
  }
  for (const e of it) yield e;
}

/**
 * Build a deterministic graphology graph from our contract Graph.
 * We use an undirected multi-graph collapsed to simple weighted edges
 * — Louvain is defined on undirected graphs, and weight-summing
 * preserves call-multiplicity information from edges of the same
 * `(source, target)` pair.
 */
function toGraphology(graph: Graph, nodeIds: readonly NodeId[]): UndirectedGraphLike {
  const g = new UndirectedGraph({ multi: false, allowSelfLoops: false });
  for (const id of nodeIds) g.addNode(id);

  for (const e of iterateEdges(graph)) {
    if (e.source === e.target) continue; // skip self-loops; not meaningful for Louvain
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
    if (g.hasEdge(e.source, e.target)) {
      const cur = g.getEdgeAttribute(e.source, e.target, 'weight') as number | undefined;
      g.setEdgeAttribute(e.source, e.target, 'weight', (cur ?? 1) + 1);
    } else {
      g.addEdge(e.source, e.target, { weight: 1 });
    }
  }
  return g;
}

// ---------------------------------------------------------------------------
// Helpers — Louvain orchestration
// ---------------------------------------------------------------------------

/**
 * Mulberry32 — small, fast, well-distributed seeded PRNG. Used so that
 * Louvain's internal randomisation is reproducible without pulling in
 * a heavy RNG dep.
 */
function mulberry32(seed: number): () => number {
  let a = (seed | 0) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface LouvainRunResult {
  mapping: Record<string, number>;
  modularity: number;
  resolutionUsed: number;
}

/**
 * Runs Louvain once and, when `targetSize` is supplied, iterates the
 * resolution parameter to bring the average cluster size into a
 * tolerance band around the target. The search is a simple log-scale
 * binary tweak — Louvain's monotonic relationship between resolution
 * and cluster count makes a full bisection unnecessary.
 */
function runLouvainWithTargetSize(args: {
  graph: Graph;
  nodeIds: readonly NodeId[];
  seed: number;
  initialResolution: number;
  targetSize: number | undefined;
}): LouvainRunResult {
  const { graph, nodeIds, seed, initialResolution, targetSize } = args;
  const gGraph = toGraphology(graph, nodeIds);

  // No edges → every node is its own community. Louvain handles this
  // correctly but skipping the call avoids a NaN modularity payload
  // some library versions emit on empty edge sets.
  if (gGraph.size === 0) {
    const mapping: Record<string, number> = {};
    nodeIds.forEach((id, i) => {
      mapping[id] = i;
    });
    return { mapping, modularity: 0, resolutionUsed: initialResolution };
  }

  const runOnce = (resolution: number): LouvainRunResult => {
    const rng = mulberry32(seed);
    const detailed = louvain.detailed(gGraph, {
      resolution,
      randomWalk: false,
      fastLocalMoves: true,
      rng,
      getEdgeWeight: 'weight',
    });
    return {
      mapping: detailed.communities,
      modularity: Number.isFinite(detailed.modularity) ? detailed.modularity : 0,
      resolutionUsed: resolution,
    };
  };

  let result = runOnce(initialResolution);
  if (!targetSize || targetSize <= 0) return result;

  const totalNodes = nodeIds.length;
  const desiredClusterCount = Math.max(1, Math.round(totalNodes / targetSize));
  let resolution = initialResolution;

  for (let i = 0; i < TARGET_SIZE_MAX_ITERATIONS; i++) {
    const observedClusters = countCommunities(result.mapping);
    const observedAvg = totalNodes / Math.max(1, observedClusters);
    const ratio = observedAvg / targetSize;
    if (Math.abs(ratio - 1) <= TARGET_SIZE_TOLERANCE) break;

    // Higher resolution => more, smaller clusters. If our average
    // cluster size is too big, bump resolution; if too small, drop it.
    if (observedAvg > targetSize) {
      resolution *= 1.5;
    } else {
      resolution /= 1.5;
    }
    const next = runOnce(resolution);
    // Only accept if it moved us closer to the desired count.
    const nextDelta = Math.abs(countCommunities(next.mapping) - desiredClusterCount);
    const curDelta = Math.abs(countCommunities(result.mapping) - desiredClusterCount);
    if (nextDelta <= curDelta) result = next;
  }

  return result;
}

function countCommunities(mapping: Record<string, number>): number {
  const seen = new Set<number>();
  for (const v of Object.values(mapping)) seen.add(v);
  return seen.size;
}

// ---------------------------------------------------------------------------
// Helpers — cohesion + labelling + IDs
// ---------------------------------------------------------------------------

function countEdges(
  graph: Graph,
  mapping: Record<string, number>,
  intra: Map<number, number>,
  inter: Map<number, number>,
): void {
  const bump = (m: Map<number, number>, key: number) => {
    m.set(key, (m.get(key) ?? 0) + 1);
  };
  for (const e of iterateEdges(graph)) {
    if (e.source === e.target) continue;
    const a = mapping[e.source];
    const b = mapping[e.target];
    if (a === undefined || b === undefined) continue;
    if (a === b) {
      bump(intra, a);
    } else {
      // The originating-cluster contribution is symmetric — both endpoints'
      // clusters see this as an inter-cluster edge for cohesion purposes.
      bump(inter, a);
      bump(inter, b);
    }
  }
}

function deriveClusterId(sortedMembers: readonly NodeId[]): ClusterId {
  const hash = createHash('sha256').update(sortedMembers.join('|')).digest('hex').slice(0, 16);
  return toClusterId(`cluster:${hash}`);
}

function labelFor(memberNodes: readonly Node[], cId: ClusterId): string {
  if (memberNodes.length === 0) {
    return `cluster-${cId.slice(-6)}`;
  }

  // 1) Common directory prefix across file/symbol-kind nodes.
  const fileLikePaths = memberNodes
    .filter((n) => (n.kind === 'file' || n.kind === 'symbol') && typeof n.path === 'string')
    .map((n) => n.path as string);

  if (fileLikePaths.length === memberNodes.length && fileLikePaths.length > 0) {
    const prefix = commonDirectoryPrefix(fileLikePaths);
    if (prefix.length > 0) return prefix.endsWith('/') ? prefix : `${prefix}/`;
  }

  // 2) Doc/fact nodes → most-common metadata.topic.
  const topicCounts = new Map<string, number>();
  for (const n of memberNodes) {
    if (n.kind !== 'doc' && n.kind !== 'fact') continue;
    const topic = n.metadata['topic'];
    if (typeof topic === 'string' && topic.length > 0) {
      topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
    }
  }
  if (topicCounts.size > 0) {
    let bestTopic: string | undefined;
    let bestCount = -1;
    // Iterate in insertion order then break ties lexically for determinism.
    const sortedTopics = [...topicCounts.entries()].sort((a, b) =>
      b[1] - a[1] !== 0 ? b[1] - a[1] : a[0] < b[0] ? -1 : 1,
    );
    const head = sortedTopics[0];
    if (head) {
      bestTopic = head[0];
      bestCount = head[1];
    }
    if (bestTopic && bestCount > 0) return bestTopic;
  }

  return `cluster-${cId.slice(-6)}`;
}

function commonDirectoryPrefix(paths: readonly string[]): string {
  if (paths.length === 0) return '';
  const split = paths.map((p) => p.split('/'));
  const first = split[0]!;
  const prefix: string[] = [];
  for (let i = 0; i < first.length - 1; i++) {
    // -1 to skip the basename component
    const segment = first[i]!;
    if (split.every((parts) => parts[i] === segment)) {
      prefix.push(segment);
    } else {
      break;
    }
  }
  return prefix.join('/');
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
