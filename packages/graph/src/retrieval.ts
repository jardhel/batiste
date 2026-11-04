/**
 * @batiste-aidk/graph · retrieval (Phase 2d — Vault Graph RAG)
 *
 * Source-weighted retrieval and ranking over a built {@link Graph}.
 *
 * What this is (and is NOT)
 * -------------------------
 * This is the GRAPH layer of a graph-RAG pipeline: given seed node(s)
 * — produced upstream by whatever pre-selection the caller uses
 * (lexical, embedding, exact-path) — it expands across doc/fact/code
 * edges and RE-RANKS the expanded set, weighting each candidate by the
 * provenance *source* it came from. It is the unit the house benchmark
 * SPEC (`2026-06-18-eki-chunking-benchmark-v1`) calls out for
 * Benchmark B's ablation: the score delta between "flat" retrieval (no
 * graph expansion) and this graph-expanded, source-weighted ranking is
 * what isolates the effect of the graph layer.
 *
 * It is NOT an embedder, a chunker, or an LLM judge — those are
 * upstream/downstream and out of this package's scope (SPEC §4).
 *
 * Determinism
 * -----------
 * Embedding-free and seed-stable: identical `(graph, query)` produces
 * byte-identical rankings. Proximity is a pure function of hop distance
 * (`hopDecay ** hops`); the source multiplier is config-driven; ties in
 * score break by NodeId ascending. This matches the "reproducible by a
 * single shell command" doctrine the SPEC inherits from the house.
 *
 * Scoring model (the recommended design)
 * ---------------------------------------
 * `score = proximity * sourceWeight`, where
 *   - `proximity = hopDecay ** hops` (seed = 1, decays per hop), and
 *   - `sourceWeight` is looked up from {@link SourceWeightConfig} by the
 *     node's resolved {@link Source}.
 * Multiplicative composition keeps the two axes independent and
 * monotonic: a closer node never loses to a farther one of equal
 * source, and a higher-weighted source never loses to a lower one at
 * equal proximity. // ALT: an additive blend
 * `score = alpha*proximity + (1-alpha)*normalizedSourceWeight` was
 * considered; rejected for v1 because it needs a tunable `alpha` and a
 * weight-normalisation pass, adding two free parameters the benchmark
 * would have to hold fixed. Multiplicative is parameter-light and the
 * SPEC favours the minimal isolatable lever.
 */

import type {
  Graph,
  Node,
  NodeId,
  NodeKind,
  ScoredNode,
  Source,
  SourceWeightConfig,
  SourceWeightedQuery,
} from './types.js';
import { SOURCE_METADATA_KEY } from './types.js';

const DEFAULT_MAX_HOPS = 2;
const DEFAULT_HOP_DECAY = 0.5;
const DEFAULT_LIMIT = 100;

/**
 * Resolve a node's {@link Source}.
 *
 * Precedence:
 *   1. `metadata[SOURCE_METADATA_KEY]` if present (coerced to string).
 *   2. the node's {@link NodeKind} as a fallback, so an untagged corpus
 *      still ranks (e.g. weight all `doc` nodes above `symbol` nodes
 *      without per-node tagging).
 *
 * Exported so consumers (and the benchmark adapter) can audit exactly
 * which source a node will be weighted under before running a query.
 */
export function resolveSource(node: Node): Source {
  const tagged = node.metadata[SOURCE_METADATA_KEY];
  if (typeof tagged === 'string' && tagged.length > 0) return tagged;
  if (typeof tagged === 'number' || typeof tagged === 'boolean') return String(tagged);
  return node.kind;
}

/**
 * Look up the effective multiplier for a source under a config,
 * applying the {@link SourceWeightConfig.defaultWeight} fallback.
 *
 * Negative weights are clamped to `0` — a weight is a non-negative
 * multiplier by contract; a negative would invert the ranking, which
 * the scoring model does not define.
 */
export function weightForSource(source: Source, config: SourceWeightConfig): number {
  const explicit = Object.prototype.hasOwnProperty.call(config.weights, source)
    ? config.weights[source]
    : undefined;
  const raw = explicit ?? config.defaultWeight ?? 1;
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return raw;
}

/**
 * Source-weighted retrieval over `graph`.
 *
 * Walks outward from `query.seeds`, recording each reachable node's
 * minimum hop distance (multi-seed: the nearest seed wins), then scores
 * `proximity * sourceWeight` and returns the top {@link
 * SourceWeightedQuery.limit} as {@link ScoredNode}s, ranked by score
 * descending with a NodeId-ascending tie-break.
 *
 * Backend-agnostic: depends only on the public {@link Graph} surface
 * (`node` + single-hop `neighbors`), so it works against any Phase 2
 * implementation, not just the graphology one.
 */
export function retrieveWeighted(graph: Graph, query: SourceWeightedQuery): readonly ScoredNode[] {
  const maxHops = Math.max(0, query.maxHops ?? DEFAULT_MAX_HOPS);
  const decay = clampDecay(query.hopDecay ?? DEFAULT_HOP_DECAY);
  const limit = Math.max(0, query.limit ?? DEFAULT_LIMIT);
  const includeSeeds = query.includeSeeds ?? true;
  const kindFilter = query.kinds ? new Set<NodeKind>(query.kinds) : null;

  // --- BFS recording the minimum hop distance to each reachable node ---
  // Seeds that do not exist in the graph are skipped (not an error — the
  // upstream pre-selector may over-supply). Frontiers are walked in
  // NodeId-sorted order so the *first* hop assigned to a node is stable,
  // though for min-hop correctness order does not matter.
  const hopOf = new Map<string, number>();
  let frontier: string[] = [];
  for (const seed of query.seeds) {
    const sid = seed as string;
    if (graph.node(seed) === null) continue;
    if (!hopOf.has(sid)) {
      hopOf.set(sid, 0);
      frontier.push(sid);
    }
  }

  for (let hop = 0; hop < maxHops && frontier.length > 0; hop++) {
    const next: string[] = [];
    for (const current of [...frontier].sort()) {
      // Single-hop neighbour expansion via the public surface.
      const adj = graph.neighbors(current as NodeId, { hops: 1, limit: Number.MAX_SAFE_INTEGER });
      for (const n of adj) {
        const nid = n.id as string;
        if (hopOf.has(nid)) continue; // already reached at <= current hop
        hopOf.set(nid, hop + 1);
        next.push(nid);
      }
    }
    frontier = next;
  }

  // --- Score every reached node ---
  const scored: ScoredNode[] = [];
  for (const [nid, hops] of hopOf) {
    if (hops === 0 && !includeSeeds) continue;
    const node = graph.node(nid as NodeId);
    if (node === null) continue;
    if (kindFilter && !kindFilter.has(node.kind)) continue;

    const source = resolveSource(node);
    const sourceWeight = weightForSource(source, query.sources);
    if (sourceWeight === 0 && query.sources.dropZeroWeight === true) continue;

    const proximity = decay ** hops;
    scored.push({
      node,
      score: proximity * sourceWeight,
      hops,
      proximity,
      source,
      sourceWeight,
    });
  }

  // --- Rank: score desc, then NodeId asc for determinism ---
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.node.id.localeCompare(b.node.id);
  });

  return limit > 0 ? scored.slice(0, limit) : scored;
}

/**
 * Re-rank an already-retrieved set of nodes purely by source weight,
 * with no graph traversal. This is the "flat" arm the benchmark
 * compares against {@link retrieveWeighted}: same source config, but
 * proximity is constant (`1`) because there is no graph expansion.
 *
 * Useful both as a benchmark baseline and for callers who already hold
 * a candidate set from an upstream embedder/BM25 stage and only want
 * the source-weighting applied.
 */
export function rankBySource(
  nodes: readonly Node[],
  config: SourceWeightConfig,
  opts?: { readonly dropZeroWeight?: boolean; readonly limit?: number },
): readonly ScoredNode[] {
  const dropZero = opts?.dropZeroWeight ?? config.dropZeroWeight ?? false;
  const limit = Math.max(0, opts?.limit ?? nodes.length);

  const scored: ScoredNode[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const nid = node.id as string;
    if (seen.has(nid)) continue; // de-dup an over-supplied candidate set
    seen.add(nid);

    const source = resolveSource(node);
    const sourceWeight = weightForSource(source, config);
    if (sourceWeight === 0 && dropZero) continue;
    scored.push({
      node,
      score: sourceWeight, // proximity == 1 (flat, no traversal)
      hops: 0,
      proximity: 1,
      source,
      sourceWeight,
    });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.node.id.localeCompare(b.node.id);
  });

  return limit > 0 ? scored.slice(0, limit) : scored;
}

/** Clamp hop decay into `(0, 1]`; out-of-range or non-finite → default. */
function clampDecay(decay: number): number {
  if (!Number.isFinite(decay) || decay <= 0) return DEFAULT_HOP_DECAY;
  return decay > 1 ? 1 : decay;
}
