/**
 * @batiste-aidk/atrium · entry point for the `batiste-fm` CLI.
 *
 * Atrium is the entry hall to a Batiste deployment's Firm Memory:
 * ingestion (Claude Code memory + sessions, vault, Drive, Trello) and
 * retrieval. Every mutation is audit-emitted before it commits, per
 * ADR-0002 §"Replication flows" and ADR-0006 §"Atrium owns the mutation
 * guarantees".
 *
 * The package surface is intentionally narrow: a CLI binary plus a few
 * exported types so that programmatic callers (the Cachola Tech
 * deployment GUI, the future SessionStart hook) can reuse the same
 * ingestion functions without re-implementing them.
 */

import { Command } from 'commander';
import { registerCompile } from './commands/compile.js';
import { registerIngest } from './commands/ingest.js';
import { registerInstall } from './commands/install.js';
import { registerRetrieve } from './commands/retrieve.js';
import { registerSync } from './commands/sync.js';
import { registerTokenReport } from './commands/token-report.js';
import { bold, cyan, fail, gray, green } from './utils/output.js';

export { resolvePaths, ensureFmRoot } from './utils/data-dir.js';
export type { AtriumPaths } from './utils/data-dir.js';
export { withAudit } from './audit-wrap.js';
export type { AuditedRunContext } from './audit-wrap.js';

const program = new Command();

program
  .name('batiste-fm')
  .description('Firm Memory operator — ingest sources, retrieve chunks, audit every mutation')
  .version('0.1.0');

registerIngest(program);
registerRetrieve(program);
registerTokenReport(program);
registerInstall(program);
registerSync(program);
registerCompile(program);

program
  .command('paths')
  .description('Print the resolved Firm Memory paths and namespace for this deployment')
  .action(async () => {
    const { resolvePaths } = await import('./utils/data-dir.js');
    const paths = resolvePaths();
    process.stdout.write(`${bold('Firm Memory deployment')}\n`);
    process.stdout.write(`  ${gray('FM root      ')} ${green(paths.fmRoot)}\n`);
    process.stdout.write(`  ${gray('Audit ledger ')} ${green(paths.auditDbPath)}\n`);
    process.stdout.write(`  ${gray('Checkpoints  ')} ${green(paths.checkpointPath)}\n`);
    process.stdout.write(`  ${gray('Namespace    ')} ${cyan(paths.namespace)}\n`);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
