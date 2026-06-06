/**
 * @batiste-aidk/graph · clusterer tests
 *
 * Phase 2c correctness tests for {@link CommunityDetectionClusterer}.
 * These tests do **not** depend on Phase 2b's `GraphologyGraphBuilder` —
 * they construct minimal stub `Graph` instances directly so the suite
 * can run before (or alongside) the parallel 2b ship.
 */

import { describe, it, expect } from 'vitest';

import { CommunityDetectionClusterer } from '../clusterer.js';
import {
  type Cluster,
  type ClusterId,
  type Edge,
  type EdgeId,
  type Graph,
  type Node,
  type NodeId,
  edgeId as toEdgeId,
  nodeId as toNodeId,
} from '../index.js';

// ---------------------------------------------------------------------------
// Minimal stub Graph used by every test in this file.
//
// We expose `nodes()` and `edges()` iterators (members of the host
// implementation Phase 2b ships) so the clusterer can enumerate the
// graph without depending on graphology directly.
// ---------------------------------------------------------------------------

interface StubGraph extends Graph {
  nodes(): IterableIterator<NodeId>;
  edges(): IterableIterator<{ source: NodeId; target: NodeId }>;
}

function buildStubGraph(nodes: readonly Node[], edges: readonly Edge[]): StubGraph {
  const nodeMap = new Map<NodeId, Node>(nodes.map((n) => [n.id, n]));
  const edgeMap = new Map<EdgeId, Edge>(edges.map((e) => [e.id, e]));

  return {
    nodeCount: nodeMap.size,
    edgeCount: edgeMap.size,
    clusterCount: 0,
    node: (id) => nodeMap.get(id) ?? null,
    edge: (id) => edgeMap.get(id) ?? null,
    cluster: (_id: ClusterId): Cluster | null => null,
    clusterOf: (_id) => null,
    findSymbol: (name, opts) => {
      const out: Node[] = [];
      for (const n of nodeMap.values()) {
        if (n.label !== name) continue;
        if (opts?.kinds && !opts.kinds.includes(n.kind)) continue;
        if (opts?.language && n.language !== opts.language) continue;
        out.push(n);
      }
      return out;
    },
    findByPath: (path) => {
      for (const n of nodeMap.values()) if (n.kind === 'file' && n.path === path) return n;
      return null;
    },
    neighbors: (id) => {
      const out: Node[] = [];
      for (const e of edgeMap.values()) {
        if (e.source !== id && e.target !== id) continue;
        const otherId = e.source === id ? e.target : e.source;
        const other = nodeMap.get(otherId);
        if (other) out.push(other);
      }
      return out;
    },
    summarize: () => `stub: ${String(nodeMap.size)} nodes, ${String(edgeMap.size)} edges`,
    *nodes() {
      for (const n of nodeMap.values()) yield n.id;
    },
    *edges() {
      for (const e of edgeMap.values()) yield { source: e.source, target: e.target };
    },
  };
}

// Convenience constructors --------------------------------------------------

function fileNode(path: string): Node {
  return {
    id: toNodeId(`file:${path}`),
    kind: 'file',
    label: path.split('/').pop() ?? path,
    path,
    metadata: {},
  };
}

function plainNode(id: string): Node {
  return {
    id: toNodeId(id),
    kind: 'concept',
    label: id,
    metadata: {},
  };
}

function makeEdge(src: NodeId, tgt: NodeId, idx: number): Edge {
  return { id: toEdgeId(`e:${String(idx)}:${src}->${tgt}`), source: src, target: tgt, kind: 'references' };
}

/** Build a complete graph K_n on the supplied nodes, starting at edgeIndex. */
function clique(members: readonly Node[], edgeIndex: { value: number }): Edge[] {
  const out: Edge[] = [];
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      out.push(makeEdge(members[i]!.id, members[j]!.id, edgeIndex.value++));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommunityDetectionClusterer', () => {
  it('finds three obvious communities from three weakly-connected K_4 cliques', () => {
    const ei = { value: 0 };

    const a1 = fileNode('auth/a.ts');
    const a2 = fileNode('auth/b.ts');
    const a3 = fileNode('auth/c.ts');
    const a4 = fileNode('auth/d.ts');

    const b1 = fileNode('billing/a.ts');
    const b2 = fileNode('billing/b.ts');
    const b3 = fileNode('billing/c.ts');
    const b4 = fileNode('billing/d.ts');

    const c1 = fileNode('ui/a.ts');
    const c2 = fileNode('ui/b.ts');
    const c3 = fileNode('ui/c.ts');
    const c4 = fileNode('ui/d.ts');

    const groupA = [a1, a2, a3, a4];
    const groupB = [b1, b2, b3, b4];
    const groupC = [c1, c2, c3, c4];

    const edges: Edge[] = [
      ...clique(groupA, ei),
      ...clique(groupB, ei),
      ...clique(groupC, ei),
      // Single weak bridge edge between each pair of cliques.
      makeEdge(a1.id, b1.id, ei.value++),
      makeEdge(b1.id, c1.id, ei.value++),
      makeEdge(c1.id, a1.id, ei.value++),
    ];

    const graph = buildStubGraph([...groupA, ...groupB, ...groupC], edges);
    const clusterer = new CommunityDetectionClusterer();
    const overlay = clusterer.cluster({ graph, seed: 42 });

    expect(overlay.algorithm).toBe('louvain');
    expect(overlay.clusters.length).toBe(3);
    expect(overlay.modularityScore).toBeGreaterThan(0.4);

    // Every clique should land entirely in a single cluster.
    const clusterOfNode = (n: Node) => overlay.assignment.get(n.id);
    expect(new Set(groupA.map(clusterOfNode)).size).toBe(1);
    expect(new Set(groupB.map(clusterOfNode)).size).toBe(1);
    expect(new Set(groupC.map(clusterOfNode)).size).toBe(1);

    // The three clique-clusters should be distinct from each other.
    expect(new Set([clusterOfNode(a1), clusterOfNode(b1), clusterOfNode(c1)]).size).toBe(3);

    // Cohesion: each cluster has 6 intra-edges (K_4) and 2 inter-edges
    // (each leader node participates in 2 of the 3 bridge edges).
    // 6 / (6 + 2) = 0.75. Tolerance for label drift.
    for (const c of overlay.clusters) {
      expect(c.cohesion).toBeGreaterThan(0.6);
      expect(c.cohesion).toBeLessThanOrEqual(1);
    }

    // Labels should reflect the directory prefix.
    const labels = overlay.clusters.map((c) => c.label).sort();
    expect(labels).toEqual(['auth/', 'billing/', 'ui/']);
  });

  it('is deterministic — same seed produces identical cluster IDs and modularity', () => {
    const ei = { value: 0 };
    const groupA = [fileNode('a/1.ts'), fileNode('a/2.ts'), fileNode('a/3.ts'), fileNode('a/4.ts')];
    const groupB = [fileNode('b/1.ts'), fileNode('b/2.ts'), fileNode('b/3.ts'), fileNode('b/4.ts')];
    const edges: Edge[] = [
      ...clique(groupA, ei),
      ...clique(groupB, ei),
      makeEdge(groupA[0]!.id, groupB[0]!.id, ei.value++),
    ];
    const graph = buildStubGraph([...groupA, ...groupB], edges);

    const clusterer = new CommunityDetectionClusterer();
    const r1 = clusterer.cluster({ graph, seed: 99 });
    const r2 = clusterer.cluster({ graph, seed: 99 });

    const ids1 = r1.clusters.map((c) => c.id).sort();
    const ids2 = r2.clusters.map((c) => c.id).sort();
    expect(ids1).toEqual(ids2);
    expect(r1.modularityScore).toBe(r2.modularityScore);
    expect(r1.clusters.length).toBe(r2.clusters.length);
  });

  it('returns an empty overlay for an empty graph (no throw)', () => {
    const graph = buildStubGraph([], []);
    const overlay = new CommunityDetectionClusterer().cluster({ graph });
    expect(overlay.clusters).toHaveLength(0);
    expect(overlay.assignment.size).toBe(0);
    expect(overlay.modularityScore).toBe(0);
  });

  it('returns one cluster containing the single node when given a singleton graph', () => {
    const n = fileNode('lonely/file.ts');
    const graph = buildStubGraph([n], []);
    const overlay = new CommunityDetectionClusterer().cluster({ graph });
    expect(overlay.clusters).toHaveLength(1);
    expect(overlay.clusters[0]!.members).toEqual([n.id]);
    expect(overlay.assignment.get(n.id)).toBe(overlay.clusters[0]!.id);
  });

  it('targetSize=5 on a 30-node graph yields ~6 clusters (within ±2)', () => {
    // Six 5-node cliques with one inter-clique bridge each.
    const ei = { value: 0 };
    const groups: Node[][] = [];
    const allNodes: Node[] = [];
    for (let g = 0; g < 6; g++) {
      const grp: Node[] = [];
      for (let i = 0; i < 5; i++) {
        const n = plainNode(`g${String(g)}-n${String(i)}`);
        grp.push(n);
        allNodes.push(n);
      }
      groups.push(grp);
    }
    const edges: Edge[] = [];
    for (const grp of groups) edges.push(...clique(grp, ei));
    for (let g = 0; g < groups.length; g++) {
      const next = groups[(g + 1) % groups.length]!;
      edges.push(makeEdge(groups[g]![0]!.id, next[0]!.id, ei.value++));
    }
    const graph = buildStubGraph(allNodes, edges);

    const overlay = new CommunityDetectionClusterer().cluster({ graph, targetSize: 5, seed: 7 });
    expect(overlay.clusters.length).toBeGreaterThanOrEqual(4);
    expect(overlay.clusters.length).toBeLessThanOrEqual(8);

    // Modularity should still be respectable even after target-size tuning.
    expect(overlay.modularityScore).toBeGreaterThan(0.3);
  });

  it('records the leiden→louvain fallback in the overlay algorithm tag', () => {
    const n = fileNode('only/file.ts');
    const graph = buildStubGraph([n], []);
    const overlay = new CommunityDetectionClusterer().cluster({
      graph,
      // The contract type has no `algorithm` field; the rich impl accepts it.
      ...({ algorithm: 'leiden' } as { algorithm: 'leiden' }),
    });
    expect(overlay.algorithm).toBe('louvain-leiden-fallback');
  });

  it('uses the most-common metadata.topic when members are docs/facts and paths are absent', () => {
    const d1: Node = {
      id: toNodeId('doc:1'),
      kind: 'doc',
      label: 'Decision 1',
      metadata: { topic: 'governance' },
    };
    const d2: Node = {
      id: toNodeId('doc:2'),
      kind: 'doc',
      label: 'Decision 2',
      metadata: { topic: 'governance' },
    };
    const d3: Node = {
      id: toNodeId('fact:3'),
      kind: 'fact',
      label: 'Fact 3',
      metadata: { topic: 'pricing' },
    };
    const ei = { value: 0 };
    const edges = clique([d1, d2, d3], ei);
    const graph = buildStubGraph([d1, d2, d3], edges);

    const overlay = new CommunityDetectionClusterer().cluster({ graph, seed: 1 });
    // Single cluster expected on this tiny clique; label should be the
    // dominant topic.
    expect(overlay.clusters.length).toBe(1);
    expect(overlay.clusters[0]!.label).toBe('governance');
  });
});
