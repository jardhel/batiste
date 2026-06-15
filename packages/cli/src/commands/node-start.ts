/**
 * batiste node start
 *
 * Starts a Batiste node in the foreground.
 *
 * The default node serves the REAL deterministic toolset:
 *   - @batiste-aidk/code      → analyze_dependency, find_symbol, index_codebase,
 *                               validate_code, manage_task, summarize_codebase, …
 *   - @batiste-aidk/connectors → parse_pdf, query_csv, csv_stats
 *   - built-in liveness        → ping, info
 *
 * Tools operate against PROJECT_ROOT (default: cwd) and persist state under
 * DATA_DIR (default: $PROJECT_ROOT/.batiste). Connect with any MCP client over
 * stdio (preset=local) or HTTP (preset=network|enterprise).
 */

import { join } from 'node:path';
import type { Command } from 'commander';
import { createNode } from '@batiste-aidk/aidk';
import {
  TOOL_DEFINITIONS,
  ToolHandler,
  type ToolName,
} from '@batiste-aidk/code';
import {
  CONNECTOR_TOOLS,
  ConnectorHandler,
  type ConnectorToolName,
} from '@batiste-aidk/connectors';
import { ok, fail, info, kv, section, green, bold } from '../utils/output.js';

/**
 * Liveness tools that the node owns directly (not from a sub-package).
 * `info` reports the actual wired toolset so the node never over-claims.
 */
const LIVENESS_TOOLS = [
  {
    name: 'ping',
    description: 'Check node liveness. Returns "pong" with a timestamp.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'info',
    description: 'Return node metadata: label, version, uptime, and the wired toolset.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
];

type WireTool = {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
};

const CONNECTOR_TOOL_NAMES = new Set<string>(CONNECTOR_TOOLS.map((t) => t.name));

// Tools deliberately NOT advertised on the default node. orchestrate_agents
// drives the CoderAgent/ReviewerAgent stubs (roadmap, not shipped autonomy);
// advertising it would re-introduce the autonomy over-claim we removed from the
// docs. Excluded from both the advertised list and the dispatch table (calling
// it returns "Unknown tool") until those agents do real work.
const EXCLUDED_CODE_TOOLS = new Set<string>(['orchestrate_agents']);
const CODE_TOOL_DEFS = TOOL_DEFINITIONS.filter((t) => !EXCLUDED_CODE_TOOLS.has(t.name));
const CODE_TOOL_NAMES = new Set<string>(CODE_TOOL_DEFS.map((t) => t.name));

// CONNECTOR_TOOLS is declared `as const` (readonly tuple + readonly `required`),
// so we project it into the mutable ToolDefinition shape the node API expects.
const CONNECTOR_TOOL_DEFS: WireTool[] = CONNECTOR_TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: {
    type: 'object',
    properties: t.inputSchema.properties as Record<string, unknown>,
    required: t.inputSchema.required ? [...t.inputSchema.required] : undefined,
  },
}));

/**
 * The default node's advertised toolset = built-in liveness + the real
 * deterministic tools from @batiste-aidk/code and @batiste-aidk/connectors.
 * Every advertised name is dispatched to a real handler below — there is no
 * tool here that resolves to "Unknown tool".
 */
const DEFAULT_TOOLS: WireTool[] = [
  ...LIVENESS_TOOLS,
  ...CODE_TOOL_DEFS,
  ...CONNECTOR_TOOL_DEFS,
];

/**
 * Composite handler that routes each advertised tool to the package that
 * actually implements it. Returns raw result objects; the MCP server factory
 * wraps them in the `{ content: [...] }` envelope (server-factory.ts).
 */
function createDefaultHandler(projectRoot: string, dataDir: string) {
  const codeHandler = new ToolHandler(projectRoot, dataDir);
  const connectorHandler = new ConnectorHandler(projectRoot);
  const startedAt = Date.now();

  return {
    async handleTool(name: string, args: Record<string, unknown>): Promise<unknown> {
      if (name === 'ping') {
        return { pong: true, timestamp: new Date().toISOString() };
      }
      if (name === 'info') {
        return {
          label: 'batiste-default-node',
          version: '0.1.0',
          uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
          pid: process.pid,
          projectRoot,
          dataDir,
          tools: {
            liveness: LIVENESS_TOOLS.map((t) => t.name),
            code: [...CODE_TOOL_NAMES],
            connectors: [...CONNECTOR_TOOL_NAMES],
          },
        };
      }
      if (CODE_TOOL_NAMES.has(name)) {
        return codeHandler.handleTool(name as ToolName, args);
      }
      if (CONNECTOR_TOOL_NAMES.has(name)) {
        return connectorHandler.handleTool(name as ConnectorToolName, args);
      }
      throw new Error(`Unknown tool: ${name}`);
    },
    async close(): Promise<void> {
      await codeHandler.close?.();
      connectorHandler.close?.();
    },
  };
}

export function registerNodeStart(nodeCmd: Command): void {
  nodeCmd
    .command('start')
    .description('Start a Batiste node (foreground)')
    .option('-p, --port <number>', 'Port to listen on', '4001')
    .option('--preset <preset>', 'Preset: local | network | enterprise', 'local')
    .option('--label <name>', 'Node display name', 'batiste-default-node')
    .option('--project-root <path>', 'Project directory the tools operate on', process.cwd())
    .option('--data-dir <path>', 'Batiste data directory (default: <project-root>/.batiste)')
    .option('--no-audit', 'Disable audit logging')
    .action(async (opts: {
      port: string;
      preset: string;
      label: string;
      projectRoot: string;
      dataDir?: string;
      audit: boolean;
    }) => {
      const port = parseInt(opts.port, 10);
      const preset = opts.preset as 'local' | 'network' | 'enterprise';
      const projectRoot = opts.projectRoot;
      const dataDir = opts.dataDir ?? join(projectRoot, '.batiste');

      section(`Starting ${bold(opts.label)}`);
      kv('Preset', preset);
      kv('Port', preset === 'local' ? 'stdio' : String(port));
      kv('Project root', projectRoot);
      kv('Data dir', dataDir);
      kv('Audit', String(opts.audit));
      kv('Tools', `${DEFAULT_TOOLS.length} (code + connectors + liveness)`);

      try {
        const handler = createDefaultHandler(projectRoot, dataDir);
        const node = await createNode({
          config: {
            preset,
            port: preset !== 'local' ? port : undefined,
            label: opts.label,
            audit: opts.audit ? { killSwitchEnabled: true } : undefined,
          },
          tools: DEFAULT_TOOLS,
          handler,
        });

        if (preset === 'local') {
          info('Node running via stdio — connect with your MCP client');
        } else {
          ok(`Node listening on ${green(`http://localhost:${port}/mcp`)}`);
          info('Press Ctrl+C to stop');
        }

        const shutdown = async () => {
          info('Shutting down…');
          await node.close();
          process.exit(0);
        };
        process.on('SIGINT', () => { void shutdown(); });
        process.on('SIGTERM', () => { void shutdown(); });

        // Keep alive (gateway mode runs its own HTTP server)
        if (preset === 'local') {
          // stdio mode: process stays alive while MCP transport is active
        }
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
