/**
 * Tests for {@link GraphologyGraph} — the Phase 2b implementation of
 * the {@link Graph} interface.
 *
 * Coverage targets every method of the public {@link Graph} surface
 * (`node`, `edge`, `cluster`, `clusterOf`, `findSymbol`, `findByPath`,
 * `neighbors`, `summarize`) plus the count getters and edge cases:
 * empty graph, single-node graph, lookups against unknown IDs, and
 * deterministic `summarize()` output across repeated builds.
 */

import { describe, it, expect } from 'vitest';
import {
  type Cluster,
  type Edge,
  type Node,
  clusterId,
  edgeId,
  nodeId,
} from '../index.js';
import { InMemoryGraphBuilder, type ExtendedGraphInput } from '../builder.js';
import { GraphologyGraph } from '../graph-impl.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/**
 * Build a representative 10-node / 15-edge / 2-cluster fixture.
 *
 * Layout:
 *   Cluster `auth/` — file:auth.ts + 4 symbols (Login, Logout, Session, Token)
 *   Cluster `billing/` — file:billing.ts + 3 symbols (Charge, Refund, Invoice)
 *   Unclustered: a doc node and a fact node (provenance edges across clusters)
 */
function buildFixtureInput(): ExtendedGraphInput {
  const fAuth = nodeId('file:src/auth.ts');
  const fBilling = nodeId('file:src/billing.ts');
  const sLogin = nodeId('sym:src/auth.ts:Login');
  const sLogout = nodeId('sym:src/auth.ts:Logout');
  const sSession = nodeId('sym:src/auth.ts:Session');
  const sToken = nodeId('sym:src/auth.ts:Token');
  const sCharge = nodeId('sym:src/billing.ts:Charge');
  const sRefund = nodeId('sym:src/billing.ts:Refund');
  const dDoc = nodeId('doc:docs/auth.md');
  const fFact = nodeId('fact:adr-0001');

  const nodes: Node[] = [
    { id: fAuth, kind: 'file', label: 'auth.ts', path: 'src/auth.ts', metadata: {} },
    { id: fBilling, kind: 'file', label: 'billing.ts', path: 'src/billing.ts', metadata: {} },
    {
      id: sLogin,
      kind: 'symbol',
      label: 'Login',
      path: 'src/auth.ts',
      language: 'typescript',
      metadata: {},
    },
    {
      id: sLogout,
      kind: 'symbol',
      label: 'Logout',
      path: 'src/auth.ts',
      language: 'typescript',
      metadata: {},
    },
    {
      id: sSession,
      kind: 'symbol',
      label: 'Session',
      path: 'src/auth.ts',
      language: 'typescript',
      metadata: {},
    },
    {
      id: sToken,
      kind: 'symbol',
      label: 'Token',
      path: 'src/auth.ts',
      language: 'typescript',
      metadata: {},
    },
    {
      id: sCharge,
      kind: 'symbol',
      label: 'Charge',
      path: 'src/billing.ts',
      language: 'typescript',
      metadata: {},
    },
    {
      id: sRefund,
      kind: 'symbol',
      label: 'Refund',
      path: 'src/billing.ts',
      language: 'python', // intentional cross-language to exercise the language filter
      metadata: {},
    },
    { id: dDoc, kind: 'doc', label: 'auth-overview', path: 'docs/auth.md', metadata: {} },
    { id: fFact, kind: 'fact', label: 'ADR-0001', metadata: {} },
  ];

  const edges: Edge[] = [
    { id: edgeId('e:contains:auth-login'), source: fAuth, target: sLogin, kind: 'contains' },
    { id: edgeId('e:contains:auth-logout'), source: fAuth, target: sLogout, kind: 'contains' },
    { id: edgeId('e:contains:auth-session'), source: fAuth, target: sSession, kind: 'contains' },
    { id: edgeId('e:contains:auth-token'), source: fAuth, target: sToken, kind: 'contains' },
    { id: edgeId('e:contains:billing-charge'), source: fBilling, target: sCharge, kind: 'contains' },
    { id: edgeId('e:contains:billing-refund'), source: fBilling, target: sRefund, kind: 'contains' },
    { id: edgeId('e:calls:login-session'), source: sLogin, target: sSession, kind: 'calls' },
    { id: edgeId('e:calls:logout-session'), source: sLogout, target: sSession, kind: 'calls' },
    { id: edgeId('e:references:session-token'), source: sSession, target: sToken, kind: 'references' },
    { id: edgeId('e:imports:billing-auth'), source: fBilling, target: fAuth, kind: 'imports' },
    // Two parallel edges between the same file pair — exercises MultiGraph mode.
    { id: edgeId('e:references:billing-auth'), source: fBilling, target: fAuth, kind: 'references' },
    { id: edgeId('e:calls:charge-login'), source: sCharge, target: sLogin, kind: 'calls' },
    { id: edgeId('e:links-to:doc-fact'), source: dDoc, target: fFact, kind: 'links-to' },
    { id: edgeId('e:derived-from:doc-auth'), source: dDoc, target: fAuth, kind: 'derived-from' },
    { id: edgeId('e:derived-from:fact-billing'), source: fFact, target: fBilling, kind: 'derived-from' },
  ];

  const clusters: Cluster[] = [
    {
      id: clusterId('c:auth'),
      label: 'auth/',
      members: [fAuth, sLogin, sLogout, sSession, sToken],
      cohesion: 0.91,
    },
    {
      id: clusterId('c:billing'),
      label: 'billing/',
      members: [fBilling, sCharge, sRefund],
      cohesion: 0.78,
    },
  ];

  return { nodes, edges, clusters };
}

function buildFixture(): GraphologyGraph {
  const builder = new InMemoryGraphBuilder();
  const result = builder.build(buildFixtureInput());
  return result.graph as GraphologyGraph;
}

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

describe('GraphologyGraph · counts', () => {
  it('reports correct nodeCount, edgeCount, clusterCount on the fixture', () => {
    const g = buildFixture();
    expect(g.nodeCount).toBe(10);
    expect(g.edgeCount).toBe(15);
    expect(g.clusterCount).toBe(2);
  });

  it('an empty graph reports zero counts', () => {
    const builder = new InMemoryGraphBuilder();
    const { graph } = builder.build({ nodes: [], edges: [] });
    expect(graph.nodeCount).toBe(0);
    expect(graph.edgeCount).toBe(0);
    expect(graph.clusterCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Direct lookups
// ---------------------------------------------------------------------------

describe('GraphologyGraph · node()', () => {
  it('returns the stored node when the ID exists', () => {
    const g = buildFixture();
    const n = g.node(nodeId('sym:src/auth.ts:Login'));
    expect(n).not.toBeNull();
    expect(n?.label).toBe('Login');
    expect(n?.kind).toBe('symbol');
    expect(n?.language).toBe('typescript');
  });

  it('returns null for unknown IDs (does not throw)', () => {
    const g = buildFixture();
    expect(g.node(nodeId('sym:does-not-exist'))).toBeNull();
  });
});

describe('GraphologyGraph · edge()', () => {
  it('returns the stored edge when the ID exists', () => {
    const g = buildFixture();
    const e = g.edge(edgeId('e:calls:login-session'));
    expect(e).not.toBeNull();
    expect(e?.kind).toBe('calls');
    expect(e?.source).toBe('sym:src/auth.ts:Login');
    expect(e?.target).toBe('sym:src/auth.ts:Session');
  });

  it('returns null for unknown edge IDs', () => {
    const g = buildFixture();
    expect(g.edge(edgeId('e:nope'))).toBeNull();
  });

  it('preserves both parallel edges between the same node pair', () => {
    const g = buildFixture();
    const imp = g.edge(edgeId('e:imports:billing-auth'));
    const ref = g.edge(edgeId('e:references:billing-auth'));
    expect(imp?.kind).toBe('imports');
    expect(ref?.kind).toBe('references');
  });
});

describe('GraphologyGraph · cluster() / clusterOf()', () => {
  it('cluster() resolves cluster metadata', () => {
    const g = buildFixture();
    const c = g.cluster(clusterId('c:auth'));
    expect(c?.label).toBe('auth/');
    expect(c?.members).toHaveLength(5);
    expect(c?.cohesion).toBe(0.91);
  });

  it('cluster() returns null for unknown cluster IDs', () => {
    const g = buildFixture();
    expect(g.cluster(clusterId('c:ghost'))).toBeNull();
  });

  it('clusterOf() returns the assignment for clustered nodes', () => {
    const g = buildFixture();
    expect(g.clusterOf(nodeId('sym:src/auth.ts:Login'))).toBe('c:auth');
    expect(g.clusterOf(nodeId('sym:src/billing.ts:Charge'))).toBe('c:billing');
  });

  it('clusterOf() returns null for unclustered nodes', () => {
    const g = buildFixture();
    expect(g.clusterOf(nodeId('doc:docs/auth.md'))).toBeNull();
    expect(g.clusterOf(nodeId('fact:adr-0001'))).toBeNull();
  });

  it('clusterOf() returns null for unknown node IDs', () => {
    const g = buildFixture();
    expect(g.clusterOf(nodeId('sym:ghost'))).toBeNull();
  });

  it('a graph built without clusters returns null for everything', () => {
    const builder = new InMemoryGraphBuilder();
    const { graph } = builder.build({
      nodes: [{ id: nodeId('n:1'), kind: 'file', label: 'a', path: 'a', metadata: {} }],
      edges: [],
    });
    expect(graph.clusterCount).toBe(0);
    expect(graph.clusterOf(nodeId('n:1'))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

describe('GraphologyGraph · findSymbol()', () => {
  it('exact-match by name; defaults to kind=symbol', () => {
    const g = buildFixture();
    const hits = g.findSymbol('Login');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.kind).toBe('symbol');
    expect(hits[0]?.label).toBe('Login');
  });

  it('is case-sensitive', () => {
    const g = buildFixture();
    expect(g.findSymbol('login')).toHaveLength(0);
    expect(g.findSymbol('LOGIN')).toHaveLength(0);
  });

  it('honours the language filter', () => {
    const g = buildFixture();
    expect(g.findSymbol('Refund', { language: 'typescript' })).toHaveLength(0);
    const py = g.findSymbol('Refund', { language: 'python' });
    expect(py).toHaveLength(1);
    expect(py[0]?.language).toBe('python');
  });

  it('honours the kinds filter (broaden to docs)', () => {
    const g = buildFixture();
    const docs = g.findSymbol('auth-overview', { kinds: ['doc'] });
    expect(docs).toHaveLength(1);
    expect(docs[0]?.kind).toBe('doc');
  });

  it('returns [] when no match', () => {
    const g = buildFixture();
    expect(g.findSymbol('Nonexistent')).toEqual([]);
  });
});

describe('GraphologyGraph · findByPath()', () => {
  it('resolves the file node for an exact path match', () => {
    const g = buildFixture();
    const f = g.findByPath('src/auth.ts');
    expect(f?.kind).toBe('file');
    expect(f?.label).toBe('auth.ts');
  });

  it('does not return symbol nodes that share a path', () => {
    const g = buildFixture();
    const f = g.findByPath('src/auth.ts');
    expect(f?.kind).toBe('file');
    // Symbols on the same path exist but should not be returned.
  });

  it('returns null for unknown paths', () => {
    const g = buildFixture();
    expect(g.findByPath('src/missing.ts')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Neighbours
// ---------------------------------------------------------------------------

describe('GraphologyGraph · neighbors()', () => {
  it('default 1-hop returns directly adjacent nodes', () => {
    const g = buildFixture();
    const neigh = g.neighbors(nodeId('file:src/auth.ts'));
    // file:auth.ts is connected to its 4 symbols (contains), to file:billing.ts
    // (imports + references — but the *node* dedupes), to doc (derived-from)
    // and to fact via fact->billing (no, that's 2 hops). Direct-only:
    //   - sym:Login, sym:Logout, sym:Session, sym:Token  (contains)
    //   - file:billing.ts                                  (imports + references)
    //   - doc:docs/auth.md                                 (derived-from)
    // Total = 6
    expect(neigh).toHaveLength(6);
  });

  it('hops=2 expands the frontier deterministically', () => {
    const g = buildFixture();
    const neigh = g.neighbors(nodeId('sym:src/auth.ts:Login'), { hops: 2 });
    // Login's 1-hop: file:auth.ts, sym:Session (calls), sym:Charge (incoming call)
    // 2-hop adds: siblings via auth.ts (Logout, Token), Token via Session->Token,
    //             billing.ts via Charge<-billing.ts containment, and the
    //             auth.ts-linked doc/file edges.
    expect(neigh.length).toBeGreaterThan(3);
    // Confirm one specific 2-hop hit.
    const labels = neigh.map((n) => n.label);
    expect(labels).toContain('Token');
  });

  it('honours the kinds filter (only symbols)', () => {
    const g = buildFixture();
    const neigh = g.neighbors(nodeId('file:src/auth.ts'), { kinds: ['symbol'] });
    expect(neigh.every((n) => n.kind === 'symbol')).toBe(true);
    expect(neigh).toHaveLength(4);
  });

  it('honours sameCluster — restricts to seed cluster', () => {
    const g = buildFixture();
    const neigh = g.neighbors(nodeId('file:src/auth.ts'), { sameCluster: true });
    // Only auth-cluster members should remain (4 symbols); billing.ts and doc fall out.
    expect(neigh).toHaveLength(4);
    expect(neigh.every((n) => n.kind === 'symbol' && n.path === 'src/auth.ts')).toBe(true);
  });

  it('honours limit', () => {
    const g = buildFixture();
    const neigh = g.neighbors(nodeId('file:src/auth.ts'), { limit: 2 });
    expect(neigh).toHaveLength(2);
  });

  it('returns [] for unknown seed nodes', () => {
    const g = buildFixture();
    expect(g.neighbors(nodeId('sym:ghost'))).toEqual([]);
  });

  it('returns [] when hops=0', () => {
    const g = buildFixture();
    expect(g.neighbors(nodeId('file:src/auth.ts'), { hops: 0 })).toEqual([]);
  });

  it('handles an isolated single-node graph', () => {
    const builder = new InMemoryGraphBuilder();
    const only = nodeId('only');
    const { graph } = builder.build({
      nodes: [{ id: only, kind: 'file', label: 'a', path: 'a', metadata: {} }],
      edges: [],
    });
    expect(graph.neighbors(only)).toEqual([]);
    expect(graph.neighbors(only, { hops: 5 })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Summarisation
// ---------------------------------------------------------------------------

describe('GraphologyGraph · summarize()', () => {
  it('produces a multi-line text summary', () => {
    const g = buildFixture();
    const text = g.summarize();
    expect(text).toContain('10 nodes');
    expect(text).toContain('15 edges');
    expect(text).toContain('2 clusters');
    expect(text).toContain('top clusters:');
    expect(text).toContain('top hubs:');
  });

  it('surfaces top clusters by member count', () => {
    const g = buildFixture();
    const text = g.summarize();
    // auth/ has 5 members; billing/ has 3 — auth/ should appear first.
    const authIdx = text.indexOf('auth/');
    const billingIdx = text.indexOf('billing/');
    expect(authIdx).toBeGreaterThan(-1);
    expect(billingIdx).toBeGreaterThan(-1);
    expect(authIdx).toBeLessThan(billingIdx);
  });

  it('honours the scope option', () => {
    const g = buildFixture();
    expect(g.summarize({ scope: 'src/auth' })).toContain('scope: src/auth');
  });

  it('respects maxTokens (char budget = tokens * 4)', () => {
    const g = buildFixture();
    const tiny = g.summarize({ maxTokens: 16 }); // ~64 char budget
    // Headline always survives; trailing detail blocks get trimmed.
    expect(tiny).toContain('graph:');
    expect(tiny.length).toBeLessThanOrEqual(g.summarize().length);
  });

  it('is byte-stable across repeated builds (determinism contract)', () => {
    const builder = new InMemoryGraphBuilder();
    const input = buildFixtureInput();
    const a = builder.build(input).graph.summarize();
    const b = builder.build(input).graph.summarize();
    expect(a).toBe(b);
  });

  it('produces a sensible summary for the empty graph', () => {
    const builder = new InMemoryGraphBuilder();
    const { graph } = builder.build({ nodes: [], edges: [] });
    const text = graph.summarize();
    expect(text).toContain('0 nodes');
    expect(text).toContain('0 edges');
    expect(text).toContain('0 clusters');
  });
});
