/**
 * @batiste/marketplace
 *
 * Autonomous Agent Compute Marketplace.
 * Node registry, discovery, zero-trust routing, and per-cycle pricing.
 *
 * @dogfood Built using @batiste/code analysis and validation tooling.
 */

export { NodeRegistry } from './registry.js';
export { NodeDiscovery } from './discovery.js';
export { RoutingLayer } from './routing.js';
export { PricingMeter } from './pricing.js';
export { startMarketplace } from './gateway.js';
export type { MarketplaceGatewayOptions, MarketplaceHandle } from './gateway.js';
export type {
  NodeRecord,
  NodeStatus,
  RegisterNodeInput,
  RouteRequest,
  RoutedNode,
  BillingEntry,
  BillingReport,
  NodeDiscoveryQuery,
  RecordCyclesInput,
} from './types.js';
