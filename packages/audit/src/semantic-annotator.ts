/**
 * Semantic Annotator
 *
 * Phase 3 wiring of `@batiste-aidk/graph` into `@batiste-aidk/audit`.
 *
 * Why
 * ---
 * The audit ledger currently records the *what* of every tool call —
 * tool name, arguments, result, duration. With the graph in hand we
 * can add the *where in the codebase* dimension at zero cost to the
 * caller: given the path or symbol the tool acted on, look it up in
 * the graph and attach the cluster + a few neighbour hints.
 *
 * Compliance/DD value: a reviewer auditing six weeks later sees not
 * "find_symbol(SessionToken)" but "find_symbol(SessionToken) →
 * cluster auth/, neighbours [Login, JwtMiddleware]". That is the
 * difference between a log and an evidence trail.
 *
 * Lossless / additive
 * -------------------
 * Annotation produces a NEW shape — the original {@link AuditEntry} is
 * not mutated. The annotated shape carries every existing field
 * verbatim plus a `semantic` sidecar. `AuditLedger.append` keeps
 * accepting the original {@link AuditEntry} untouched; callers who
 * want the annotation can either persist it elsewhere (a sibling
 * table, a JSONL stream) or, in a future migration, drop the sidecar
 * into the existing `args_json` payload behind a reserved key.
 *
 * Determinism
 * -----------
 * Annotation is a pure function of `(entry, graph)`. Given the same
 * graph state, the same entry yields byte-identical annotations. This
 * makes the audit ledger reproducible from the original ledger plus a
 * pinned graph snapshot — exactly the property an external auditor
 * needs.
 */

import type { Graph, NodeKind } from '@batiste-aidk/graph';
import type { AuditEntry } from './types.js';

/**
 * Semantic context attached to an entry. Every field is optional
 * because the annotator gracefully degrades when the graph cannot
 * resolve the entry's subject — an entry that operated on a
 * non-graphed file simply gets `{}` and the original entry is
 * preserved as-is.
 */
export interface SemanticAnnotation {
  /** Cluster the subject path/symbol belongs to. */
  readonly cluster?: { readonly id: string; readonly label: string };
  /** Up to {@link SemanticAnnotatorOptions.maxNeighbors} nearest neighbours, by label. */
  readonly neighbors?: readonly string[];
  /** Node kind of the resolved subject (file/symbol/...). */
  readonly kind?: NodeKind;
  /** Reason the annotator could not produce a richer annotation. Absent on success. */
  readonly note?: string;
}

/**
 * Result of {@link SemanticAnnotator.annotate}: the original entry
 * plus a `semantic` sidecar. Callers can spread this back through any
 * persistence layer that accepts arbitrary metadata; the annotator
 * itself never writes to the ledger directly (single-responsibility).
 */
export type AnnotatedAuditEntry = AuditEntry & {
  readonly semantic: SemanticAnnotation;
};

/**
 * Construction options. All knobs have defaults tuned for reasonable
 * audit-record sizes — bumping `maxNeighbors` past ~10 starts inflating
 * the ledger faster than it adds review value.
 */
export interface SemanticAnnotatorOptions {
  /** Cap on neighbour labels included in each annotation. Default: 5. */
  readonly maxNeighbors?: number;
  /**
   * Hops the neighbour expansion uses. Default: 1 (direct neighbours
   * only). Hops > 2 explodes payload size on hub nodes; the annotator
   * trims via `maxNeighbors` but the BFS itself still runs.
   */
  readonly hops?: number;
  /**
   * If true, restrict neighbours to the same cluster as the seed. Useful
   * when the goal is "what other auth-cluster things did this touch?"
   * rather than a global view. Default: true.
   */
  readonly sameCluster?: boolean;
}

const DEFAULT_MAX_NEIGHBORS = 5;
const DEFAULT_HOPS = 1;

/**
 * The {@link AuditEntry} shape carries an opaque `args` bag — different
 * tools store their subject under different keys. We probe the
 * conventional ones. Tools that use neither field can either pass an
 * explicit subject via {@link SemanticAnnotator.annotate}'s second
 * positional override (TODO Phase 4) or accept that their entries get a
 * `{ note: 'no subject' }` annotation.
 */
const PATH_ARG_KEYS = ['path', 'filePath', 'file'] as const;
const SYMBOL_ARG_KEYS = ['symbolName', 'symbol', 'name'] as const;

function pickString(args: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const v = args[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

/**
 * Stateless annotator. Hold a single instance per service and reuse —
 * `annotate` does no I/O beyond graph reads (which the graph package
 * keeps in memory).
 */
export class SemanticAnnotator {
  private readonly maxNeighbors: number;
  private readonly hops: number;
  private readonly sameCluster: boolean;

  constructor(opts: SemanticAnnotatorOptions = {}) {
    this.maxNeighbors = opts.maxNeighbors ?? DEFAULT_MAX_NEIGHBORS;
    this.hops = opts.hops ?? DEFAULT_HOPS;
    this.sameCluster = opts.sameCluster ?? true;
  }

  /**
   * Produce an annotated copy of `entry`. The annotator first tries to
   * resolve a subject node — preferring a path arg, then a symbol arg
   * — looks up the cluster, and walks the neighbourhood up to
   * `maxNeighbors`. If nothing resolves, the returned annotation only
   * carries a `note` explaining why; the entry is still returned in
   * full so callers never lose data.
   */
  annotate(entry: AuditEntry, graph: Graph): AnnotatedAuditEntry {
    const args = entry.args;
    const path = pickString(args, PATH_ARG_KEYS);
    const symbol = pickString(args, SYMBOL_ARG_KEYS);

    if (!path && !symbol) {
      return { ...entry, semantic: { note: 'no path or symbol arg to anchor annotation' } };
    }

    // Path takes precedence when both are present — a path is unambiguous,
    // a symbol name often matches several declarations across a repo.
    if (path) {
      const node = graph.findByPath(path);
      if (!node) {
        return {
          ...entry,
          semantic: { note: `path '${path}' not present in graph` },
        };
      }
      const clusterId = graph.clusterOf(node.id);
      const cluster = clusterId ? graph.cluster(clusterId) : null;
      const neighbors = graph
        .neighbors(node.id, { hops: this.hops, sameCluster: this.sameCluster, limit: this.maxNeighbors })
        .map((n) => n.label);
      return {
        ...entry,
        semantic: {
          ...(cluster ? { cluster: { id: cluster.id as string, label: cluster.label } } : {}),
          neighbors,
          kind: node.kind,
        },
      };
    }

    // Symbol-only path: findSymbol may return multiple hits; we take the
    // first deterministically (the graph guarantees stable order) and
    // attach a `note` if there were ambiguous matches so reviewers know.
    const hits = graph.findSymbol(symbol as string);
    if (hits.length === 0) {
      return {
        ...entry,
        semantic: { note: `symbol '${symbol as string}' not found in graph` },
      };
    }
    const head = hits[0]!;
    const clusterId = graph.clusterOf(head.id);
    const cluster = clusterId ? graph.cluster(clusterId) : null;
    const neighbors = graph
      .neighbors(head.id, { hops: this.hops, sameCluster: this.sameCluster, limit: this.maxNeighbors })
      .map((n) => n.label);
    const ambiguityNote =
      hits.length > 1
        ? `symbol '${symbol as string}' has ${String(hits.length)} matches; annotated against the first`
        : undefined;
    return {
      ...entry,
      semantic: {
        ...(cluster ? { cluster: { id: cluster.id as string, label: cluster.label } } : {}),
        neighbors,
        kind: head.kind,
        ...(ambiguityNote ? { note: ambiguityNote } : {}),
      },
    };
  }

  /**
   * Annotate a batch in one call. Convenience for compliance-report
   * pipelines that traverse the entire ledger; the per-entry method is
   * the building block.
   */
  annotateAll(entries: readonly AuditEntry[], graph: Graph): AnnotatedAuditEntry[] {
    return entries.map((e) => this.annotate(e, graph));
  }
}
