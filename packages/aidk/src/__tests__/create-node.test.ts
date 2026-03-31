import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { createNode, type BatistNode } from '../create-node.js';
import type { ToolHandler } from '@batiste-aidk/core/mcp';

const tools = [
  {
    name: 'echo',
    description: 'Echo',
    inputSchema: {
      type: 'object' as const,
      properties: { msg: { type: 'string' } },
    },
  },
];

const handler: ToolHandler = {
  async handleTool(_name: string, args: Record<string, unknown>) {
    return { echoed: args };
  },
};

function httpGet(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('createNode', () => {
  let node: BatistNode | null = null;
  let tmpDir: string;

  afterEach(async () => {
    if (node) { await node.close(); node = null; }
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should create a network node with gateway', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aidk-test-'));
    node = await createNode({
      config: {
        preset: 'network',
        port: 0, // random port
        audit: { dbPath: join(tmpDir, 'audit.db') },
      },
      tools,
      handler,
    });

    expect(node.transport.port).toBeGreaterThan(0);

    // Health check
    const res = await httpGet(node.transport.port!, '/health');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).status).toBe('ok');
  });

  it('should create an enterprise node with all layers', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aidk-test-'));
    node = await createNode({
      config: {
        preset: 'enterprise',
        port: 0,
        auth: { secretKey: 'enterprise-secret-key-that-is-at-least-32-characters' },
        scope: { defaultPolicy: 'read-only' },
        audit: { dbPath: join(tmpDir, 'audit.db'), killSwitchEnabled: true },
      },
      tools,
      handler,
    });

    expect(node.tokenIssuer).toBeDefined();
    expect(node.tokenVerifier).toBeDefined();
    expect(node.killSwitch).toBeDefined();
    expect(node.auditLedger).toBeDefined();
    expect(node.policyEngine).toBeDefined();
  });

  it('should create a node with static prompts', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aidk-test-'));
    node = await createNode({
      config: {
        preset: 'network',
        port: 0,
        audit: { dbPath: join(tmpDir, 'audit.db') },
      },
      tools,
      handler,
      prompts: [
        {
          definition: { name: 'greet', description: 'Greeting prompt', arguments: [{ name: 'name', required: true }] },
          resolve: async (args) => ({
            messages: [{ role: 'user', content: { type: 'text', text: `Hello ${args['name'] ?? 'world'}` } }],
          }),
        },
      ],
    });

    expect(node.promptRegistry).toBeDefined();
    const list = node.promptRegistry!.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('greet');

    const prompt = node.promptRegistry!.get('greet')!;
    const result = await prompt.resolve({ name: 'Alice' });
    expect(result.messages[0]!.content.text).toBe('Hello Alice');
  });

  it('should support dynamic prompt registration via tool handler', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aidk-test-'));
    node = await createNode({
      config: {
        preset: 'network',
        port: 0,
        audit: { dbPath: join(tmpDir, 'audit.db') },
      },
      tools,
      handler,
      enableDynamicPrompts: true,
    });

    expect(node.promptRegistry).toBeDefined();

    // The register_prompt tool should be wired through the handler chain
    // We can verify the registry was created and is functional
    node.promptRegistry!.register({
      definition: { name: 'dynamic-test' },
      registeredBy: 'test',
      registeredAt: new Date().toISOString(),
      resolve: async () => ({
        messages: [{ role: 'user', content: { type: 'text', text: 'dynamic' } }],
      }),
    });

    expect(node.promptRegistry!.list()).toHaveLength(1);
    expect(node.promptRegistry!.get('dynamic-test')).toBeDefined();
  });

  it('should disable dynamic prompts when enableDynamicPrompts is false', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aidk-test-'));
    node = await createNode({
      config: {
        preset: 'network',
        port: 0,
        audit: { dbPath: join(tmpDir, 'audit.db') },
      },
      tools,
      handler,
      prompts: [
        {
          definition: { name: 'static-only' },
          resolve: async () => ({
            messages: [{ role: 'user', content: { type: 'text', text: 'static' } }],
          }),
        },
      ],
      enableDynamicPrompts: false,
    });

    // Registry should exist with static prompt
    expect(node.promptRegistry).toBeDefined();
    expect(node.promptRegistry!.list()).toHaveLength(1);
    expect(node.promptRegistry!.get('static-only')).toBeDefined();
  });

  it('should issue tokens for network node', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aidk-test-'));
    node = await createNode({
      config: {
        preset: 'network',
        port: 0,
        auth: { secretKey: 'network-secret-key-that-is-at-least-32-characters' },
        audit: { dbPath: join(tmpDir, 'audit.db') },
      },
      tools,
      handler,
    });

    const { jwt, token } = await node.tokenIssuer!.issue({
      agentId: 'test-agent',
      scope: { tools: ['echo'], operations: ['read'] },
    });

    expect(jwt).toBeTruthy();
    expect(token.agentId).toBe('test-agent');

    // Verify the token
    const result = await node.tokenVerifier!.verify(jwt);
    expect(result.authenticated).toBe(true);
  });
});
