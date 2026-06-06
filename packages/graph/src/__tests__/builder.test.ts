/**
 * Tests for {@link InMemoryGraphBuilder} — the Phase 2b builder that
 * validates input and constructs a {@link GraphologyGraph}.
 *
 * Validation surfaces as {@link BuildDiagnostics.parseErrors}; the
 * builder never throws on bad input — that's the Phase 1 contract.
 */

import { describe, it, expect } from 'vitest';
import { InMemoryGraphBuilder } from '../builder.js';
import {
  type Cluster,
  type Edge,
  type Node,
  clusterId,
  edgeId,
  nodeId,
} from '../index.js';

describe('InMemoryGraphBuilder · valid inputs', () => {
  it('builds a graph from a minimal valid input', () => {
    const builder = new InMemoryGraphBuilder();
    const a = nodeId('n:a');
    const b = nodeId('n:b');
    const result = builder.build({
      nodes: [
        { id: a, kind: 'file', label: 'a.ts', path: 'a.ts', metadata: {} },
        { id: b, kind: 'file', label: 'b.ts', path: 'b.ts', metadata: {} },
      ],
      edges: [{ id: edgeId('e:1'), source: a, target: b, kind: 'imports' }],
    });
    expect(result.graph.nodeCount).toBe(2);
    expect(result.graph.edgeCount).toBe(1);
    expect(result.diagnostics.parseErrors).toEqual([]);
    expect(result.diagnostics.filesScanned).toBe(2);
    expect(result.diagnostics.filesParsed).toBe(2);
    expect(result.diagnostics.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('attaches an optional cluster overlay when supplied', () => {
    const builder = new InMemoryGraphBuilder();
    const a = nodeId('n:a');
    const b = nodeId('n:b');
    const c = clusterId('c:x');
    const cluster: Cluster = { id: c, label: 'x/', members: [a, b] };
    const result = builder.build({
      nodes: [
        { id: a, kind: 'file', label: 'a', path: 'a', metadata: {} },
        { id: b, kind: 'file', label: 'b', path: 'b', metadata: {} },
      ],
      edges: [],
      clusters: [cluster],
    });
    expect(result.graph.clusterCount).toBe(1);
    expect(result.graph.clusterOf(a)).toBe(c);
  });

  it('omits cluster overlay → clusterCount stays zero', () => {
    const builder = new InMemoryGraphBuilder();
    const result = builder.build({
      nodes: [{ id: nodeId('n:a'), kind: 'file', label: 'a', path: 'a', metadata: {} }],
      edges: [],
    });
    expect(result.graph.clusterCount).toBe(0);
  });
});

describe('InMemoryGraphBuilder · empty input', () => {
  it('produces an empty graph with no diagnostics', () => {
    const builder = new InMemoryGraphBuilder();
    const result = builder.build({ nodes: [], edges: [] });
    expect(result.graph.nodeCount).toBe(0);
    expect(result.graph.edgeCount).toBe(0);
    expect(result.graph.clusterCount).toBe(0);
    expect(result.diagnostics.parseErrors).toEqual([]);
  });
});

describe('InMemoryGraphBuilder · invalid inputs surface as diagnostics', () => {
  it('reports duplicate NodeIds (does not throw)', () => {
    const builder = new InMemoryGraphBuilder();
    const a = nodeId('n:dup');
    const nodes: Node[] = [
      { id: a, kind: 'file', label: 'first', path: 'a', metadata: {} },
      { id: a, kind: 'file', label: 'second', path: 'a2', metadata: {} },
    ];
    const result = builder.build({ nodes, edges: [] });
    expect(result.graph.nodeCount).toBe(1);
    expect(result.graph.node(a)?.label).toBe('first'); // first wins
    expect(result.diagnostics.parseErrors).toHaveLength(1);
    expect(result.diagnostics.parseErrors[0]?.reason).toMatch(/duplicate NodeId/);
  });

  it('drops edges referencing unknown source/target', () => {
    const builder = new InMemoryGraphBuilder();
    const a = nodeId('n:a');
    const ghost = nodeId('n:ghost');
    const edges: Edge[] = [
      { id: edgeId('e:bad-source'), source: ghost, target: a, kind: 'imports' },
      { id: edgeId('e:bad-target'), source: a, target: ghost, kind: 'imports' },
    ];
    const result = builder.build({
      nodes: [{ id: a, kind: 'file', label: 'a', path: 'a', metadata: {} }],
      edges,
    });
    expect(result.graph.edgeCount).toBe(0);
    expect(result.diagnostics.parseErrors).toHaveLength(2);
    expect(result.diagnostics.parseErrors[0]?.reason).toMatch(/unknown source/);
    expect(result.diagnostics.parseErrors[1]?.reason).toMatch(/unknown target/);
  });

  it('drops duplicate EdgeIds', () => {
    const builder = new InMemoryGraphBuilder();
    const a = nodeId('n:a');
    const b = nodeId('n:b');
    const dup = edgeId('e:dup');
    const result = builder.build({
      nodes: [
        { id: a, kind: 'file', label: 'a', path: 'a', metadata: {} },
        { id: b, kind: 'file', label: 'b', path: 'b', metadata: {} },
      ],
      edges: [
        { id: dup, source: a, target: b, kind: 'imports' },
        { id: dup, source: a, target: b, kind: 'references' },
      ],
    });
    expect(result.graph.edgeCount).toBe(1);
    expect(result.graph.edge(dup)?.kind).toBe('imports'); // first wins
    expect(result.diagnostics.parseErrors).toHaveLength(1);
    expect(result.diagnostics.parseErrors[0]?.reason).toMatch(/duplicate EdgeId/);
  });

  it('drops cluster members pointing to unknown nodes; keeps the rest', () => {
    const builder = new InMemoryGraphBuilder();
    const a = nodeId('n:a');
    const ghost = nodeId('n:ghost');
    const c = clusterId('c:mixed');
    const result = builder.build({
      nodes: [{ id: a, kind: 'file', label: 'a', path: 'a', metadata: {} }],
      edges: [],
      clusters: [{ id: c, label: 'mixed/', members: [a, ghost] }],
    });
    expect(result.graph.clusterCount).toBe(1);
    expect(result.graph.cluster(c)?.members).toEqual([a]);
    expect(result.diagnostics.parseErrors).toHaveLength(1);
    expect(result.diagnostics.parseErrors[0]?.reason).toMatch(/unknown member/);
  });

  it('drops a cluster that ends up with zero valid members', () => {
    const builder = new InMemoryGraphBuilder();
    const ghost1 = nodeId('n:ghost1');
    const ghost2 = nodeId('n:ghost2');
    const c = clusterId('c:empty');
    const result = builder.build({
      nodes: [],
      edges: [],
      clusters: [{ id: c, label: 'empty/', members: [ghost1, ghost2] }],
    });
    expect(result.graph.clusterCount).toBe(0);
    // Two "unknown member" diagnostics + one "cluster dropped" diagnostic.
    expect(result.diagnostics.parseErrors.length).toBeGreaterThanOrEqual(3);
    expect(
      result.diagnostics.parseErrors.some((p) => /cluster dropped/.test(p.reason)),
    ).toBe(true);
  });

  it('reports duplicate ClusterIds (first wins)', () => {
    const builder = new InMemoryGraphBuilder();
    const a = nodeId('n:a');
    const c = clusterId('c:dup');
    const result = builder.build({
      nodes: [{ id: a, kind: 'file', label: 'a', path: 'a', metadata: {} }],
      edges: [],
      clusters: [
        { id: c, label: 'first/', members: [a] },
        { id: c, label: 'second/', members: [a] },
      ],
    });
    expect(result.graph.clusterCount).toBe(1);
    expect(result.graph.cluster(c)?.label).toBe('first/');
    expect(
      result.diagnostics.parseErrors.some((p) => /duplicate ClusterId/.test(p.reason)),
    ).toBe(true);
  });

  it('reports a node assigned to multiple clusters (second assignment ignored)', () => {
    const builder = new InMemoryGraphBuilder();
    const a = nodeId('n:a');
    const b = nodeId('n:b');
    const c1 = clusterId('c:1');
    const c2 = clusterId('c:2');
    const result = builder.build({
      nodes: [
        { id: a, kind: 'file', label: 'a', path: 'a', metadata: {} },
        { id: b, kind: 'file', label: 'b', path: 'b', metadata: {} },
      ],
      edges: [],
      clusters: [
        { id: c1, label: 'one/', members: [a] },
        { id: c2, label: 'two/', members: [a, b] },
      ],
    });
    // Node `a` stays in c:1; node `b` joins c:2.
    expect(result.graph.clusterOf(a)).toBe(c1);
    expect(result.graph.clusterOf(b)).toBe(c2);
    expect(
      result.diagnostics.parseErrors.some((p) => /already assigned/.test(p.reason)),
    ).toBe(true);
  });
});

describe('InMemoryGraphBuilder · determinism', () => {
  it('identical inputs produce graphs whose summaries match byte-for-byte', () => {
    const builder = new InMemoryGraphBuilder();
    const a = nodeId('n:a');
    const b = nodeId('n:b');
    const c = nodeId('n:c');
    const input = {
      nodes: [
        { id: c, kind: 'file', label: 'c', path: 'c', metadata: {} },
        { id: a, kind: 'file', label: 'a', path: 'a', metadata: {} },
        { id: b, kind: 'file', label: 'b', path: 'b', metadata: {} },
      ] satisfies Node[],
      edges: [
        { id: edgeId('e:2'), source: b, target: c, kind: 'imports' },
        { id: edgeId('e:1'), source: a, target: b, kind: 'imports' },
      ] satisfies Edge[],
    };
    const s1 = builder.build(input).graph.summarize();
    const s2 = builder.build(input).graph.summarize();
    expect(s1).toBe(s2);
  });

  it('input order does not affect summary output (sort happens in builder)', () => {
    const builder = new InMemoryGraphBuilder();
    const a = nodeId('n:a');
    const b = nodeId('n:b');
    const nodes: Node[] = [
      { id: a, kind: 'file', label: 'a', path: 'a', metadata: {} },
      { id: b, kind: 'file', label: 'b', path: 'b', metadata: {} },
    ];
    const edges: Edge[] = [{ id: edgeId('e:1'), source: a, target: b, kind: 'imports' }];

    const forward = builder.build({ nodes, edges }).graph.summarize();
    const reversed = builder
      .build({ nodes: [...nodes].reverse(), edges })
      .graph.summarize();
    expect(forward).toBe(reversed);
  });
});
