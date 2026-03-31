/**
 * Local Node — Machine A
 *
 * Starts a Batiste Node with network + auth + audit.
 * Usage: npx tsx examples/local-node/start.ts
 */

import { createNode } from '../../packages/aidk/src/index.js';

const SECRET = process.env.BATISTE_SECRET ?? 'dev-secret-key-that-is-at-least-32-characters-long';
const PORT = parseInt(process.env.PORT ?? '3100', 10);

const tools = [
  {
    name: 'echo',
    description: 'Echo back the input for testing',
    inputSchema: {
      type: 'object' as const,
      properties: { message: { type: 'string' } },
    },
  },
];

const handler = {
  async handleTool(_name: string, args: Record<string, unknown>) {
    return { echoed: args, timestamp: new Date().toISOString() };
  },
};

async function main() {
  const node = await createNode({
    config: {
      preset: 'enterprise',
      port: PORT,
      auth: { secretKey: SECRET },
      scope: { defaultPolicy: 'read-only' },
      audit: { killSwitchEnabled: true },
      label: '@batiste-aidk/example',
    },
    tools,
    handler,
  });

  console.log(`Batiste Node started on port ${node.transport.port}`);

  // Issue a demo token
  const { jwt, token } = await node.tokenIssuer!.issue({
    agentId: 'demo-agent',
    scope: {
      tools: ['echo'],
      operations: ['read'],
    },
    ttlMs: 3_600_000, // 1 hour
  });

  console.log('\n--- Demo Token ---');
  console.log(`Agent: ${token.agentId}`);
  console.log(`Expires: ${token.expiresAt}`);
  console.log(`JWT: ${jwt}`);
  console.log('\n--- Try it ---');
  console.log(`curl -X POST http://127.0.0.1:${node.transport.port}/mcp \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -H "Accept: application/json, text/event-stream" \\`);
  console.log(`  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"demo","version":"1.0.0"}},"id":1}'`);

  // Keep running
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await node.close();
    process.exit(0);
  });
}

main().catch(console.error);
