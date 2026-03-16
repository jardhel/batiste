/**
 * batiste node list
 *
 * List nodes registered in the Batiste Marketplace.
 */

import type { Command } from 'commander';
import { loadConfig } from '../utils/config.js';
import { httpGet } from '../utils/http.js';
import { fail, section, table, statusBadge, latencyBadge, br, info } from '../utils/output.js';
import type { NodeRecord } from '@batiste/marketplace';

export function registerNodeList(nodeCmd: Command): void {
  nodeCmd
    .command('list')
    .description('List marketplace nodes')
    .option('--capability <c>', 'Filter by capability')
    .option('--status <s>', 'Filter by status (online|standby|offline)')
    .option('--marketplace <url>', 'Marketplace URL (overrides config)')
    .action(async (opts: { capability?: string; status?: string; marketplace?: string }) => {
      const config = await loadConfig();
      const baseUrl = opts.marketplace ?? config.marketplaceUrl;

      const params = new URLSearchParams();
      if (opts.capability) params.set('capability', opts.capability);
      if (opts.status) params.set('status', opts.status);
      const query = params.size > 0 ? `?${params.toString()}` : '';

      try {
        const nodes = await httpGet(`${baseUrl}/nodes${query}`) as NodeRecord[];
        section('Marketplace Nodes');

        if (nodes.length === 0) {
          info('No nodes found');
          return;
        }

        table(
          ['Name', 'Status', 'Capabilities', 'Latency', 'Price/cycle', 'ID'],
          nodes.map((n) => [
            n.name,
            statusBadge(n.status),
            n.capabilities.slice(0, 3).join(', '),
            latencyBadge(n.latencyMs),
            `$${n.pricePerCycle.toFixed(4)}`,
            n.id.slice(0, 8) + '…',
          ]),
        );
        br();
        info(`${nodes.length} node(s) — ${baseUrl}`);
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
