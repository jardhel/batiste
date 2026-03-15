/**
 * Routing Layer
 *
 * Selects the optimal node for a request using a composite score:
 *   score = (reliability × WEIGHT_RELIABILITY) - (normalisedLatency × WEIGHT_LATENCY)
 *         - (normalisedPrice × WEIGHT_PRICE) + tagBonus
 *
 * Weights are tuned to balance SLA quality against cost.
 */

import type { RouteRequest, RoutedNode, NodeRecord } from './types.js';
import type { NodeDiscovery } from './discovery.js';

const WEIGHT_RELIABILITY = 0.5;
const WEIGHT_LATENCY = 0.3;
const WEIGHT_PRICE = 0.15;
const WEIGHT_TAG_BONUS = 0.05;

function normalise(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return (value - min) / (max - min);
}

export class RoutingLayer {
  constructor(private readonly discovery: NodeDiscovery) {}

  /**
   * Route a request to the best available node.
   * Returns null when no eligible node exists.
   */
  route(request: RouteRequest): RoutedNode | null {
    const candidates = this.discovery.search({
      capability: request.capability,
      status: 'online',
      maxPricePerCycle: request.maxPricePerCycle,
    });

    if (candidates.length === 0) return null;
    if (candidates.length === 1) return { node: candidates[0]!, score: 1 };

    // Gather ranges for normalisation
    const latencies = candidates.map((n) => n.latencyMs ?? 999);
    const prices = candidates.map((n) => n.pricePerCycle);
    const minLat = Math.min(...latencies);
    const maxLat = Math.max(...latencies);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);

    const scored = candidates.map((node) => {
      const lat = node.latencyMs ?? 999;
      const normLat = normalise(lat, minLat, maxLat);
      const normPrice = normalise(node.pricePerCycle, minPrice, maxPrice);

      const tagBonus =
        request.preferTags && request.preferTags.some((t) => node.tags.includes(t)) ? 1 : 0;

      const score =
        node.reliability * WEIGHT_RELIABILITY -
        normLat * WEIGHT_LATENCY -
        normPrice * WEIGHT_PRICE +
        tagBonus * WEIGHT_TAG_BONUS;

      return { node, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0]!;
  }

  /** Route to any available node when capability is flexible */
  routeAny(preferTags?: string[]): RoutedNode | null {
    const candidates = this.discovery.findAvailable();
    if (candidates.length === 0) return null;
    // Just pick the highest-reliability node
    const best = candidates.reduce((a, b) => (a.reliability >= b.reliability ? a : b));
    return { node: best, score: best.reliability };
  }
}
