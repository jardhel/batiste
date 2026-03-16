/**
 * batiste connect
 *
 * Route to the best available node for a capability and print
 * the connection details.
 */

import type { Command } from 'commander';
import { loadConfig } from '../utils/config.js';
import { httpPost } from '../utils/http.js';
import { ok, fail, kv, section, bold, green, latencyBadge, statusBadge } from '../utils/output.js';
import type { RoutedNode } from '@batiste/marketplace';

export function registerConnect(program: Command): void {
  program
    .command('connect')
    .description('Route to the best node for a capability')
    .requiredOption('-c, --capability <c>', 'Capability to request')
    .option('--max-price <number>', 'Max price per cycle')
    .option('--tags <list>', 'Prefer nodes with these tags (comma-separated)')
    .option('--marketplace <url>', 'Marketplace URL (overrides config)')
    .action(async (opts: {
      capability: string; maxPrice?: string; tags?: string; marketplace?: string;
    }) => {
      const config = await loadConfig();
      const baseUrl = opts.marketplace ?? config.marketplaceUrl;

      const payload: {
        capability: string;
        maxPricePerCycle?: number;
        preferTags?: string[];
      } = { capability: opts.capability };
      if (opts.maxPrice) payload.maxPricePerCycle = parseFloat(opts.maxPrice);
      if (opts.tags) payload.preferTags = opts.tags.split(',').map((s) => s.trim());

      try {
        const result = await httpPost(`${baseUrl}/route`, payload) as RoutedNode;
        const { node, score } = result;

        section(`Connected to ${bold(node.name)}`);
        ok(`Routed with score ${green(score.toFixed(3))}`);
        kv('Node ID', node.id);
        kv('Status', statusBadge(node.status));
        kv('Endpoint', node.endpoint);
        kv('Latency', latencyBadge(node.latencyMs));
        kv('Reliability', `${(node.reliability * 100).toFixed(1)}%`);
        kv('Price/cycle', `$${node.pricePerCycle.toFixed(4)}`);
        kv('Capabilities', node.capabilities.join(', '));

        process.stdout.write('\nMCP endpoint:\n');
        process.stdout.write(`  ${green(node.endpoint + '/mcp')}\n\n`);
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
