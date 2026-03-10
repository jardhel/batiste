/**
 * Transport Factory
 *
 * Unified entry point for starting an MCP server in either mode:
 * - stdio: backward compatible, uses StdioServerTransport
 * - gateway: StreamableHTTP over HTTPS with security layers
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { startGateway, type GatewayHandle, type McpServerFactory } from './secure-gateway.js';
import type { GatewayConfig } from './types.js';

export type TransportHandle = StdioHandle | GatewayHandle;

export interface StdioHandle {
  close(): Promise<void>;
  port: undefined;
}

/**
 * Start an MCP server with the specified transport.
 *
 * For stdio mode, pass a single Server instance.
 * For gateway mode, pass a factory function that creates a new Server per session.
 *
 * @param serverOrFactory - The MCP Server instance (stdio) or factory (gateway)
 * @param config - Transport configuration (default: stdio)
 */
export async function startTransport(
  serverOrFactory: Server | McpServerFactory,
  config?: Partial<GatewayConfig>,
): Promise<TransportHandle> {
  const mode = config?.mode ?? 'stdio';

  if (mode === 'gateway') {
    const factory = typeof serverOrFactory === 'function'
      ? serverOrFactory
      : () => serverOrFactory;
    return startGateway(factory, config);
  }

  // Default: stdio
  const server = typeof serverOrFactory === 'function'
    ? serverOrFactory()
    : serverOrFactory;
  const transport = new StdioServerTransport();
  await server.connect(transport);

  if (config?.label) {
    console.error(`${config.label} MCP Server started (stdio)`);
  }

  return {
    port: undefined,
    close: async () => {
      await transport.close();
    },
  };
}
