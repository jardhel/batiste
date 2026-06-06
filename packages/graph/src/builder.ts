/**
 * @batiste-aidk/graph · builder
 *
 * Phase 2b implementation of {@link GraphBuilder}. Takes a primitive
 * `(nodes, edges)` input plus an optional pre-computed cluster overlay
 * and returns a {@link GraphologyGraph} wrapped in a
 * {@link BuildResult} envelope.
 *
 * Validation responsibilities (each surfaces as a {@link BuildDiagnostics}
 * `parseError`, never as a thrown exception — Phase 1 contract is that
 * builders return diagnostics, not crash):
 *
 *   - Duplicate `NodeId`s (later occurrences are dropped).
 *   - Edges referencing unknown source/target nodes (edge dropped).
 *   - Duplicate `EdgeId`s (later occurrences are dropped).
 *   - Cluster members that point to unknown node IDs (member dropped
 *     from the cluster; if the cluster ends up empty, the cluster is
 *     dropped too).
 *
 * Determinism: nodes, edges, and clusters are sorted by their string
 * IDs before being handed to {@link GraphologyGraph}, guaranteeing
 * byte-stable iteration order downstream.
 */

import type {
  BuildResult,
  Cluster,
  ClusterId,
  Edge,
  GraphBuilder,
  GraphInput,
  Node,
  NodeId,
} from './index.js';
import { GraphologyGraph } from './graph-impl.js';

/**
 * Phase 2b extends the bare {@link GraphInput} with an optional
 * cluster overlay. `clusters` is read-only here; Phase 2c will add a
 * `Clusterer` that produces it from a graph.
 */
export interface ExtendedGraphInput extends GraphInput {
  readonly clusters?: readonly Cluster[];
}

/**
 * Concrete {@link GraphBuilder}. Stateless — `build` does all the work
 * per invocation, so a single builder instance is safe to reuse and
 * share across requests.
 */
export class InMemoryGraphBuilder implements GraphBuilder {
  build(input: ExtendedGraphInput | GraphInput): BuildResult {
    const startedAt = Date.now();
    const parseErrors: { path: string; reason: string }[] = [];

    // --- Pass 1: deduplicate + index nodes ---------------------------------
    const nodesById = new Map<NodeId, Node>();
    for (const node of input.nodes) {
      if (nodesById.has(node.id)) {
        parseErrors.push({
          path: `node:${node.id as string}`,
          reason: `duplicate NodeId; keeping the first occurrence`,
        });
        continue;
      }
      nodesById.set(node.id, node);
    }

    // --- Pass 2: validate + deduplicate edges ------------------------------
    const edgesById = new Map<string, Edge>();
    for (const edge of input.edges) {
      if (edgesById.has(edge.id as string)) {
        parseErrors.push({
          path: `edge:${edge.id as string}`,
          reason: `duplicate EdgeId; keeping the first occurrence`,
        });
        continue;
      }
      if (!nodesById.has(edge.source)) {
        parseErrors.push({
          path: `edge:${edge.id as string}`,
          reason: `unknown source NodeId ${edge.source as string}`,
        });
        continue;
      }
      if (!nodesById.has(edge.target)) {
        parseErrors.push({
          path: `edge:${edge.id as string}`,
          reason: `unknown target NodeId ${edge.target as string}`,
        });
        continue;
      }
      edgesById.set(edge.id as string, edge);
    }

    // --- Pass 3: validate clusters + build membership map ------------------
    const clustersIn = (input as ExtendedGraphInput).clusters ?? [];
    const clustersById = new Map<ClusterId, Cluster>();
    const membership = new Map<NodeId, ClusterId>();
    for (const c of clustersIn) {
      if (clustersById.has(c.id)) {
        parseErrors.push({
          path: `cluster:${c.id as string}`,
          reason: `duplicate ClusterId; keeping the first occurrence`,
        });
        continue;
      }
      const validMembers: NodeId[] = [];
      for (const m of c.members) {
        if (!nodesById.has(m)) {
          parseErrors.push({
            path: `cluster:${c.id as string}`,
            reason: `unknown member NodeId ${m as string}; dropped from cluster`,
          });
          continue;
        }
        if (membership.has(m)) {
          parseErrors.push({
            path: `cluster:${c.id as string}`,
            reason: `node ${m as string} already assigned to cluster ${
              membership.get(m) as unknown as string
            }; second assignment ignored`,
          });
          continue;
        }
        validMembers.push(m);
      }
      if (validMembers.length === 0) {
        parseErrors.push({
          path: `cluster:${c.id as string}`,
          reason: `cluster has no valid members after validation; cluster dropped`,
        });
        continue;
      }
      const cleaned: Cluster = {
        id: c.id,
        label: c.label,
        members: validMembers,
        ...(c.cohesion !== undefined ? { cohesion: c.cohesion } : {}),
      };
      clustersById.set(c.id, cleaned);
      for (const m of validMembers) {
        membership.set(m, c.id);
      }
    }

    // --- Pass 4: stable ordering for determinism ---------------------------
    const sortedNodes = [...nodesById.values()].sort((a, b) =>
      (a.id as string).localeCompare(b.id as string),
    );
    const sortedEdges = [...edgesById.values()].sort((a, b) =>
      (a.id as string).localeCompare(b.id as string),
    );
    const sortedClusters = [...clustersById.values()].sort((a, b) =>
      (a.id as string).localeCompare(b.id as string),
    );

    const graph = new GraphologyGraph({
      nodes: sortedNodes,
      edges: sortedEdges,
      clusters: sortedClusters,
      membership,
    });

    return {
      graph,
      diagnostics: {
        elapsedMs: Date.now() - startedAt,
        // For the in-memory builder, "scanned" and "parsed" are both
        // synonyms for the input node count. The shape exists primarily
        // for the file-walking `Indexer`, but we populate it sensibly.
        filesScanned: input.nodes.length,
        filesParsed: nodesById.size,
        parseErrors,
      },
    };
  }
}
