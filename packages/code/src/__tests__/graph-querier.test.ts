/**
 * Tests for {@link GraphQuerier} — the Phase 3 adapter that the MCP
 * `find_symbol` and `summarize_codebase` tools use to consume a built
 * graph from `@batiste-aidk/graph`.
 *
 * The adapter is a thin shaper, so tests focus on the projection
 * shapes (cluster context attached to hits, deterministic cluster
 * summary order, scope passthrough) rather than re-testing graph
 * algorithms — those live in `packages/graph/src/__tests__`.
 */

import { describe, it, expect } from 'vitest';
import {
  InMemoryGraphBuilder,
  type Cluster,
  type Edge,
  type Node,
  clusterId,
  edgeId,
  nodeId,
} from '@batiste-aidk/graph';
import { GraphQuerier } from '../mcp/graph-querier.js';

function buildSampleGraph() {
  // Two clusters: auth/ (3 members) and billing/ (1 member). The auth
  // cluster has both file and symbol nodes so we can exercise
  // language/kind filtering and same-cluster filters.
  const loginFile = nodeId('file:src/auth/login.ts');
  const sessionFile = nodeId('file:src/auth/session.ts');
  const sessionTokenSym = nodeId('symbol:src/auth/session.ts:SessionToken');
  const invoiceFile = nodeId('file:src/billing/invoice.ts');
  const invoiceFnSym = nodeId('symbol:src/billing/invoice.ts:emitInvoice');

  const nodes: Node[] = [
    { id: loginFile, kind: 'file', label: 'login.ts', path: 'src/auth/login.ts', metadata: {} },
    { id: sessionFile, kind: 'file', label: 'session.ts', path: 'src/auth/session.ts', metadata: {} },
    {
      id: sessionTokenSym,
      kind: 'symbol',
      label: 'SessionToken',
      path: 'src/auth/session.ts',
      language: 'typescript',
      metadata: {},
    },
    { id: invoiceFile, kind: 'file', label: 'invoice.ts', path: 'src/billing/invoice.ts', metadata: {} },
    {
      id: invoiceFnSym,
      kind: 'symbol',
      label: 'emitInvoice',
      path: 'src/billing/invoice.ts',
      language: 'typescript',
      metadata: {},
    },
  ];
  const edges: Edge[] = [
    { id: edgeId('e:1'), source: loginFile, target: sessionFile, kind: 'imports' },
    { id: edgeId('e:2'), source: sessionFile, target: sessionTokenSym, kind: 'contains' },
    { id: edgeId('e:3'), source: invoiceFile, target: invoiceFnSym, kind: 'contains' },
  ];
  const cAuth = clusterId('cluster:auth');
  const cBill = clusterId('cluster:billing');
  const clusters: Cluster[] = [
    { id: cAuth, label: 'auth/', members: [loginFile, sessionFile, sessionTokenSym], cohesion: 0.66 },
    { id: cBill, label: 'billing/', members: [invoiceFile, invoiceFnSym], cohesion: 0.5 },
  ];
  return new InMemoryGraphBuilder().build({ nodes, edges, clusters }).graph;
}

describe('GraphQuerier · findSymbol', () => {
  it('returns hits with cluster context attached', () => {
    const q = new GraphQuerier(buildSampleGraph());
    const hits = q.findSymbol('SessionToken');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.node.label).toBe('SessionToken');
    expect(hits[0]!.cluster?.label).toBe('auth/');
  });

  it('respects FindSymbolOptions.language', () => {
    const q = new GraphQuerier(buildSampleGraph());
    const tsHits = q.findSymbol('SessionToken', { language: 'typescript' });
    const pyHits = q.findSymbol('SessionToken', { language: 'python' });
    expect(tsHits).toHaveLength(1);
    expect(pyHits).toHaveLength(0);
  });
});

describe('GraphQuerier · findSymbolInCluster', () => {
  it('filters hits to the given cluster label', () => {
    const q = new GraphQuerier(buildSampleGraph());
    const inAuth = q.findSymbolInCluster('SessionToken', 'auth/');
    const inBilling = q.findSymbolInCluster('SessionToken', 'billing/');
    expect(inAuth).toHaveLength(1);
    expect(inBilling).toHaveLength(0);
  });
});

describe('GraphQuerier · clusterSummary', () => {
  it('returns clusters sorted by member count desc', () => {
    const q = new GraphQuerier(buildSampleGraph());
    const rows = q.clusterSummary();
    expect(rows).toHaveLength(2);
    // auth/ has 3 members, billing/ has 2 → auth/ first
    expect(rows[0]!.label).toBe('auth/');
    expect(rows[0]!.memberCount).toBe(3);
    expect(rows[1]!.label).toBe('billing/');
    expect(rows[1]!.cohesion).toBe(0.5);
  });

  it('honours the limit parameter', () => {
    const q = new GraphQuerier(buildSampleGraph());
    expect(q.clusterSummary(1)).toHaveLength(1);
  });
});

describe('GraphQuerier · summarize', () => {
  it('passes through the wrapped graph summary text', () => {
    const q = new GraphQuerier(buildSampleGraph());
    const text = q.summarize(2_000);
    expect(text).toContain('graph:');
    expect(text).toContain('top clusters');
  });

  it('forwards the optional scope to the graph summary', () => {
    const q = new GraphQuerier(buildSampleGraph());
    const text = q.summarize(2_000, 'auth/');
    expect(text).toContain('scope: auth/');
  });
});
