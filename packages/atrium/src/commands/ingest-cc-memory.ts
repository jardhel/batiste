/**
 * batiste-fm ingest cc-memory
 *
 * Drains every Claude Code per-CWD auto-memory directory
 * (`~/.claude/projects/*\/memory/*.md`) into Firm Memory, classifying
 * entries by frontmatter type, deduplicating by content hash, and emitting
 * an audit ledger entry per mutation. Idempotent: re-runs are no-ops if
 * nothing changed.
 *
 * After import succeeds the operator can run `--stub-replace` to overwrite
 * each silo's `MEMORY.md` index with a pointer stub (per ADR-0006), which
 * quiesces future Claude Code auto-writes in those directories.
 */

import type { Command } from 'commander';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, cpus } from 'node:os';
import { basename, join, relative } from 'node:path';
import { openFirmMemory, type FactEntry } from '@batiste-aidk/memory';
import { AuditLedger } from '@batiste-aidk/audit';
import { ensureFmRoot, resolvePaths } from '../utils/data-dir.js';
import { parseFrontmatter } from '../utils/frontmatter.js';
import { shortHash } from '../utils/hash.js';
import { scrub } from '../utils/scrub.js';
import { Plan } from '@batiste-aidk/parallel';
import { withAudit } from '../audit-wrap.js';
import { cyan, gray, green, kv, ok, Progress, section, warn, yellow } from '../utils/output.js';
import { loadCheckpoints, saveCheckpoints, setCheckpoint } from '../utils/checkpoint.js';
import { buildAtriumExecutor } from '../utils/parallel-bridge.js';

const DEFAULT_CONCURRENCY = Math.max(1, Math.floor(cpus().length / 2));

const STUB_TEMPLATE = (importedAt: string, fmRoot: string): string =>
  `# Memory has moved to Cachola Tech Firm Memory.\n\n` +
  `This deployment's memory now lives in \`${fmRoot}\`.\n` +
  `Query: \`batiste-fm retrieve "<your query>"\`\n\n` +
  `Original entries imported on ${importedAt}; provenance refs in the deployment audit ledger.\n` +
  `See ADR-0006 (Claude Code auto-memory deprecation via Atrium) for context.\n`;

interface ImportRecord {
  filePath: string;
  cwdDir: string;
  meta: Record<string, string>;
  body: string;
}

async function discoverMemoryFiles(projectsRoot: string): Promise<ImportRecord[]> {
  const out: ImportRecord[] = [];
  if (!existsSync(projectsRoot)) return out;
  const entries = await readdir(projectsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const memDir = join(projectsRoot, entry.name, 'memory');
    if (!existsSync(memDir)) continue;
    const files = await readdir(memDir);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      if (file === 'MEMORY.md') continue; // index, not an entry
      const fullPath = join(memDir, file);
      const raw = await readFile(fullPath, 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      out.push({ filePath: fullPath, cwdDir: entry.name, meta, body });
    }
  }
  return out;
}

function classifyType(meta: Record<string, string>): 'user' | 'feedback' | 'project' | 'reference' {
  const t = (meta.type ?? '').toLowerCase();
  if (t === 'user' || t === 'feedback' || t === 'project' || t === 'reference') return t;
  return 'project';
}

function memoryToFact(record: ImportRecord, fallbackTitle: string): FactEntry {
  const type = classifyType(record.meta);
  const kind: FactEntry['kind'] =
    type === 'feedback' ? 'decision' :
    type === 'reference' ? 'precedent' :
    'observation';
  const { text: scrubbed, hits } = scrub(record.body);
  const id = shortHash(`${record.filePath}::${scrubbed}`);
  const now = new Date().toISOString();
  const tags = [
    'source:cc-memory',
    `cwd:${record.cwdDir}`,
    `meta-type:${type}`,
    ...(hits.length > 0 ? [`scrubbed:${hits.map((h) => h.pattern).join(',')}`] : []),
  ];
  return {
    id,
    kind,
    title: record.meta.name ?? fallbackTitle,
    body: scrubbed,
    workstream: basename(record.cwdDir).replace(/^-+/, '').replace(/-/g, '/'),
    sensitivity: 'confidential',
    tags,
    vault_ref: relative(homedir(), record.filePath),
    created_at: now,
    updated_at: now,
  };
}

export function registerIngestCcMemory(parent: Command): void {
  parent
    .command('cc-memory')
    .description('Import Claude Code auto-memory MD files (all CWDs) into FM')
    .option('--projects-root <path>', 'override Claude Code projects dir', join(homedir(), '.claude', 'projects'))
    .option('--dry-run', 'list what would be imported, change nothing', false)
    .option('--stub-replace', 'after import, replace each silo MEMORY.md with a pointer stub', false)
    .option('--concurrency <n>', 'parallel record processing (default: cpus/2)', String(DEFAULT_CONCURRENCY))
    .action(async (opts: { projectsRoot: string; dryRun: boolean; stubReplace: boolean; concurrency: string }) => {
      const paths = resolvePaths();
      await ensureFmRoot(paths);

      section('Atrium · ingest cc-memory');
      kv('Source', gray(opts.projectsRoot));
      kv('FM root', gray(paths.fmRoot));
      kv('Namespace', cyan(paths.namespace));

      const records = await discoverMemoryFiles(opts.projectsRoot);
      kv('Discovered', String(records.length) + ' MD files across ' +
        new Set(records.map((r) => r.cwdDir)).size + ' CWDs');

      if (records.length === 0) {
        warn('Nothing to import.');
        return;
      }

      if (opts.dryRun) {
        for (const r of records) {
          process.stdout.write(`  ${gray('would import:')} ${r.filePath}\n`);
        }
        ok('Dry-run complete — no changes made.');
        return;
      }

      const fm = await openFirmMemory({ dataDir: paths.dataDir, namespace: paths.namespace });
      const ledger = new AuditLedger(paths.auditDbPath);
      const ctx = { ledger, sessionId: `atrium-${Date.now()}`, agentId: 'batiste-fm' };
      const checkpoints = await loadCheckpoints(paths.checkpointPath);

      const concurrency = Math.max(1, Number.parseInt(opts.concurrency, 10) || DEFAULT_CONCURRENCY);
      kv('Concurrency', String(concurrency));

      // v1.4: every per-record import is now a Plan Operation. The
      // executor emits start+end LineageEntry events to the ledger
      // (tool='parallel.op'), giving us a queryable provenance trace
      // of the run on top of the per-mutation `fm.facts.put` rows.
      const executor = buildAtriumExecutor({
        concurrency,
        ledger,
        sessionId: ctx.sessionId,
        agentId: ctx.agentId,
      });
      const plan = new Plan();

      const progress = new Progress('importing', records.length);
      let imported = 0;
      let skipped = 0;
      let totalScrubHits = 0;

      try {
        for (const record of records) {
          plan.add(
            `cc-memory:${basename(record.filePath)}`,
            { tag: 'io-bound' },
            async () => {
              const fact = memoryToFact(record, basename(record.filePath, '.md'));
              const stHits = record.body.length - fact.body.length > 0 ? 1 : 0;
              totalScrubHits += stHits;
              const existing = await fm.facts.get(fact.id);
              if (existing && existing.body === fact.body) {
                skipped++;
                progress.tick(imported + skipped, gray('(idempotent)'));
                return;
              }
              await withAudit(
                ctx,
                'fm.facts.put',
                { id: fact.id, source: 'cc-memory', file: record.filePath },
                async () => {
                  await fm.facts.put(fact);
                },
              );
              // Concurrent setCheckpoint calls touch disjoint keys (the
              // record's filePath); the in-memory map mutation is safe
              // under cooperative scheduling.
              setCheckpoint(checkpoints, 'cc-memory', record.filePath, fact.updated_at);
              imported++;
              progress.tick(imported + skipped);
            },
          );
        }

        const { lineage } = await executor.run(plan);
        // Surface upstream-failure cascades (each failed op emits an
        // `end` row with result='error'). The executor never throws;
        // the caller decides what to do.
        const failures = lineage.filter((e) => e.phase === 'end' && e.result === 'error');
        if (failures.length > 0) {
          warn(`${failures.length} op(s) failed during import; see audit ledger (tool='parallel.op').`);
        }
        progress.done(green(`${imported} imported, ${skipped} skipped`));

        if (opts.stubReplace) {
          process.stdout.write('\n');
          let stubbed = 0;
          const cwdDirs = new Set(records.map((r) => r.cwdDir));
          for (const cwd of cwdDirs) {
            const memDir = join(opts.projectsRoot, cwd, 'memory');
            const indexPath = join(memDir, 'MEMORY.md');
            if (!existsSync(indexPath)) continue;
            await writeFile(indexPath, STUB_TEMPLATE(new Date().toISOString(), paths.fmRoot), 'utf8');
            stubbed++;
            process.stdout.write(`  ${green('stubbed:')} ${indexPath}\n`);
          }
          ok(`Stub-replaced ${stubbed} MEMORY.md index files.`);
        }

        await saveCheckpoints(paths.checkpointPath, checkpoints);

        section('Summary');
        kv('Imported', green(String(imported)));
        kv('Skipped (idempotent)', String(skipped));
        kv('Files with redactions', yellow(String(totalScrubHits)));
        kv('Audit ledger', gray(paths.auditDbPath));
        ok('cc-memory ingestion complete.');
      } finally {
        await fm.close();
      }
    });
}
