/**
 * @batiste-aidk/graph
 *
 * Public API surface for the code-and-knowledge graph that Batiste
 * uses to give `scope`, `audit`, and the `code` MCP tools a shared
 * semantic substrate. Phase 1 is type-only; Phase 2 lands the
 * implementations behind these contracts.
 *
 * See `README.md` for the philosophy, the three consumer profiles,
 * and the multi-phase rollout plan.
 */

export const VERSION = '0.1.0';

// Data shapes
export {
  type NodeId,
  type ClusterId,
  type EdgeId,
  type NodeKind,
  type EdgeKind,
  type GraphMetadata,
  type Node,
  type Edge,
  type Cluster,
  type QueryOptions,
  type FindSymbolOptions,
  type SummarizeOptions,
  type Graph,
  type BuildDiagnostics,
  type BuildResult,
  nodeId,
  clusterId,
  edgeId,
} from './types.js';

// Abstract contracts (Phase 2 implementations plug in here)
export {
  type GraphInput,
  type IndexerInput,
  type ClustererInput,
  type ClusterOverlay,
  type GraphBuilder,
  type Indexer,
  type Clusterer,
  type Querier,
} from './contracts.js';

// Phase 2b — graphology-backed implementation
export { GraphologyGraph, type GraphImplData } from './graph-impl.js';
export { InMemoryGraphBuilder, type ExtendedGraphInput } from './builder.js';

// Phase 2c — community-detection clustering (Louvain; Leiden in 2c.1)
export { CommunityDetectionClusterer, type RichClusterOverlay } from './clusterer.js';
