import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  InMemoryGraphBuilder,
  type Cluster,
  type Edge,
  type Node,
  clusterId,
  edgeId,
  nodeId,
} from '@batiste-aidk/graph';
import { SemanticAnnotator } from '../semantic-annotator.js';
import type { AuditEntry } from '../types.js';

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    sessionId: 'sess',
    agentId: 'agent',
    tool: 'find_symbol',
    args: {},
    result: 'success',
    durationMs: 1,
    ...overrides,
  };
}

function buildAuthGraph() {
  const login = nodeId('file:src/auth/login.ts');
  const session = nodeId('file:src/auth/session.ts');
  const billing = nodeId('file:src/billing/invoice.ts');
  const sessionTokenSym = nodeId('symbol:src/auth/session.ts:SessionToken');

  const nodes: Node[] = [
    { id: login, kind: 'file', label: 'login.ts', path: 'src/auth/login.ts', metadata: {} },
    { id: session, kind: 'file', label: 'session.ts', path: 'src/auth/session.ts', metadata: {} },
    { id: billing, kind: 'file', label: 'invoice.ts', path: 'src/billing/invoice.ts', metadata: {} },
    {
      id: sessionTokenSym,
      kind: 'symbol',
      label: 'SessionToken',
      path: 'src/auth/session.ts',
      language: 'typescript',
      metadata: {},
    },
  ];
  const edges: Edge[] = [
    { id: edgeId('e:login-session'), source: login, target: session, kind: 'imports' },
    { id: edgeId('e:session-symbol'), source: session, target: sessionTokenSym, kind: 'contains' },
  ];
  const cAuth = clusterId('cluster:auth');
  const cBill = clusterId('cluster:billing');
  const clusters: Cluster[] = [
    { id: cAuth, label: 'auth/', members: [login, session, sessionTokenSym] },
    { id: cBill, label: 'billing/', members: [billing] },
  ];
  return new InMemoryGraphBuilder().build({ nodes, edges, clusters }).graph;
}

describe('SemanticAnnotator · path-anchored', () => {
  it('annotates an entry whose args carry a known file path', () => {
    const graph = buildAuthGraph();
    const ann = new SemanticAnnotator();
    const entry = makeEntry({ tool: 'validate_code', args: { path: 'src/auth/login.ts' } });
    const out = ann.annotate(entry, graph);
    expect(out.id).toBe(entry.id);
    expect(out.semantic.cluster?.label).toBe('auth/');
    expect(out.semantic.kind).toBe('file');
    expect(out.semantic.neighbors).toContain('session.ts');
  });

  it('returns a `note` annotation when the path is unknown', () => {
    const graph = buildAuthGraph();
    const ann = new SemanticAnnotator();
    const out = ann.annotate(
      makeEntry({ args: { path: 'src/somewhere/else.ts' } }),
      graph,
    );
    expect(out.semantic.note).toMatch(/not present in graph/);
    expect(out.semantic.cluster).toBeUndefined();
  });
});

describe('SemanticAnnotator · symbol-anchored', () => {
  it('annotates a find_symbol entry with cluster + neighbours of the first hit', () => {
    const graph = buildAuthGraph();
    const ann = new SemanticAnnotator();
    const out = ann.annotate(
      makeEntry({ tool: 'find_symbol', args: { symbolName: 'SessionToken' } }),
      graph,
    );
    expect(out.semantic.cluster?.label).toBe('auth/');
    expect(out.semantic.kind).toBe('symbol');
    expect(out.semantic.neighbors).toContain('session.ts');
  });

  it('records ambiguity in `note` when multiple matches exist', () => {
    // Build a tiny graph with two symbols sharing the same label.
    const a = nodeId('symbol:a:Foo');
    const b = nodeId('symbol:b:Foo');
    const result = new InMemoryGraphBuilder().build({
      nodes: [
        { id: a, kind: 'symbol', label: 'Foo', path: 'a.ts', metadata: {} },
        { id: b, kind: 'symbol', label: 'Foo', path: 'b.ts', metadata: {} },
      ],
      edges: [],
    });
    const ann = new SemanticAnnotator();
    const out = ann.annotate(makeEntry({ args: { symbolName: 'Foo' } }), result.graph);
    expect(out.semantic.note).toMatch(/2 matches/);
  });
});

describe('SemanticAnnotator · degraded inputs', () => {
  it('returns a `no path or symbol` note when args are empty', () => {
    const graph = buildAuthGraph();
    const ann = new SemanticAnnotator();
    const out = ann.annotate(makeEntry({ args: {} }), graph);
    expect(out.semantic.note).toMatch(/no path or symbol/);
    // Original fields preserved verbatim.
    expect(out.tool).toBe('find_symbol');
  });

  it('annotateAll batches without losing entry order', () => {
    const graph = buildAuthGraph();
    const ann = new SemanticAnnotator();
    const entries = [
      makeEntry({ id: 'e1', args: { path: 'src/auth/login.ts' } }),
      makeEntry({ id: 'e2', args: { path: 'src/billing/invoice.ts' } }),
    ];
    const out = ann.annotateAll(entries, graph);
    expect(out.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(out[0]!.semantic.cluster?.label).toBe('auth/');
    expect(out[1]!.semantic.cluster?.label).toBe('billing/');
  });
});
