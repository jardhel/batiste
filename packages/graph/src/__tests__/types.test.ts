import { describe, it, expect } from 'vitest';
import {
  type Cluster,
  type ClusterId,
  type Edge,
  type EdgeId,
  type Graph,
  type GraphBuilder,
  type GraphInput,
  type Indexer,
  type Node,
  type NodeId,
  type Querier,
  type QueryOptions,
  VERSION,
  clusterId,
  edgeId,
  nodeId,
} from '../index.js';

// ---------------------------------------------------------------------------
// Compile-time assertions
//
// These helpers fail at `tsc` time if the public surface drifts.
// They never execute meaningful runtime work; they exist so that a
// breaking change to a type triggers `pnpm typecheck` red, not a
// downstream package's red weeks later.
// ---------------------------------------------------------------------------

/** No-op generic that only typechecks if `T` is assignable to `Expected`. */
function assertAssignable<Expected>(): <T extends Expected>(value: T) => T {
  return (value) => value;
}

/** Force `T` and `U` to be mutually assignable (structurally equal). */
type Equals<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false;
function assertExact<T, U>(_proof: Equals<T, U>): void {
  /* compile-time only */
}

// Branded-ID identity: branded types must remain assignable to string,
// but a raw string must NOT be assignable to a branded type without the
// constructor helper.
const _brandFlow = (): NodeId => {
  const raw = 'symbol-foo';
  // @ts-expect-error — raw strings cannot satisfy the brand
  const _bad: NodeId = raw;
  return nodeId(raw);
};

// NodeKind / EdgeKind locked to the documented unions.
assertExact<Node['kind'], 'file' | 'symbol' | 'doc' | 'fact' | 'concept'>(true);
assertExact<Edge['kind'], 'imports' | 'calls' | 'references' | 'contains' | 'links-to' | 'derived-from'>(true);

// Graph surface: every accessor consumers depend on must be present.
type GraphAccessors = Pick<
  Graph,
  | 'nodeCount'
  | 'edgeCount'
  | 'clusterCount'
  | 'node'
  | 'edge'
  | 'cluster'
  | 'clusterOf'
  | 'findSymbol'
  | 'findByPath'
  | 'neighbors'
  | 'summarize'
>;
assertAssignable<GraphAccessors>();

// Querier (audit / code consumers) must be a subset of Graph.
type _QuerierFitsGraph = Querier extends {
  findByPath(path: string): NodeId | null;
  neighbors(id: NodeId, opts?: { hops?: number; sameCluster?: boolean }): readonly Node[];
  edge(id: EdgeId): Edge | null;
  cluster(id: ClusterId): Cluster | null;
}
  ? true
  : false;
const _querierProof: _QuerierFitsGraph = true;
void _querierProof;

// QueryOptions must accept the documented defaults.
const _queryOpts: QueryOptions = { hops: 2, sameCluster: true, kinds: ['symbol'], limit: 10 };
void _queryOpts;

// ---------------------------------------------------------------------------
// Runtime smoke check
//
// Construct a stub `Graph` literal that satisfies the interface and
// confirm that consumer-style lookups behave.
// ---------------------------------------------------------------------------

function buildStubGraph(): Graph {
  const fileId = nodeId('file:src/auth.ts');
  const symId = nodeId('symbol:src/auth.ts:Login');
  const cls = clusterId('cluster:auth');
  const eId = edgeId('edge:0');

  const fileNode: Node = {
    id: fileId,
    kind: 'file',
    label: 'auth.ts',
    path: 'src/auth.ts',
    metadata: {},
  };
  const symbolNode: Node = {
    id: symId,
    kind: 'symbol',
    label: 'Login',
    path: 'src/auth.ts',
    language: 'typescript',
    metadata: { 'tree-sitter:kind': 'function_declaration' },
  };
  const containsEdge: Edge = {
    id: eId,
    source: fileId,
    target: symId,
    kind: 'contains',
  };
  const cluster: Cluster = {
    id: cls,
    label: 'auth/',
    members: [fileId, symId],
    cohesion: 0.82,
  };

  const nodes = new Map<NodeId, Node>([
    [fileId, fileNode],
    [symId, symbolNode],
  ]);
  const edges = new Map<EdgeId, Edge>([[eId, containsEdge]]);
  const clusters = new Map<ClusterId, Cluster>([[cls, cluster]]);
  const membership = new Map<NodeId, ClusterId>([
    [fileId, cls],
    [symId, cls],
  ]);

  return {
    nodeCount: nodes.size,
    edgeCount: edges.size,
    clusterCount: clusters.size,
    node: (id) => nodes.get(id) ?? null,
    edge: (id) => edges.get(id) ?? null,
    cluster: (id) => clusters.get(id) ?? null,
    clusterOf: (id) => membership.get(id) ?? null,
    findSymbol: (name, opts) => {
      const out: Node[] = [];
      for (const n of nodes.values()) {
        if (n.label !== name) continue;
        if (opts?.kinds && !opts.kinds.includes(n.kind)) continue;
        if (opts?.language && n.language !== opts.language) continue;
        out.push(n);
      }
      return out;
    },
    findByPath: (path) => {
      for (const n of nodes.values()) {
        if (n.kind === 'file' && n.path === path) return n;
      }
      return null;
    },
    neighbors: (id, opts) => {
      const seedCluster = membership.get(id) ?? null;
      const out: Node[] = [];
      for (const e of edges.values()) {
        if (e.source !== id && e.target !== id) continue;
        const otherId = e.source === id ? e.target : e.source;
        const other = nodes.get(otherId);
        if (!other) continue;
        if (opts?.kinds && !opts.kinds.includes(other.kind)) continue;
        if (opts?.sameCluster && membership.get(otherId) !== seedCluster) continue;
        out.push(other);
      }
      return opts?.limit ? out.slice(0, opts.limit) : out;
    },
    summarize: (opts) =>
      `stub-graph: ${String(nodes.size)} nodes, ${String(edges.size)} edges, ${String(clusters.size)} clusters` +
      (opts?.scope ? ` (scope=${opts.scope})` : ''),
  };
}

describe('@batiste-aidk/graph public surface', () => {
  it('exposes a stable VERSION string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('a stub Graph satisfies the contract — node() round-trips', () => {
    const g = buildStubGraph();
    const fileNode = g.node(nodeId('file:src/auth.ts'));
    expect(fileNode).not.toBeNull();
    expect(fileNode?.kind).toBe('file');
    expect(fileNode?.path).toBe('src/auth.ts');
  });

  it('findSymbol() returns matches filtered by language', () => {
    const g = buildStubGraph();
    const hits = g.findSymbol('Login', { language: 'typescript' });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.kind).toBe('symbol');

    const wrongLang = g.findSymbol('Login', { language: 'python' });
    expect(wrongLang).toHaveLength(0);
  });

  it('findByPath() resolves files and not symbols', () => {
    const g = buildStubGraph();
    expect(g.findByPath('src/auth.ts')?.kind).toBe('file');
    expect(g.findByPath('src/missing.ts')).toBeNull();
  });

  it('clusterOf() and cluster() expose stable cluster IDs', () => {
    const g = buildStubGraph();
    const cId = g.clusterOf(nodeId('symbol:src/auth.ts:Login'));
    expect(cId).not.toBeNull();
    const c = cId ? g.cluster(cId) : null;
    expect(c?.label).toBe('auth/');
    expect(c?.members).toHaveLength(2);
  });

  it('neighbors() honours sameCluster and kinds filters', () => {
    const g = buildStubGraph();
    const neigh = g.neighbors(nodeId('file:src/auth.ts'), { sameCluster: true, kinds: ['symbol'] });
    expect(neigh).toHaveLength(1);
    expect(neigh[0]?.label).toBe('Login');
  });

  it('summarize() reflects the scope option', () => {
    const g = buildStubGraph();
    expect(g.summarize()).toContain('2 nodes');
    expect(g.summarize({ scope: 'src/auth' })).toContain('scope=src/auth');
  });

  it('GraphBuilder / Indexer contract types are constructable as stubs', () => {
    const builder: GraphBuilder = {
      build: (input: GraphInput) => ({
        graph: buildStubGraph(),
        diagnostics: { elapsedMs: 0, filesScanned: input.nodes.length, filesParsed: 0, parseErrors: [] },
      }),
    };
    const indexer: Indexer = {
      index: () =>
        Promise.resolve({
          graph: buildStubGraph(),
          diagnostics: { elapsedMs: 0, filesScanned: 0, filesParsed: 0, parseErrors: [] },
        }),
    };
    expect(builder.build({ nodes: [], edges: [] }).graph.nodeCount).toBe(2);
    return indexer.index({ paths: ['src/'] }).then((r) => {
      expect(r.graph.nodeCount).toBe(2);
    });
  });
});
