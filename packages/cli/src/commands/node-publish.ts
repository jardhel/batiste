/**
 * batiste node publish
 *
 * Register a running node in the Batiste Marketplace.
 */

import type { Command } from 'commander';
import { loadConfig } from '../utils/config.js';
import { httpPost } from '../utils/http.js';
import { ok, fail, kv, section, bold, green } from '../utils/output.js';
import type { NodeRecord } from '@batiste/marketplace';

export function registerNodePublish(nodeCmd: Command): void {
  nodeCmd
    .command('publish')
    .description('Register a node in the Batiste Marketplace')
    .requiredOption('-n, --name <name>', 'Node display name')
    .requiredOption('-e, --endpoint <url>', 'Node endpoint URL')
    .requiredOption('-c, --capabilities <list>', 'Comma-separated capability list')
    .option('--price <number>', 'Price per compute cycle (USD)', '0.001')
    .option('--tags <list>', 'Comma-separated tag list', '')
    .option('--description <text>', 'Node description', '')
    .option('--marketplace <url>', 'Marketplace URL (overrides config)')
    .action(async (opts: {
      name: string; endpoint: string; capabilities: string; price: string;
      tags: string; description: string; marketplace?: string;
    }) => {
      const config = await loadConfig();
      const baseUrl = opts.marketplace ?? config.marketplaceUrl;

      const capabilities = opts.capabilities.split(',').map((s) => s.trim()).filter(Boolean);
      const tags = opts.tags ? opts.tags.split(',').map((s) => s.trim()).filter(Boolean) : [];
      const pricePerCycle = parseFloat(opts.price);

      section(`Publishing ${bold(opts.name)}`);
      kv('Marketplace', baseUrl);
      kv('Endpoint', opts.endpoint);
      kv('Capabilities', capabilities.join(', '));
      kv('Price/cycle', `$${pricePerCycle.toFixed(4)}`);

      try {
        const node = await httpPost(`${baseUrl}/nodes/register`, {
          name: opts.name,
          description: opts.description,
          capabilities,
          endpoint: opts.endpoint,
          pricePerCycle,
          creatorId: config.creatorId,
          tags,
        }) as NodeRecord;

        ok(`Node registered: ${green(node.id)}`);
        kv('ID', node.id);
        kv('Status', node.status);
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
