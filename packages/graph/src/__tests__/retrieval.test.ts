/**
 * Tests for the Phase 2d source-weighted retrieval layer
 * (`retrieveWeighted`, `rankBySource`, `resolveSource`,
 * `weightForSource`).
 *
 * These exercise the empirical lever the house benchmark SPEC
 * (`2026-06-18-eki-chunking-benchmark-v1`) calls out: source-weighting
 * applied to graph-node ranking, deterministic and embedding-free.
 *
 * Fixture: a small vault-style graph with three sources tagged via
 * `gvs:source` metadata — `vault` (high-trust house knowledge),
 * `code` (repo symbols), and `external` (lower-trust scraped docs) —
 * plus one untagged node that must fall back to its NodeKind.
 */

import { describe, it, expect } from 'vitest';
import {
  type Edge,
  type Node,
  type ScoredNode,
  type SourceWeightConfig,
  SOURCE_METADATA_KEY,
  edgeId,
  nodeId,
} from '../index.js';
import { InMemoryGraphBuilder, type ExtendedGraphInput } from '../builder.js';
import {
  rankBySource,
  resolveSource,
  retrieveWeighted,
  weightForSource,
} from '../retrieval.js';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const seedDoc = nodeId('doc:vault/seed');
const vaultA = nodeId('doc:vault/a');
const codeA = nodeId('sym:src/a.ts:Alpha');
const externalA = nodeId('doc:external/a');
const externalB = nodeId('doc:external/b');
const untagged = nodeId('doc:untagged');

function src(value: string): Record<string, string> {
  return { [SOURCE_METADATA_KEY]: value };
}

/**
 * Topology (undirected for traversal):
 *   seedDoc(vault) ── vaultA(vault)
 *                 ── codeA(code)
 *                 ── externalA(external)
 *   externalA(external) ── externalB(external)   [hop 2 from seed]
 *   untagged (doc, no source tag) is isolated — only reachable as a seed.
 */
function buildFixtureInput(): ExtendedGraphInput {
  const nodes: Node[] = [
    { id: seedDoc, kind: 'doc', label: 'seed', metadata: src('vault') },
    { id: vaultA, kind: 'doc', label: 'vault-a', metadata: src('vault') },
    { id: codeA, kind: 'symbol', label: 'Alpha', language: 'typescript', metadata: src('code') },
    { id: externalA, kind: 'doc', label: 'ext-a', metadata: src('external') },
    { id: externalB, kind: 'doc', label: 'ext-b', metadata: src('external') },
    { id: untagged, kind: 'doc', label: 'untagged', metadata: {} },
  ];
  const edges: Edge[] = [
    { id: edgeId('e:seed-vaultA'), source: seedDoc, target: vaultA, kind: 'links-to' },
    { id: edgeId('e:seed-codeA'), source: seedDoc, target: codeA, kind: 'derived-from' },
    { id: edgeId('e:seed-extA'), source: seedDoc, target: externalA, kind: 'links-to' },
    { id: edgeId('e:extA-extB'), source: externalA, target: externalB, kind: 'links-to' },
  ];
  return { nodes, edges };
}

function buildGraph() {
  return new InMemoryGraphBuilder().build(buildFixtureInput()).graph;
}

const byId = (r: readonly ScoredNode[]) => r.map((s) => s.node.id as string);

// ---------------------------------------------------------------------------
// resolveSource
// ---------------------------------------------------------------------------

describe('resolveSource', () => {
  it('reads the gvs:source metadata key when present', () => {
    expect(resolveSource({ id: vaultA, kind: 'doc', label: 'x', metadata: src('vault') })).toBe(
      'vault',
    );
  });

  it('falls back to the node kind when no source tag is present', () => {
    expect(resolveSource({ id: untagged, kind: 'fact', label: 'x', metadata: {} })).toBe('fact');
  });

  it('coerces a non-string tag to string', () => {
    expect(
      resolveSource({ id: untagged, kind: 'doc', label: 'x', metadata: { [SOURCE_METADATA_KEY]: 7 } }),
    ).toBe('7');
  });
});

// ---------------------------------------------------------------------------
// weightForSource
// ---------------------------------------------------------------------------

describe('weightForSource', () => {
  const cfg: SourceWeightConfig = { weights: { vault: 3, external: 0.5 }, defaultWeight: 1 };

  it('returns the configured weight for a known source', () => {
    expect(weightForSource('vault', cfg)).toBe(3);
    expect(weightForSource('external', cfg)).toBe(0.5);
  });

  it('falls back to defaultWeight for an unknown source', () => {
    expect(weightForSource('code', cfg)).toBe(1);
  });

  it('defaults defaultWeight to 1 when omitted', () => {
    expect(weightForSource('anything', { weights: {} })).toBe(1);
  });

  it('clamps a negative or non-finite weight to 0', () => {
    expect(weightForSource('bad', { weights: { bad: -5 } })).toBe(0);
    expect(weightForSource('nan', { weights: { nan: Number.NaN } })).toBe(0);
  });

  it('honours an explicit zero weight', () => {
    expect(weightForSource('external', { weights: { external: 0 } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// retrieveWeighted — core behaviour
// ---------------------------------------------------------------------------

describe('retrieveWeighted · scoring & ranking', () => {
  it('source weight reorders nodes at equal proximity', () => {
    const g = buildGraph();
    // vaultA, codeA, externalA are all hop-1 from the seed → equal proximity.
    // Weighting vault > code > external must rank them in that order.
    const result = retrieveWeighted(g, {
      seeds: [seedDoc],
      maxHops: 1,
      includeSeeds: false,
      sources: { weights: { vault: 3, code: 2, external: 1 } },
    });
    expect(byId(result)).toEqual([vaultA as string, codeA as string, externalA as string]);
    // All hop-1 → proximity 0.5; score = 0.5 * weight.
    expect(result[0]).toMatchObject({ source: 'vault', hops: 1, proximity: 0.5, score: 1.5 });
  });

  it('proximity (hop decay) dominates across hops at equal source weight', () => {
    const g = buildGraph();
    // externalA (hop 1) vs externalB (hop 2), both source `external`.
    const result = retrieveWeighted(g, {
      seeds: [seedDoc],
      maxHops: 2,
      includeSeeds: false,
      kinds: ['doc'],
      sources: { weights: { external: 1, vault: 1 } },
      hopDecay: 0.5,
    });
    const a = result.find((s) => s.node.id === externalA)!;
    const b = result.find((s) => s.node.id === externalB)!;
    expect(a.hops).toBe(1);
    expect(b.hops).toBe(2);
    expect(a.score).toBeGreaterThan(b.score);
    expect(b.proximity).toBeCloseTo(0.25);
  });

  it('seed scores 1 * weight and is included by default', () => {
    const g = buildGraph();
    const result = retrieveWeighted(g, {
      seeds: [seedDoc],
      maxHops: 0,
      sources: { weights: { vault: 2 } },
    });
    expect(byId(result)).toEqual([seedDoc as string]);
    expect(result[0]).toMatchObject({ hops: 0, proximity: 1, score: 2 });
  });

  it('includeSeeds:false drops the seed from output', () => {
    const g = buildGraph();
    const result = retrieveWeighted(g, {
      seeds: [seedDoc],
      maxHops: 1,
      includeSeeds: false,
      sources: { weights: {} },
    });
    expect(byId(result)).not.toContain(seedDoc as string);
  });

  it('dropZeroWeight prunes zero-weighted sources (hard source filter)', () => {
    const g = buildGraph();
    const result = retrieveWeighted(g, {
      seeds: [seedDoc],
      maxHops: 2,
      includeSeeds: false,
      sources: { weights: { vault: 1, code: 1, external: 0 }, dropZeroWeight: true },
    });
    const ids = byId(result);
    expect(ids).not.toContain(externalA as string);
    expect(ids).not.toContain(externalB as string);
    expect(ids).toContain(vaultA as string);
    expect(ids).toContain(codeA as string);
  });

  it('without dropZeroWeight a zero-weighted node still appears at score 0', () => {
    const g = buildGraph();
    const result = retrieveWeighted(g, {
      seeds: [seedDoc],
      maxHops: 1,
      includeSeeds: false,
      sources: { weights: { vault: 1, code: 1, external: 0 } },
    });
    const ext = result.find((s) => s.node.id === externalA);
    expect(ext).toBeDefined();
    expect(ext!.score).toBe(0);
  });

  it('kinds filter restricts candidate node kinds', () => {
    const g = buildGraph();
    const result = retrieveWeighted(g, {
      seeds: [seedDoc],
      maxHops: 1,
      includeSeeds: false,
      kinds: ['symbol'],
      sources: { weights: {} },
    });
    expect(byId(result)).toEqual([codeA as string]);
  });

  it('untagged node falls back to NodeKind for its source weight', () => {
    const g = buildGraph();
    // `untagged` is isolated; reach it only as a seed. Its source is `doc`.
    const result = retrieveWeighted(g, {
      seeds: [untagged],
      maxHops: 0,
      sources: { weights: { doc: 4 } },
    });
    expect(result[0]).toMatchObject({ source: 'doc', sourceWeight: 4, score: 4 });
  });

  it('respects limit', () => {
    const g = buildGraph();
    const result = retrieveWeighted(g, {
      seeds: [seedDoc],
      maxHops: 2,
      sources: { weights: { vault: 5, code: 4, external: 3 } },
      limit: 2,
    });
    expect(result).toHaveLength(2);
    // Top 2 by score: seed (vault, prox 1 → 5) then vaultA (vault, prox .5 → 2.5).
    expect(byId(result)).toEqual([seedDoc as string, vaultA as string]);
  });

  it('multi-seed records the minimum hop distance to a node', () => {
    const g = buildGraph();
    // externalB is hop-2 from seedDoc but hop-1 from externalA. Seeding both
    // must record hop 1 (nearest seed wins).
    const result = retrieveWeighted(g, {
      seeds: [seedDoc, externalA],
      maxHops: 2,
      sources: { weights: { external: 1, vault: 1, code: 1 } },
    });
    const b = result.find((s) => s.node.id === externalB)!;
    expect(b.hops).toBe(1);
  });

  it('skips seeds that do not exist in the graph', () => {
    const g = buildGraph();
    const result = retrieveWeighted(g, {
      seeds: [nodeId('doc:ghost'), seedDoc],
      maxHops: 0,
      sources: { weights: { vault: 1 } },
    });
    expect(byId(result)).toEqual([seedDoc as string]);
  });

  it('is deterministic across repeated runs', () => {
    const g = buildGraph();
    const q = {
      seeds: [seedDoc],
      maxHops: 2,
      sources: { weights: { vault: 3, code: 2, external: 1 } },
    } as const;
    const r1 = retrieveWeighted(g, q);
    const r2 = retrieveWeighted(g, q);
    expect(byId(r1)).toEqual(byId(r2));
    expect(r1.map((s) => s.score)).toEqual(r2.map((s) => s.score));
  });
});

// ---------------------------------------------------------------------------
// rankBySource — the "flat" benchmark baseline (no traversal)
// ---------------------------------------------------------------------------

describe('rankBySource · flat re-ranking', () => {
  const nodes: Node[] = [
    { id: codeA, kind: 'symbol', label: 'Alpha', metadata: src('code') },
    { id: vaultA, kind: 'doc', label: 'vault-a', metadata: src('vault') },
    { id: externalA, kind: 'doc', label: 'ext-a', metadata: src('external') },
  ];

  it('ranks purely by source weight with constant proximity 1', () => {
    const result = rankBySource(nodes, { weights: { vault: 3, code: 2, external: 1 } });
    expect(byId(result)).toEqual([vaultA as string, codeA as string, externalA as string]);
    expect(result.every((s) => s.proximity === 1 && s.hops === 0)).toBe(true);
    expect(result[0].score).toBe(3);
  });

  it('de-duplicates an over-supplied candidate set', () => {
    const result = rankBySource([...nodes, ...nodes], { weights: {} });
    expect(result).toHaveLength(3);
  });

  it('dropZeroWeight removes zero-weighted candidates', () => {
    const result = rankBySource(nodes, {
      weights: { vault: 1, code: 1, external: 0 },
      dropZeroWeight: true,
    });
    expect(byId(result)).not.toContain(externalA as string);
  });

  it('opts.limit caps the result', () => {
    const result = rankBySource(nodes, { weights: { vault: 3, code: 2, external: 1 } }, { limit: 1 });
    expect(byId(result)).toEqual([vaultA as string]);
  });

  it('demonstrates the graph-vs-flat ablation delta the SPEC describes', () => {
    // Flat: source weight only — externalA (weight 1) outranks codeA (weight 0.9)?
    // No: weights chosen so flat ranks externalA below codeA, but graph
    // proximity is identical (both hop 1), so the graph arm preserves the
    // same source-driven order. The point of the test is that the two arms
    // expose DIFFERENT score columns (proximity varies in graph, constant
    // in flat) over the same source config — the isolatable lever.
    const g = buildGraph();
    const cfg: SourceWeightConfig = { weights: { vault: 2, code: 1, external: 1 } };
    const flat = rankBySource(
      [
        g.node(vaultA)!,
        g.node(codeA)!,
        g.node(externalA)!,
        g.node(externalB)!,
      ],
      cfg,
    );
    const graphArm = retrieveWeighted(g, {
      seeds: [seedDoc],
      maxHops: 2,
      includeSeeds: false,
      sources: cfg,
    });
    // Flat gives externalB proximity 1 (no traversal); graph gives it 0.25.
    const flatB = flat.find((s) => s.node.id === externalB)!;
    const graphB = graphArm.find((s) => s.node.id === externalB)!;
    expect(flatB.proximity).toBe(1);
    expect(graphB.proximity).toBeCloseTo(0.25);
    expect(graphB.score).toBeLessThan(flatB.score);
  });
});
