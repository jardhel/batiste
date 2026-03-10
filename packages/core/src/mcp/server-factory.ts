/**
 * MCP Server Factory
 *
 * Creates MCP servers with standard boilerplate:
 * - Tool registration
 * - Call handling with error formatting
 * - Stdio transport setup (default)
 * - StreamableHTTP gateway transport (opt-in)
 *
 * Usage:
 *   const server = createMcpServer({
 *     name: '@batiste/code',
 *     version: '1.0.0',
 *     tools: MY_TOOLS,
 *     handler: myHandler,
 *   });
 *   await startMcpServer(server);                          // stdio
 *   await startMcpServer(server, { mode: 'gateway' });     // HTTP
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { McpServerConfig, TransportConfig } from './types.js';

export function createMcpServer(config: McpServerConfig): Server {
  const capabilities: Record<string, Record<string, unknown>> = {
    tools: {},
  };

  if (config.promptRegistry) {
    capabilities['prompts'] = { listChanged: true };
  }

  const server = new Server(
    {
      name: config.name,
      version: config.version,
    },
    {
      capabilities,
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: config.tools,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const result = await config.handler.handleTool(name, args ?? {});
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              error: true,
              message: error instanceof Error ? error.message : String(error),
            }),
          },
        ],
        isError: true,
      };
    }
  });

  // Prompt handlers
  if (config.promptRegistry) {
    const registry = config.promptRegistry;

    server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: registry.list(),
    }));

    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const prompt = registry.get(name);

      if (!prompt) {
        throw new Error(`Unknown prompt: ${name}`);
      }

      return prompt.resolve(args ?? {});
    });

    // Notify clients when prompts change
    registry.onChange(() => {
      server.sendPromptListChanged().catch(() => {
        // Ignore notification errors (e.g. no connected clients)
      });
    });
  }

  return server;
}

/** Start with stdio transport (backward compatible signature) */
export async function startMcpServer(server: Server, label?: string): Promise<void>;
/** Start with explicit transport config */
export async function startMcpServer(server: Server, config: TransportConfig & { label?: string }): Promise<void>;
export async function startMcpServer(
  server: Server,
  configOrLabel?: string | (TransportConfig & { label?: string }),
): Promise<void> {
  const config: TransportConfig & { label?: string } =
    typeof configOrLabel === 'string'
      ? { mode: 'stdio', label: configOrLabel }
      : configOrLabel ?? { mode: 'stdio' };

  if (config.mode === 'gateway') {
    return startGateway(server, config);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  if (config.label) {
    console.error(`${config.label} MCP Server started (stdio)`);
  }
}

async function startGateway(
  server: Server,
  config: TransportConfig & { label?: string },
): Promise<void> {
  const port = config.port ?? 3100;
  const host = config.host ?? '127.0.0.1';
  const stateful = config.stateful ?? true;

  // Map of sessionId -> transport for stateful mode
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';

    // Health check
    if (url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', sessions: sessions.size }));
      return;
    }

    // Only handle /mcp
    if (url !== '/mcp') {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    // Parse body for POST
    if (req.method === 'POST') {
      const body = await readBody(req);

      if (stateful) {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;

        if (sessionId && sessions.has(sessionId)) {
          // Existing session
          const transport = sessions.get(sessionId)!;
          await transport.handleRequest(req, res, body);
        } else if (!sessionId) {
          // New session — create transport
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => {
              sessions.set(id, transport);
            },
          });

          transport.onclose = () => {
            if (transport.sessionId) {
              sessions.delete(transport.sessionId);
            }
          };

          await server.connect(transport);
          await transport.handleRequest(req, res, body);
        } else {
          // Invalid session ID
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Invalid session ID' },
            id: null,
          }));
        }
      } else {
        // Stateless — new transport per request
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
      }
      return;
    }

    if (req.method === 'GET') {
      if (stateful) {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (sessionId && sessions.has(sessionId)) {
          const transport = sessions.get(sessionId)!;
          await transport.handleRequest(req, res);
          return;
        }
      }
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed' },
        id: null,
      }));
      return;
    }

    if (req.method === 'DELETE') {
      if (stateful) {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (sessionId && sessions.has(sessionId)) {
          const transport = sessions.get(sessionId)!;
          await transport.handleRequest(req, res);
          sessions.delete(sessionId);
          return;
        }
      }
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed' },
        id: null,
      }));
      return;
    }

    res.writeHead(405);
    res.end('Method Not Allowed');
  });

  return new Promise<void>((resolve) => {
    httpServer.listen(port, host, () => {
      if (config.label) {
        console.error(`${config.label} MCP Server started (gateway) on ${host}:${port}`);
      }
      resolve();
    });
  });
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : undefined);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}
