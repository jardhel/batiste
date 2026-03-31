/**
 * @batiste-aidk/code MCP Server
 *
 * Entry point for the MCP server. Uses createMcpServer from @batiste-aidk/core.
 */

import { join } from 'path';
import { createMcpServer, startMcpServer } from '@batiste-aidk/core/mcp';
import { TOOL_DEFINITIONS } from './tools.js';
import { ToolHandler } from './handler.js';

const PROJECT_ROOT = process.env.PROJECT_ROOT ?? process.cwd();
const DATA_DIR = process.env.DATA_DIR ?? join(PROJECT_ROOT, '.batiste');

export async function start(): Promise<void> {
  const handler = new ToolHandler(PROJECT_ROOT, DATA_DIR);

  const server = createMcpServer({
    name: '@batiste-aidk/code',
    version: '0.1.0',
    tools: TOOL_DEFINITIONS,
    handler,
  });

  await startMcpServer(server, '@batiste-aidk/code');
}

// Run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  start().catch(console.error);
}
