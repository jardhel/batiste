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
import { ClusterAclMatcher } from '../cluster-acl.js';
import type { AccessPolicy } from '../types.js';

const policy: AccessPolicy = {
  id: '00000000-0000-0000-0000-000000000010',
  name: 'cluster-acl-base',
  // Wide allow so the cluster overlay is the interesting variable in
  // most tests; deny is tested separately.
  allowedPaths: ['src/**'],
  deniedPaths: [],
  maxDepth: 10,
  includeTests: false,
};

/**
 * Build a tiny graph with two clusters:
 *   - 'auth/' containing src/auth/login.ts and src/auth/session.ts
 *   - 'billing/' containing src/billing/invoice.ts
 */
function buildTestGraph() {
  const a1 = nodeId('file:src/auth/login.ts');
  const a2 = nodeId('file:src/auth/session.ts');
  const b1 = nodeId('file:src/billing/invoice.ts');
  const cAuth = clusterId('cluster:auth');
  const cBill = clusterId('cluster:billing');

  const nodes: Node[] = [
    { id: a1, kind: 'file', label: 'login.ts', path: 'src/auth/login.ts', metadata: {} },
    { id: a2, kind: 'file', label: 'session.ts', path: 'src/auth/session.ts', metadata: {} },
    { id: b1, kind: 'file', label: 'invoice.ts', path: 'src/billing/invoice.ts', metadata: {} },
  ];
  const edges: Edge[] = [
    { id: edgeId('e:1'), source: a1, target: a2, kind: 'imports' },
  ];
  const clusters: Cluster[] = [
    { id: cAuth, label: 'auth/', members: [a1, a2] },
    { id: cBill, label: 'billing/', members: [b1] },
  ];
  const result = new InMemoryGraphBuilder().build({ nodes, edges, clusters });
  return result.graph;
}

describe('ClusterAclMatcher · graph absent (back-compat)', () => {
  it('falls back to FileMatcher behaviour when no graph is provided', () => {
    const m = new ClusterAclMatcher({ policy });
    expect(m.authorize('src/auth/login.ts', 'read').decision).toBe('allow');
    expect(m.authorize('lib/util.ts', 'read').decision).toBe('deny');
  });
});

describe('ClusterAclMatcher · graph present, rules absent', () => {
  it('allows base-allowed paths; resolves cluster but does not gate on it', () => {
    const graph = buildTestGraph();
    const m = new ClusterAclMatcher({ policy, graph });
    const decision = m.authorize('src/auth/login.ts', 'read');
    expect(decision.decision).toBe('allow');
    expect(decision.cluster?.label).toBe('auth/');
  });
});

describe('ClusterAclMatcher · cluster-level deny', () => {
  it('denies write on the auth/ cluster while allowing read', () => {
    const graph = buildTestGraph();
    const m = new ClusterAclMatcher({
      policy,
      graph,
      rules: [{ cluster: 'auth/**', allow: ['read'], deny: ['write'] }],
    });
    expect(m.authorize('src/auth/login.ts', 'read').decision).toBe('allow');
    const denied = m.authorize('src/auth/session.ts', 'write');
    expect(denied.decision).toBe('deny');
    expect(denied.reason).toMatch(/auth\//);
  });

  it('billing/ unaffected by an auth-only rule (cluster scoping works)', () => {
    const graph = buildTestGraph();
    const m = new ClusterAclMatcher({
      policy,
      graph,
      rules: [{ cluster: 'auth/**', deny: ['write'] }],
    });
    expect(m.authorize('src/billing/invoice.ts', 'write').decision).toBe('allow');
  });
});

describe('ClusterAclMatcher · base policy still wins on deny', () => {
  it('denies a path the base scope rejects, regardless of cluster rules', () => {
    const tightPolicy: AccessPolicy = {
      ...policy,
      id: '00000000-0000-0000-0000-000000000011',
      allowedPaths: ['src/auth/**'],
    };
    const graph = buildTestGraph();
    const m = new ClusterAclMatcher({
      policy: tightPolicy,
      graph,
      rules: [{ cluster: 'billing/**', allow: ['read', 'write'] }],
    });
    // Even though billing rule says allow, the base policy excludes
    // src/billing/** entirely.
    expect(m.authorize('src/billing/invoice.ts', 'read').decision).toBe('deny');
  });
});

describe('ClusterAclMatcher · helpers', () => {
  it('filter() returns only paths that authorise for the requested capability', () => {
    const graph = buildTestGraph();
    const m = new ClusterAclMatcher({
      policy,
      graph,
      rules: [{ cluster: 'auth/**', deny: ['write'] }],
    });
    const writable = m.filter(
      ['src/auth/login.ts', 'src/billing/invoice.ts'],
      'write',
    );
    expect(writable).toEqual(['src/billing/invoice.ts']);
  });

  it('resolveCluster returns null for paths not in the graph', () => {
    const graph = buildTestGraph();
    const m = new ClusterAclMatcher({ policy, graph });
    expect(m.resolveCluster('src/unknown/file.ts')).toBeNull();
  });
});
