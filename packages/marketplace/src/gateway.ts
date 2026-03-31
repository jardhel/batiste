/**
 * Marketplace Gateway
 *
 * Native Node.js HTTP server — zero framework deps (same pattern as @batiste-aidk/transport).
 *
 * Routes:
 *   POST   /nodes/register          Register a new node
 *   GET    /nodes                   List all nodes (optional ?capability= ?status=)
 *   DELETE /nodes/:id               Unregister a node
 *   POST   /nodes/:id/heartbeat     Keep-alive ping
 *   POST   /route                   Get best node for a capability
 *   POST   /billing/record          Record compute cycles
 *   GET    /billing/:sessionId      Get billing report for a session
 *   GET    /health                  Health check
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { NodeRegistry } from './registry.js';
import { NodeDiscovery } from './discovery.js';
import { RoutingLayer } from './routing.js';
import { PricingMeter } from './pricing.js';
import {
  RegisterNodeInputSchema,
  RouteRequestSchema,
  RecordCyclesInputSchema,
  NodeStatusSchema,
} from './types.js';

export interface MarketplaceGatewayOptions {
  port?: number;
  registryDbPath?: string;
  pricingDbPath?: string;
}

export interface MarketplaceHandle {
  close(): Promise<void>;
  port: number;
  registry: NodeRegistry;
  pricing: PricingMeter;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function parseId(url: string, prefix: string): string | null {
  const rest = url.slice(prefix.length);
  const id = rest.split('/')[0] ?? '';
  return id.length > 0 ? id : null;
}

export async function startMarketplace(
  options: MarketplaceGatewayOptions = {},
): Promise<MarketplaceHandle> {
  const {
    port = 3100,
    registryDbPath = ':memory:',
    pricingDbPath = ':memory:',
  } = options;

  const registry = new NodeRegistry(registryDbPath);
  const pricing = new PricingMeter(pricingDbPath);
  const discovery = new NodeDiscovery(registry);
  const router = new RoutingLayer(discovery);

  // Prune stale nodes every 30s
  const pruneInterval = setInterval(() => registry.pruneStale(), 30_000);

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // GET /health
      if (url === '/health' && method === 'GET') {
        json(res, 200, {
          status: 'ok',
          nodes: registry.list().length,
          online: registry.list({ status: 'online' }).length,
          uptime: process.uptime(),
        });
        return;
      }

      // POST /nodes/register
      if (url === '/nodes/register' && method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const input = RegisterNodeInputSchema.parse(body);
        const node = registry.register(input);
        json(res, 201, node);
        return;
      }

      // GET /nodes
      if (url.startsWith('/nodes') && method === 'GET' && !url.includes('/heartbeat')) {
        const urlObj = new URL(url, 'http://localhost');
        const capability = urlObj.searchParams.get('capability') ?? undefined;
        const statusParam = urlObj.searchParams.get('status') ?? undefined;
        const status = statusParam ? NodeStatusSchema.parse(statusParam) : undefined;

        if (capability) {
          const nodes = discovery.search({ capability, status });
          json(res, 200, nodes);
        } else {
          const nodes = registry.list(status ? { status } : undefined);
          json(res, 200, nodes);
        }
        return;
      }

      // POST /nodes/:id/heartbeat
      if (url.startsWith('/nodes/') && url.endsWith('/heartbeat') && method === 'POST') {
        const id = url.slice('/nodes/'.length, url.length - '/heartbeat'.length);
        if (!id) { json(res, 400, { error: 'Missing node id' }); return; }
        const ok = registry.heartbeat(id);
        json(res, ok ? 200 : 404, { success: ok });
        return;
      }

      // DELETE /nodes/:id
      if (url.startsWith('/nodes/') && method === 'DELETE') {
        const id = parseId(url, '/nodes/');
        if (!id) { json(res, 400, { error: 'Missing node id' }); return; }
        const ok = registry.unregister(id);
        json(res, ok ? 200 : 404, { success: ok });
        return;
      }

      // POST /route
      if (url === '/route' && method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const request = RouteRequestSchema.parse(body);
        const result = router.route(request);
        if (!result) {
          json(res, 404, { error: 'No eligible node found', capability: request.capability });
          return;
        }
        json(res, 200, result);
        return;
      }

      // POST /billing/record
      if (url === '/billing/record' && method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const input = RecordCyclesInputSchema.parse(body);
        const node = registry.get(input.nodeId);
        if (!node) {
          json(res, 404, { error: 'Node not found' });
          return;
        }
        const entry = pricing.record(
          input.sessionId,
          input.nodeId,
          node.name,
          node.pricePerCycle,
          input.cyclesUsed,
        );
        // Update reliability for successful cycle recording
        registry.updateReliability(input.nodeId, true);
        json(res, 201, entry);
        return;
      }

      // GET /billing/:sessionId
      if (url.startsWith('/billing/') && method === 'GET') {
        const sessionId = parseId(url, '/billing/');
        if (!sessionId) { json(res, 400, { error: 'Missing sessionId' }); return; }
        const report = pricing.getReport(sessionId);
        json(res, 200, report);
        return;
      }

      json(res, 404, { error: 'Not Found', url });
    } catch (err) {
      const isValidation = err instanceof Error && err.constructor.name === 'ZodError';
      json(res, isValidation ? 400 : 500, {
        error: isValidation ? 'Validation error' : 'Internal server error',
        details: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const server: Server = createServer((req, res) => {
    void handler(req, res);
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  const actualPort = (server.address() as { port: number }).port;

  return {
    port: actualPort,
    registry,
    pricing,
    close: () =>
      new Promise<void>((resolve, reject) => {
        clearInterval(pruneInterval);
        server.close((err) => (err ? reject(err) : resolve()));
        registry.close();
        pricing.close();
      }),
  };
}
