/**
 * @batiste/cli — Batiste Command Line Interface
 *
 * Entry point for the `batiste` command.
 *
 * @dogfood Built using @batiste/code analysis and validation tooling.
 */

import { Command } from 'commander';
import { loadConfig, saveConfig } from './utils/config.js';
import { ok, fail, kv, section, bold, green, br } from './utils/output.js';
import { registerNodeStart } from './commands/node-start.js';
import { registerNodePublish } from './commands/node-publish.js';
import { registerNodeList } from './commands/node-list.js';
import { registerConnect } from './commands/connect.js';
import { registerStatus } from './commands/status.js';
import { registerAuditTail } from './commands/audit-tail.js';

const program = new Command();

program
  .name('batiste')
  .description('Batiste — Autonomous Agent Compute Marketplace')
  .version('0.1.0');

// ─── node subcommand group ────────────────────────────────────────────────────

const nodeCmd = program
  .command('node')
  .description('Manage Batiste nodes');

registerNodeStart(nodeCmd);
registerNodePublish(nodeCmd);
registerNodeList(nodeCmd);

// ─── top-level commands ───────────────────────────────────────────────────────

registerConnect(program);
registerStatus(program);
registerAuditTail(program);

// ─── config command ───────────────────────────────────────────────────────────

program
  .command('config')
  .description('View or update CLI configuration')
  .option('--marketplace <url>', 'Set marketplace URL')
  .option('--gateway <url>', 'Set gateway URL')
  .option('--creator-id <id>', 'Set creator ID')
  .option('--audit-db <path>', 'Set default audit DB path')
  .action(async (opts: {
    marketplace?: string; gateway?: string;
    creatorId?: string; auditDb?: string;
  }) => {
    const updates: Record<string, string> = {};
    if (opts.marketplace) updates['marketplaceUrl'] = opts.marketplace;
    if (opts.gateway) updates['gatewayUrl'] = opts.gateway;
    if (opts.creatorId) updates['creatorId'] = opts.creatorId;
    if (opts.auditDb) updates['defaultAuditDb'] = opts.auditDb;

    if (Object.keys(updates).length > 0) {
      await saveConfig(updates);
      ok('Config saved');
    }

    const config = await loadConfig();
    section('Config');
    kv('Marketplace URL', green(config.marketplaceUrl));
    kv('Gateway URL', green(config.gatewayUrl));
    kv('Creator ID', config.creatorId);
    kv('Audit DB', config.defaultAuditDb);
    br();
  });

// ─── who command (brand) ──────────────────────────────────────────────────────

program
  .command('who')
  .description('About Batiste')
  .action(() => {
    process.stdout.write(`
  ${bold('Batiste')} ${green('·')} Autonomous Agent Compute Marketplace
  ${green('The invisible sous-chef that runs your AI stack.')}

  Eindhoven, Netherlands
  ${green('batiste.network')} — jardhel@cachola.tech

`);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
