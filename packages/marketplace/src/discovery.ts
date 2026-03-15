/**
 * Node Discovery
 *
 * Query the registry by capability, tags, price, and status.
 * Returns ranked lists ready for the routing layer.
 */

import type { NodeRecord, NodeDiscoveryQuery } from './types.js';
import type { NodeRegistry } from './registry.js';

export class NodeDiscovery {
  constructor(private readonly registry: NodeRegistry) {}

  /**
   * Find nodes matching all criteria.
   * Results are sorted: online first, then by reliability desc, then latency asc.
   */
  search(query: NodeDiscoveryQuery = {}): NodeRecord[] {
    const all = this.registry.list(query.status ? { status: query.status } : undefined);

    let results = all.filter((node) => {
      if (query.capability && !node.capabilities.includes(query.capability)) return false;
      if (query.tags && query.tags.length > 0) {
        const hasAll = query.tags.every((t) => node.tags.includes(t));
        if (!hasAll) return false;
      }
      if (query.maxPricePerCycle !== undefined && node.pricePerCycle > query.maxPricePerCycle) {
        return false;
      }
      return true;
    });

    results = results.sort((a, b) => {
      // Online nodes first
      const statusOrder = (s: string) => (s === 'online' ? 0 : s === 'standby' ? 1 : 2);
      const so = statusOrder(a.status) - statusOrder(b.status);
      if (so !== 0) return so;
      // Higher reliability first
      const relDiff = b.reliability - a.reliability;
      if (Math.abs(relDiff) > 0.01) return relDiff;
      // Lower latency first (null = unknown, sort last)
      const la = a.latencyMs ?? Infinity;
      const lb = b.latencyMs ?? Infinity;
      return la - lb;
    });

    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  findByCapability(capability: string): NodeRecord[] {
    return this.search({ capability, status: 'online' });
  }

  findAvailable(): NodeRecord[] {
    return this.search({ status: 'online' });
  }
}
