/**
 * batiste node start
 *
 * Starts a Batiste node in the foreground.
 * Supports built-in types (echo, ping) and a --config JSON file.
 *
 * For specialized nodes (code-analyzer, doc-intelligence) use the
 * respective package entry points directly.
 */

import type { Command } from 'commander';
import { createNode } from '@batiste/aidk';
import { ok, fail, info, kv, section, green, bold } from '../utils/output.js';

const ECHO_TOOLS = [
  {
    name: 'ping',
    description: 'Check node liveness. Returns "pong" with a timestamp.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'echo',
    description: 'Echo back the provided message.',
    inputSchema: {
      type: 'object' as const,
      properties: { message: { type: 'string', description: 'Text to echo' } },
      required: ['message'],
    },
  },
  {
    name: 'info',
    description: 'Return node metadata (name, version, uptime).',
    inputSchema: { type: 'object' as const, properties: {} },
  },
];

const echoHandler = {
  async handleTool(name: string, args: Record<string, unknown>) {
    switch (name) {
      case 'ping':
        return { content: [{ type: 'text' as const, text: `pong — ${new Date().toISOString()}` }] };
      case 'echo':
        return { content: [{ type: 'text' as const, text: String(args['message'] ?? '') }] };
      case 'info':
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              name: 'echo-node',
              version: '0.1.0',
              uptime: Math.floor(process.uptime()),
              pid: process.pid,
            }),
          }],
        };
      default:
        return { content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }], isError: true };
    }
  },
  async close() {},
};

export function registerNodeStart(nodeCmd: Command): void {
  nodeCmd
    .command('start')
    .description('Start a Batiste node (foreground)')
    .option('-p, --port <number>', 'Port to listen on', '4001')
    .option('--preset <preset>', 'Preset: local | network | enterprise', 'local')
    .option('--label <name>', 'Node display name', 'echo-node')
    .option('--no-audit', 'Disable audit logging')
    .action(async (opts: { port: string; preset: string; label: string; audit: boolean }) => {
      const port = parseInt(opts.port, 10);
      const preset = opts.preset as 'local' | 'network' | 'enterprise';

      section(`Starting ${bold(opts.label)}`);
      kv('Preset', preset);
      kv('Port', preset === 'local' ? 'stdio' : String(port));
      kv('Audit', String(opts.audit));

      try {
        const node = await createNode({
          config: {
            preset,
            port: preset !== 'local' ? port : undefined,
            label: opts.label,
            audit: opts.audit ? { killSwitchEnabled: true } : undefined,
          },
          tools: ECHO_TOOLS,
          handler: echoHandler,
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
