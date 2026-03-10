/**
 * Remote Agent — Machine B
 *
 * Connects to a Batiste Node over HTTP and makes MCP requests.
 * Usage: npx tsx examples/remote-agent/agent.ts <jwt-token>
 */

import { request } from 'node:http';

const PORT = parseInt(process.env.PORT ?? '3100', 10);
const HOST = process.env.HOST ?? '127.0.0.1';

function httpPost(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = request(
      {
        hostname: HOST,
        port: PORT,
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

async function main() {
  console.log(`Connecting to Batiste Node at ${HOST}:${PORT}...`);

  // Step 1: Initialize MCP session
  console.log('\n--- Step 1: Initialize ---');
  const initRes = await httpPost('/mcp', {
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'remote-agent', version: '1.0.0' },
    },
    id: 1,
  });

  console.log(`Status: ${initRes.status}`);
  console.log(`Session: ${initRes.headers['mcp-session-id'] ?? 'none'}`);

  const sessionId = initRes.headers['mcp-session-id'];

  if (initRes.status !== 200) {
    console.error('Failed to initialize:', initRes.body);
    return;
  }

  // Step 2: List tools
  console.log('\n--- Step 2: List Tools ---');
  const toolsRes = await httpPost('/mcp', {
    jsonrpc: '2.0',
    method: 'tools/list',
    id: 2,
  }, sessionId ? { 'mcp-session-id': sessionId } : {});

  console.log(`Status: ${toolsRes.status}`);
  console.log('Tools:', toolsRes.body.substring(0, 200));

  // Step 3: Call echo tool
  console.log('\n--- Step 3: Call Tool ---');
  const callRes = await httpPost('/mcp', {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'echo',
      arguments: { message: 'Hello from remote agent!' },
    },
    id: 3,
  }, sessionId ? { 'mcp-session-id': sessionId } : {});

  console.log(`Status: ${callRes.status}`);
  console.log('Response:', callRes.body.substring(0, 300));

  console.log('\n--- E2E Complete ---');
}

main().catch(console.error);
