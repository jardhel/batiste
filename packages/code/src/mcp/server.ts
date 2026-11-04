/**
 * @batiste-aidk/code MCP Server
 *
 * Entry point for the MCP server. Uses createMcpServer from @batiste-aidk/core.
 */

import { bootLog } from './boot-log.js';
import { join } from 'path';
import { realpathSync } from 'fs';
import { fileURLToPath } from 'url';
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
  bootLog('listening');
}

// Run if executed directly
// Comparacao por caminho real: `file://${argv[1]}` falhava em silencio (exit 0 sem servir) com
// symlink, espaco ou caractere escapado no caminho.
function isMain(): boolean {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
if (isMain()) {
  start().catch((err) => {
    bootLog('failed', { error: String(err?.message ?? err) });
    console.error(err);
    process.exit(1);
  });
}
