import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startMarketplace } from '../gateway.js';
import type { MarketplaceHandle } from '../gateway.js';

let handle: MarketplaceHandle;
let base: string;

beforeAll(async () => {
  handle = await startMarketplace({ port: 0 });
  base = `http://localhost:${handle.port}`;
});

afterAll(async () => {
  await handle.close();
});

async function post(path: string, body: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function get(path: string) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() };
}

async function del(path: string) {
  const res = await fetch(`${base}${path}`, { method: 'DELETE' });
  return { status: res.status, body: await res.json() };
}

describe('MarketplaceGateway', () => {
  it('GET /health returns ok', async () => {
    const { status, body } = await get('/health');
    expect(status).toBe(200);
    expect((body as { status: string }).status).toBe('ok');
  });

  let nodeId: string;

  it('POST /nodes/register creates a node', async () => {
    const { status, body } = await post('/nodes/register', {
      name: 'Code Analyzer',
      description: 'AST + TDD',
      capabilities: ['ast_analysis', 'tdd'],
      endpoint: 'http://localhost:4001',
      pricePerCycle: 0.001,
      creatorId: 'c1',
      tags: ['code'],
    });
    expect(status).toBe(201);
    const node = body as { id: string; name: string };
    expect(node.name).toBe('Code Analyzer');
    nodeId = node.id;
  });

  it('GET /nodes returns registered nodes', async () => {
    const { status, body } = await get('/nodes');
    expect(status).toBe(200);
    expect((body as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it('GET /nodes?capability=ast_analysis filters correctly', async () => {
    const { status, body } = await get('/nodes?capability=ast_analysis');
    expect(status).toBe(200);
    const nodes = body as { capabilities: string[] }[];
    expect(nodes.every((n) => n.capabilities.includes('ast_analysis'))).toBe(true);
  });

  it('POST /route finds the node', async () => {
    const { status, body } = await post('/route', {
      capability: 'ast_analysis',
    });
    expect(status).toBe(200);
    const result = body as { node: { name: string }; score: number };
    expect(result.node.name).toBe('Code Analyzer');
    expect(typeof result.score).toBe('number');
  });

  it('POST /route returns 404 for unknown capability', async () => {
    const { status } = await post('/route', { capability: 'does_not_exist' });
    expect(status).toBe(404);
  });

  it('POST /billing/record records cycles', async () => {
    const { status, body } = await post('/billing/record', {
      sessionId: 'sess-abc',
      nodeId,
      cyclesUsed: 5,
    });
    expect(status).toBe(201);
    const entry = body as { totalCost: number; cyclesUsed: number };
    expect(entry.cyclesUsed).toBe(5);
    expect(entry.totalCost).toBeCloseTo(0.005, 5);
  });

  it('GET /billing/:sessionId returns report', async () => {
    const { status, body } = await get('/billing/sess-abc');
    expect(status).toBe(200);
    const report = body as { totalCycles: number; totalCost: number };
    expect(report.totalCycles).toBe(5);
    expect(report.totalCost).toBeCloseTo(0.005, 5);
  });

  it('POST /nodes/:id/heartbeat succeeds', async () => {
    const { status, body } = await post(`/nodes/${nodeId}/heartbeat`, {});
    expect(status).toBe(200);
    expect((body as { success: boolean }).success).toBe(true);
  });

  it('DELETE /nodes/:id unregisters the node', async () => {
    const { status, body } = await del(`/nodes/${nodeId}`);
    expect(status).toBe(200);
    expect((body as { success: boolean }).success).toBe(true);
  });

  it('DELETE /nodes/:id returns 404 for unknown id', async () => {
    const { status } = await del('/nodes/ghost-id');
    expect(status).toBe(404);
  });

  it('GET /unknown returns 404', async () => {
    const { status } = await get('/unknown');
    expect(status).toBe(404);
  });
});
