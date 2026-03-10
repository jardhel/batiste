import { describe, it, expect, afterEach } from 'vitest';
import { request } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { startGateway, type GatewayHandle } from '../secure-gateway.js';

function createTestMcpServer(): Server {
  const server = new Server(
    { name: 'test-server', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'echo',
        description: 'Echo back the input',
        inputSchema: {
          type: 'object' as const,
          properties: { message: { type: 'string' } },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => ({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ echoed: req.params.arguments }),
      },
    ],
  }));

  return server;
}

function httpPost(
  port: number,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Content-Length': Buffer.byteLength(data).toString(),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString(),
            headers: res.headers as Record<string, string>,
          });
        });
      },
    );
    req.on('error', reject);
    req.end(data);
  });
}

function httpGet(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString(),
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('SecureGateway', () => {
  let gateway: GatewayHandle | null = null;

  afterEach(async () => {
    if (gateway) {
      await gateway.close();
      gateway = null;
    }
  });

  it('should start and respond to health check', async () => {
    gateway = await startGateway(createTestMcpServer, {
      port: 0,
      security: { tls: { enabled: false } },
    });

    const res = await httpGet(gateway.port, '/health');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.sessions).toBe(0);
  });

  it('should return 404 for unknown paths', async () => {
    gateway = await startGateway(createTestMcpServer, {
      port: 0,
      security: { tls: { enabled: false } },
    });

    const res = await httpGet(gateway.port, '/unknown');
    expect(res.status).toBe(404);
  });

  it('should handle MCP initialization', async () => {
    gateway = await startGateway(createTestMcpServer, {
      port: 0,
      security: { tls: { enabled: false } },
    });

    const initRes = await httpPost(gateway.port, '/mcp', {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
      },
      id: 1,
    });

    expect(initRes.status).toBe(200);
    const initBody = parseResponse(initRes.body);
    expect(initBody).toBeDefined();
  });

  it('should reject requests exceeding body size', async () => {
    gateway = await startGateway(createTestMcpServer, {
      port: 0,
      security: {
        tls: { enabled: false },
        maxRequestBodyBytes: 10,
      },
    });

    const res = await httpPost(gateway.port, '/mcp', {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
      },
      id: 1,
    });

    expect([413, 400]).toContain(res.status);
  });

  it('should rate limit excessive requests', async () => {
    gateway = await startGateway(createTestMcpServer, {
      port: 0,
      security: {
        tls: { enabled: false },
        rateLimit: { requestsPerMinute: 60, burstSize: 2 },
      },
    });

    const initBody = {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
      },
      id: 1,
    };

    // First 2 should succeed (burst)
    await httpPost(gateway.port, '/mcp', initBody);
    await httpPost(gateway.port, '/mcp', initBody);

    // 3rd should be rate limited
    const res = await httpPost(gateway.port, '/mcp', initBody);
    expect(res.status).toBe(429);
  }, 10_000);

  it('should reject IPs not in allowlist', async () => {
    gateway = await startGateway(createTestMcpServer, {
      port: 0,
      security: {
        tls: { enabled: false },
        ipAllowList: ['10.0.0.1'],
      },
    });

    const res = await httpPost(gateway.port, '/mcp', {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
      },
      id: 1,
    });
    expect(res.status).toBe(403);
  });

  it('should enforce max concurrent sessions', async () => {
    gateway = await startGateway(createTestMcpServer, {
      port: 0,
      maxConcurrentSessions: 1,
      security: { tls: { enabled: false } },
    });

    // First session
    const res1 = await httpPost(gateway.port, '/mcp', {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'agent-1', version: '1.0.0' },
      },
      id: 1,
    });
    expect(res1.status).toBe(200);

    // Second session should be rejected
    const res2 = await httpPost(gateway.port, '/mcp', {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'agent-2', version: '1.0.0' },
      },
      id: 1,
    });
    expect(res2.status).toBe(503);
  });
});

function parseResponse(body: string): unknown {
  if (body.startsWith('event:') || body.startsWith('data:')) {
    const lines = body.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          return JSON.parse(line.slice(6));
        } catch {
          // continue
        }
      }
    }
    return undefined;
  }
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}
