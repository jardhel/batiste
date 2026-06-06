/**
 * Cluster-level Access Control
 *
 * Phase 3 wiring of `@batiste-aidk/graph` into `@batiste-aidk/scope`.
 *
 * Design
 * ------
 * Existing scope policies (see `file-matcher.ts`) reason in *path*
 * space: a glob says yes/no to a string. With the graph in hand we can
 * ALSO reason in *cluster* space — "anything in the auth/ cluster is
 * read-only, anything in the billing/ cluster is allow-write" — without
 * having to enumerate every file by hand.
 *
 * `ClusterAclMatcher` wraps a base {@link FileMatcher} and adds an
 * orthogonal layer of cluster-level checks. The two layers compose
 * conjunctively:
 *
 *   1. The base matcher decides if the path is in scope at all
 *      (operator-supplied allowedPaths ∪ secret-path defaults).
 *   2. The cluster overlay decides if the requested *operation* is
 *      permitted for the cluster the path belongs to.
 *
 * If no graph is configured, the matcher falls back to base-matcher-only
 * behaviour — every existing call site keeps working.
 *
 * Determinism note
 * ----------------
 * The graph package guarantees that identical input produces identical
 * cluster IDs across runs (see `packages/graph/src/types.ts`
 * "Determinism is part of the contract"). That guarantee is what lets
 * cluster ACLs be authored statically — operators can pin a rule to
 * `cluster: 'auth/**'` and trust it not to drift on rebuild.
 *
 * Backward compatibility
 * ----------------------
 * - When no graph is provided, behaviour is **identical** to a bare
 *   `FileMatcher`.
 * - When a graph is provided but a path has no cluster (the file is
 *   absent from the graph or the cluster overlay does not cover it),
 *   the cluster layer abstains — only the base matcher decides.
 * - Operations are checked only against the rules that actually match
 *   the resolved cluster. A rule with no `allow`/`deny` list is treated
 *   as advisory and abstains.
 */

import micromatch from 'micromatch';
import type { ClusterId, Graph } from '@batiste-aidk/graph';
import { FileMatcher } from './file-matcher.js';
import type { AccessPolicy } from './types.js';

/**
 * The set of capabilities a cluster ACL rule can grant or deny. Kept
 * small and orthogonal — `read` covers any tool that reads the file,
 * `write` covers any tool that mutates it, `execute` covers tools that
 * run the file as a sandbox payload. Phase 4 may extend this set; we
 * make the type a string union (not an enum) so callers can switch
 * exhaustively.
 */
export type ClusterCapability = 'read' | 'write' | 'execute';

/**
 * A single cluster-level ACL rule.
 *
 * `cluster` is matched against the resolved cluster's *label* (e.g.
 * `auth/`, `billing/`) using micromatch — the same engine the existing
 * file-matcher uses, so operators see one mental model. Matching by
 * label rather than the opaque ClusterId keeps rules human-readable;
 * cluster IDs are intentionally hash-derived and not author-friendly.
 *
 * `allow` and `deny` are independent capability lists. Deny wins,
 * mirroring `file-matcher`'s deny-overrides-allow contract.
 */
export interface ClusterAclRule {
  /**
   * Glob over the cluster's `label` (e.g. `auth/**`, `billing/**`, `**`).
   * Note that micromatch's `auth/*` does NOT match the literal label
   * `auth/` — use `auth/**` (or just `auth/`) for whole-cluster rules.
   */
  readonly cluster: string;
  /** Capabilities granted by this rule. */
  readonly allow?: readonly ClusterCapability[];
  /** Capabilities denied by this rule. */
  readonly deny?: readonly ClusterCapability[];
}

/**
 * Result of a cluster-aware authorisation check.
 *
 * The discriminator is `decision`:
 *   - `allow` — both layers permit the operation.
 *   - `deny` — at least one layer denies. `reason` carries which.
 *   - `abstain` — the cluster layer had no opinion (no graph, or no
 *     matching rules). The base matcher's verdict is final.
 *
 * `cluster` is populated whenever the path resolved to a cluster, even
 * for `abstain` outcomes — useful for downstream telemetry.
 */
export interface ClusterAclDecision {
  readonly decision: 'allow' | 'deny' | 'abstain';
  readonly reason?: string;
  readonly cluster?: { readonly id: ClusterId; readonly label: string } | null;
}

/**
 * Construction options for {@link ClusterAclMatcher}.
 */
export interface ClusterAclMatcherOptions {
  /** Base path-level scope policy. Always evaluated first. */
  readonly policy: AccessPolicy;
  /** Optional graph providing cluster overlay. When omitted, the matcher degrades gracefully. */
  readonly graph?: Graph;
  /** Cluster-level rules. Ignored when no graph is supplied. */
  readonly rules?: readonly ClusterAclRule[];
}

/**
 * Cluster-aware extension of {@link FileMatcher}.
 *
 * Holds (a) a base {@link FileMatcher} for path-level checks and
 * (b) an optional graph + rule set for cluster-level checks. The
 * `authorize` method is the integration point the rest of scope (and
 * any external caller) uses.
 */
export class ClusterAclMatcher {
  private readonly base: FileMatcher;
  private readonly graph: Graph | undefined;
  private readonly rules: readonly ClusterAclRule[];

  constructor(opts: ClusterAclMatcherOptions) {
    this.base = new FileMatcher(opts.policy);
    this.graph = opts.graph;
    this.rules = opts.rules ?? [];
  }

  /**
   * Path-level check that mirrors {@link FileMatcher.isAllowed}. Useful
   * when the caller does not yet know the operation but still wants the
   * existing deny-by-default behaviour. Cluster rules are not consulted.
   */
  isPathAllowed(filePath: string): boolean {
    return this.base.isAllowed(filePath);
  }

  /**
   * Resolve the cluster a file lives in, or `null` if the graph does
   * not know about the file (or no graph is configured).
   *
   * Exposed publicly because consumers (e.g. audit's
   * `SemanticAnnotator`, code's `GraphQuerier`) want the same lookup
   * scope uses for ACLs — keeping it private would force those callers
   * to re-implement it.
   */
  resolveCluster(filePath: string): { id: ClusterId; label: string } | null {
    if (!this.graph) return null;
    const node = this.graph.findByPath(filePath);
    if (!node) return null;
    const cId = this.graph.clusterOf(node.id);
    if (!cId) return null;
    const c = this.graph.cluster(cId);
    if (!c) return null;
    return { id: c.id, label: c.label };
  }

  /**
   * Full authorisation check: combines the base path-level scope with
   * the cluster-level overlay.
   *
   * Behaviour matrix:
   *
   *   | base | cluster      | result                            |
   *   |------|--------------|-----------------------------------|
   *   | deny | -            | deny (base wins)                  |
   *   | allow| no graph     | allow                             |
   *   | allow| no rules hit | allow (cluster layer abstains)    |
   *   | allow| rule denies  | deny                              |
   *   | allow| rule allows  | allow                             |
   *   | allow| no allow yet | abstain → falls through to allow  |
   */
  authorize(filePath: string, capability: ClusterCapability): ClusterAclDecision {
    if (!this.base.isAllowed(filePath)) {
      return {
        decision: 'deny',
        reason: 'path denied by base scope policy',
        cluster: this.resolveCluster(filePath),
      };
    }

    const cluster = this.resolveCluster(filePath);
    if (!cluster || this.rules.length === 0) {
      // Either no graph, or no cluster-level rules at all → cluster
      // layer has nothing to say. Base allowed, so the call goes through.
      return { decision: 'allow', cluster };
    }

    // Find every rule whose `cluster` glob matches this cluster's label.
    // Determinism: rules are evaluated in declaration order — operators
    // who care about precedence can rely on it without us inventing a
    // priority field.
    let allowed = false;
    for (const rule of this.rules) {
      if (!micromatch.isMatch(cluster.label, rule.cluster)) continue;
      if (rule.deny?.includes(capability)) {
        return {
          decision: 'deny',
          reason: `cluster '${cluster.label}' denies '${capability}' via rule '${rule.cluster}'`,
          cluster,
        };
      }
      if (rule.allow?.includes(capability)) {
        allowed = true;
      }
    }

    if (allowed) return { decision: 'allow', cluster };
    // No rule explicitly allowed and none explicitly denied → cluster
    // layer abstains, falls through to the base verdict (which was
    // already `allow` by the time we got here).
    return { decision: 'allow', cluster };
  }

  /**
   * Convenience filter: return only paths that authorise for the given
   * capability. Mirrors {@link FileMatcher.filter} so call sites can
   * swap matchers transparently.
   */
  filter(paths: readonly string[], capability: ClusterCapability): string[] {
    return paths.filter((p) => this.authorize(p, capability).decision === 'allow');
  }

  /**
   * Inspect the rules attached to this matcher. Returned as a defensive
   * copy so callers cannot mutate the internal list.
   */
  rulesSnapshot(): readonly ClusterAclRule[] {
    return [...this.rules];
  }
}
