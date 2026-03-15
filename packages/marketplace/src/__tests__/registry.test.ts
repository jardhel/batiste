import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeRegistry } from '../registry.js';

const SAMPLE_INPUT = {
  name: 'Code Analyzer',
  description: 'AST + TDD + AutoFix',
  capabilities: ['ast_analysis', 'tdd', 'autofix'],
  endpoint: 'http://localhost:4001',
  pricePerCycle: 0.001,
  creatorId: 'creator-1',
  tags: ['code', 'analysis'],
};

let registry: NodeRegistry;

beforeEach(() => {
  registry = new NodeRegistry(':memory:');
});

afterEach(() => {
  registry.close();
});

describe('NodeRegistry', () => {
  it('registers a node and returns a record with id', () => {
    const node = registry.register(SAMPLE_INPUT);
    expect(node.id).toBeTruthy();
    expect(node.name).toBe('Code Analyzer');
    expect(node.status).toBe('online');
    expect(node.capabilities).toEqual(['ast_analysis', 'tdd', 'autofix']);
    expect(node.reliability).toBe(1.0);
  });

  it('retrieves a node by id', () => {
    const node = registry.register(SAMPLE_INPUT);
    const fetched = registry.get(node.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.name).toBe('Code Analyzer');
  });

  it('returns null for unknown id', () => {
    expect(registry.get('does-not-exist')).toBeNull();
  });

  it('lists all registered nodes', () => {
    registry.register(SAMPLE_INPUT);
    registry.register({ ...SAMPLE_INPUT, name: 'Doc Intelligence', endpoint: 'http://localhost:4002' });
    expect(registry.list().length).toBe(2);
  });

  it('filters list by status', () => {
    const node = registry.register(SAMPLE_INPUT);
    registry.updateStatus(node.id, 'standby');
    const online = registry.list({ status: 'online' });
    const standby = registry.list({ status: 'standby' });
    expect(online.length).toBe(0);
    expect(standby.length).toBe(1);
  });

  it('unregisters a node', () => {
    const node = registry.register(SAMPLE_INPUT);
    const ok = registry.unregister(node.id);
    expect(ok).toBe(true);
    expect(registry.get(node.id)).toBeNull();
  });

  it('returns false when unregistering unknown node', () => {
    expect(registry.unregister('ghost')).toBe(false);
  });

  it('heartbeat marks node online', () => {
    const node = registry.register(SAMPLE_INPUT);
    registry.updateStatus(node.id, 'offline');
    const ok = registry.heartbeat(node.id);
    expect(ok).toBe(true);
    expect(registry.get(node.id)?.status).toBe('online');
  });

  it('updateLatency uses EMA', () => {
    const node = registry.register(SAMPLE_INPUT);
    registry.updateLatency(node.id, 100);
    const after = registry.get(node.id)!;
    expect(after.latencyMs).toBe(100); // first sample = raw
    registry.updateLatency(node.id, 50);
    const after2 = registry.get(node.id)!;
    // EMA: 0.3 * 50 + 0.7 * 100 = 85
    expect(after2.latencyMs).toBeCloseTo(85, 1);
  });

  it('updateReliability degrades on failure', () => {
    const node = registry.register(SAMPLE_INPUT);
    registry.updateReliability(node.id, false);
    const after = registry.get(node.id)!;
    expect(after.reliability).toBeLessThan(1.0);
  });

  it('pruneStale returns 0 when nodes are fresh', () => {
    registry.register(SAMPLE_INPUT);
    expect(registry.pruneStale()).toBe(0);
  });
});
