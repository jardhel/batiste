/**
 * MCP Server Factory
 *
 * Creates MCP servers with standard boilerplate:
 * - Tool registration
 * - Call handling with error formatting
 * - Stdio transport setup
 *
 * Usage:
 *   const server = createMcpServer({
 *     name: '@batiste/code',
 *     version: '1.0.0',
 *     tools: MY_TOOLS,
 *     handler: myHandler,
 *   });
 *   await startMcpServer(server);
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { McpServerConfig } from './types.js';

export function createMcpServer(config: McpServerConfig): Server {
  const server = new Server(
    {
      name: config.name,
      version: config.version,
    },
    {
      capabilities: {
        tools: {},
      },
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

  return server;
}

export async function startMcpServer(server: Server, label?: string): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  if (label) {
    console.error(`${label} MCP Server started`);
  }
}
