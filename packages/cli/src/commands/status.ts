/**
 * batiste status
 *
 * Show live health and performance metrics from a running Batiste gateway.
 */

import type { Command } from 'commander';
import { loadConfig } from '../utils/config.js';
import { httpGet } from '../utils/http.js';
import { ok, fail, kv, section, bold, green, latencyBadge, statusBadge, warn } from '../utils/output.js';
import type { PerformanceMetrics } from '@batiste-aidk/transport';

interface HealthResponse {
  status: string;
  sessions: number;
  uptime: number;
}

interface MarketplaceHealth {
  status: string;
  nodes: number;
  online: number;
  uptime: number;
}

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('Show gateway health and performance metrics')
    .option('--gateway <url>', 'Gateway URL (overrides config)')
    .option('--marketplace <url>', 'Marketplace URL (overrides config)')
    .option('--watch', 'Refresh every 5 seconds')
    .action(async (opts: { gateway?: string; marketplace?: string; watch?: boolean }) => {
      const config = await loadConfig();
      const gatewayUrl = opts.gateway ?? config.gatewayUrl;
      const marketplaceUrl = opts.marketplace ?? config.marketplaceUrl;

      const printStatus = async () => {
        // Clear screen in watch mode
        if (opts.watch) process.stdout.write('\x1b[2J\x1b[H');

        section(bold('Batiste Status'));

        // Gateway
        try {
          const health = await httpGet(`${gatewayUrl}/health`) as HealthResponse;
          const metrics = await httpGet(`${gatewayUrl}/metrics`) as PerformanceMetrics;
          ok(`Gateway ${green(gatewayUrl)}`);
          kv('Status', statusBadge(health.status));
          kv('Sessions', String(health.sessions));
          kv('Uptime', formatUptime(health.uptime));
          kv('p50 latency', latencyBadge(metrics.p50));
          kv('p95 latency', latencyBadge(metrics.p95));
          kv('p99 latency', latencyBadge(metrics.p99));
          kv('Reliability', `${(metrics.reliability * 100).toFixed(1)}%`);
          kv('Samples (1h)', String(metrics.sampleCount));
        } catch {
          warn(`Gateway unreachable: ${gatewayUrl}`);
        }

        process.stdout.write('\n');

        // Marketplace
        try {
          const mHealth = await httpGet(`${marketplaceUrl}/health`) as MarketplaceHealth;
          ok(`Marketplace ${green(marketplaceUrl)}`);
          kv('Status', statusBadge(mHealth.status));
          kv('Nodes (total)', String(mHealth.nodes));
          kv('Nodes (online)', String(mHealth.online));
          kv('Uptime', formatUptime(mHealth.uptime));
        } catch {
          warn(`Marketplace unreachable: ${marketplaceUrl}`);
        }

        if (opts.watch) {
          process.stdout.write(`\n${green('◉')} watching — Ctrl+C to stop\n`);
        }
      };

      if (opts.watch) {
        const tick = async () => { await printStatus(); };
        await tick();
        const interval = setInterval(() => { void tick(); }, 5_000);
        process.on('SIGINT', () => { clearInterval(interval); process.exit(0); });
      } else {
        try {
          await printStatus();
        } catch (err) {
          fail(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      }
    });
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
