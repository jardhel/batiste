import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeRegistry } from '../registry.js';
import { NodeDiscovery } from '../discovery.js';
import { RoutingLayer } from '../routing.js';

let registry: NodeRegistry;
let discovery: NodeDiscovery;
let router: RoutingLayer;

beforeEach(() => {
  registry = new NodeRegistry(':memory:');
  discovery = new NodeDiscovery(registry);
  router = new RoutingLayer(discovery);
});

afterEach(() => {
  registry.close();
});

describe('NodeDiscovery', () => {
  it('finds nodes by capability', () => {
    registry.register({
      name: 'A',
      description: '',
      capabilities: ['ast_analysis'],
      endpoint: 'http://localhost:4001',
      pricePerCycle: 0.001,
      creatorId: 'c1',
      tags: [],
    });
    registry.register({
      name: 'B',
      description: '',
      capabilities: ['pdf_parse'],
      endpoint: 'http://localhost:4002',
      pricePerCycle: 0.002,
      creatorId: 'c1',
      tags: [],
    });
    const found = discovery.findByCapability('ast_analysis');
    expect(found.length).toBe(1);
    expect(found[0]?.name).toBe('A');
  });

  it('returns empty when no match', () => {
    expect(discovery.findByCapability('unknown_cap')).toHaveLength(0);
  });

  it('filters by maxPricePerCycle', () => {
    registry.register({
      name: 'Cheap',
      description: '',
      capabilities: ['pdf_parse'],
      endpoint: 'http://localhost:4001',
      pricePerCycle: 0.001,
      creatorId: 'c1',
      tags: [],
    });
    registry.register({
      name: 'Expensive',
      description: '',
      capabilities: ['pdf_parse'],
      endpoint: 'http://localhost:4002',
      pricePerCycle: 0.01,
      creatorId: 'c1',
      tags: [],
    });
    const results = discovery.search({ maxPricePerCycle: 0.005 });
    expect(results.length).toBe(1);
    expect(results[0]?.name).toBe('Cheap');
  });
});

describe('RoutingLayer', () => {
  it('returns null when no nodes available', () => {
    expect(router.route({ capability: 'ast_analysis' })).toBeNull();
  });

  it('routes to the only available node', () => {
    registry.register({
      name: 'Solo',
      description: '',
      capabilities: ['ast_analysis'],
      endpoint: 'http://localhost:4001',
      pricePerCycle: 0.001,
      creatorId: 'c1',
      tags: [],
    });
    const result = router.route({ capability: 'ast_analysis' });
    expect(result).not.toBeNull();
    expect(result?.node.name).toBe('Solo');
  });

  it('prefers higher reliability node', () => {
    const n1 = registry.register({
      name: 'LowRel',
      description: '',
      capabilities: ['pdf_parse'],
      endpoint: 'http://localhost:4001',
      pricePerCycle: 0.001,
      creatorId: 'c1',
      tags: [],
    });
    const n2 = registry.register({
      name: 'HighRel',
      description: '',
      capabilities: ['pdf_parse'],
      endpoint: 'http://localhost:4002',
      pricePerCycle: 0.001,
      creatorId: 'c1',
      tags: [],
    });
    // Degrade n1 reliability
    for (let i = 0; i < 10; i++) registry.updateReliability(n1.id, false);

    const result = router.route({ capability: 'pdf_parse' });
    expect(result?.node.name).toBe('HighRel');
  });

  it('respects maxPricePerCycle filter', () => {
    registry.register({
      name: 'TooExpensive',
      description: '',
      capabilities: ['csv_query'],
      endpoint: 'http://localhost:4001',
      pricePerCycle: 0.01,
      creatorId: 'c1',
      tags: [],
    });
    const result = router.route({ capability: 'csv_query', maxPricePerCycle: 0.005 });
    expect(result).toBeNull();
  });
});

describe('PricingMeter (via gateway types)', () => {
  it('discovery search respects tags filter', () => {
    registry.register({
      name: 'Tagged',
      description: '',
      capabilities: ['ast_analysis'],
      endpoint: 'http://localhost:4001',
      pricePerCycle: 0.001,
      creatorId: 'c1',
      tags: ['premium'],
    });
    registry.register({
      name: 'Untagged',
      description: '',
      capabilities: ['ast_analysis'],
      endpoint: 'http://localhost:4002',
      pricePerCycle: 0.001,
      creatorId: 'c1',
      tags: [],
    });
    const results = discovery.search({ tags: ['premium'] });
    expect(results.length).toBe(1);
    expect(results[0]?.name).toBe('Tagged');
  });
});
