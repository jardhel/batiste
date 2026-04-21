/**
 * batiste vault
 *
 * Validate or index a GVS-conforming governance vault. Batiste is the
 * reference implementation of GVS 0.1; this command applies the same
 * loader and validator that the firm runs against its own vault.
 *
 * @see specs/gvs-0.1.md
 */

import type { Command } from 'commander';
import * as path from 'node:path';
import { loadVault, validateVault, AXES } from '@batiste-aidk/gvs';
import type { ValidationIssue } from '@batiste-aidk/gvs';
import {
  bold,
  cyan,
  dim,
  fail,
  gray,
  green,
  kv,
  ok,
  red,
  section,
  warn,
  yellow,
  table,
  br,
} from '../utils/output.js';

interface ValidateOpts {
  repoRoot?: string;
  json?: boolean;
  skipCanonical?: boolean;
}

interface IndexOpts {
  json?: boolean;
  axis?: string;
}

export function registerVault(program: Command): void {
  const vaultCmd = program
    .command('vault')
    .description('Operate on a GVS-conforming governance vault (spec: specs/gvs-0.1.md)');

  vaultCmd
    .command('validate <path>')
    .description('Validate a vault against GVS 0.1 §10 rules')
    .option('--repo-root <path>', 'Repository root for resolving `canonical:` paths (defaults to vault parent)')
    .option('--skip-canonical', 'Skip canonical-path resolution')
    .option('--json', 'Emit the raw report as JSON')
    .action(async (vaultPath: string, opts: ValidateOpts) => {
      try {
        const abs = path.resolve(vaultPath);
        const vault = await loadVault(abs);
        const report = await validateVault(vault, {
          repoRoot: opts.repoRoot ? path.resolve(opts.repoRoot) : undefined,
          skipCanonical: opts.skipCanonical ?? false,
        });

        if (opts.json) {
          process.stdout.write(JSON.stringify(report, null, 2) + '\n');
          process.exit(report.conforming ? 0 : 1);
        }

        section(bold('GVS 0.1 validation'));
        kv('vault', cyan(abs));
        kv('gvs_version', report.gvsVersion ?? red('(missing)'));
        kv('status', report.conforming ? green('✓ conforming') : red('✗ non-conforming'));
        kv('notes', String(report.counts.notes));
        kv('errors', report.counts.errors > 0 ? red(String(report.counts.errors)) : green('0'));
        kv('warnings', report.counts.warnings > 0 ? yellow(String(report.counts.warnings)) : green('0'));

        br();
        section(bold('Notes per axis'));
        table(
          ['axis', 'count'],
          AXES.map((a) => [a, String(report.counts.byAxis[a])]),
        );

        if (report.issues.length > 0) {
          br();
          section(bold('Issues'));
          for (const issue of report.issues) {
            printIssue(issue);
          }
        }

        br();
        process.exit(report.conforming ? 0 : 1);
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
        process.exit(2);
      }
    });

  vaultCmd
    .command('index <path>')
    .description('Index a vault and print note inventory by axis')
    .option('--axis <axis>', 'Limit to a single axis (identity|policy|roles|decision|memory|audit)')
    .option('--json', 'Emit the raw index as JSON')
    .action(async (vaultPath: string, opts: IndexOpts) => {
      try {
        const abs = path.resolve(vaultPath);
        const vault = await loadVault(abs);

        if (opts.json) {
          const serialized = {
            root: vault.root,
            gvsVersion: vault.gvsVersion,
            home: vault.home?.relativePath ?? null,
            templates: vault.templates,
            attachments: vault.attachments,
            notes: vault.all.map((n) => ({
              path: n.relativePath,
              axis: n.axis,
              title: n.title,
              status: n.frontmatter['status'] ?? null,
              wikilinks: n.wikilinks,
            })),
          };
          process.stdout.write(JSON.stringify(serialized, null, 2) + '\n');
          return;
        }

        section(bold('GVS vault index'));
        kv('root', cyan(abs));
        kv('gvs_version', vault.gvsVersion ?? dim('(unset)'));
        kv('total notes', String(vault.all.length));
        kv('templates', String(vault.templates.length));
        br();

        const axesToShow = opts.axis ? [opts.axis] : [...AXES];
        for (const a of axesToShow) {
          const axis = a as (typeof AXES)[number];
          const notes = vault.notesByAxis[axis] ?? [];
          if (notes.length === 0) continue;
          section(bold(`${axis} (${notes.length})`));
          table(
            ['status', 'title', 'path'],
            notes.map((n) => [
              String(n.frontmatter['status'] ?? '—'),
              n.title,
              gray(n.relativePath),
            ]),
          );
          br();
        }

        ok('index complete');
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
        process.exit(2);
      }
    });
}

function printIssue(issue: ValidationIssue): void {
  const label =
    issue.severity === 'error'
      ? red(`✗ ${issue.rule}`)
      : yellow(`! ${issue.rule}`);
  process.stdout.write(`  ${label}  ${cyan(issue.path)}\n    ${gray(issue.message)}\n`);
  void warn;
}
