#!/usr/bin/env node

/**
 * Direct CLI for @batiste-aidk/code — bypasses MCP protocol entirely.
 *
 * Usage:
 *   batiste-direct <tool_name> [json_args]
 *   batiste-direct list
 *
 * Environment:
 *   PROJECT_ROOT — project directory (default: cwd)
 *   DATA_DIR     — batiste data directory (default: $PROJECT_ROOT/.batiste)
 *
 * Examples:
 *   batiste-direct list
 *   batiste-direct index_codebase '{"mode":"full"}'
 *   batiste-direct summarize_codebase '{"depth":"detailed"}'
 *   batiste-direct validate_code '{"paths":["src/main.ts"]}'
 *   batiste-direct manage_task '{"action":"list"}'
 */

import { join } from 'path';
import { ToolHandler } from './mcp/handler.js';
import { TOOL_DEFINITIONS } from './mcp/tools.js';
import type { ToolName } from './mcp/tools.js';

// Suppress stderr logs unless BATISTE_DEBUG is set
if (!process.env.BATISTE_DEBUG) {
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk: string | Uint8Array, ...rest: unknown[]) => {
    const str = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
    if (str.startsWith('[batiste:')) return true;
    return (origStderrWrite as Function)(chunk, ...rest);
  };
}

const PROJECT_ROOT = process.env.PROJECT_ROOT ?? process.cwd();
const DATA_DIR = process.env.DATA_DIR ?? join(PROJECT_ROOT, '.batiste');

const VALID_TOOLS = TOOL_DEFINITIONS.map(t => t.name);

async function main(): Promise<void> {
  const [command, argsJson] = process.argv.slice(2);

  if (!command || command === '--help' || command === '-h') {
    console.log(`Usage: batiste-direct <tool_name> [json_args]
       batiste-direct list

Tools: ${VALID_TOOLS.join(', ')}

Environment:
  PROJECT_ROOT  Project directory (default: cwd)
  DATA_DIR      Data directory (default: $PROJECT_ROOT/.batiste)`);
    process.exit(0);
  }

  if (command === 'list') {
    for (const tool of TOOL_DEFINITIONS) {
      console.log(`  ${tool.name.padEnd(24)} ${tool.description.slice(0, 70)}`);
    }
    process.exit(0);
  }

  if (!VALID_TOOLS.includes(command)) {
    console.error(`Unknown tool: ${command}\nAvailable: ${VALID_TOOLS.join(', ')}`);
    process.exit(1);
  }

  const args: Record<string, unknown> = argsJson ? JSON.parse(argsJson) : {};
  const handler = new ToolHandler(PROJECT_ROOT, DATA_DIR);

  const result = await handler.handleTool(command as ToolName, args);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('Error:', err.message ?? err);
  process.exit(1);
});
