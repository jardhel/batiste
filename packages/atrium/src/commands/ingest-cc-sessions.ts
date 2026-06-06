/**
 * batiste-fm ingest cc-sessions
 *
 * The brain dump. Walks every Claude Code session jsonl
 * (`~/.claude/projects/*\/<uuid>.jsonl`), extracts user + assistant text
 * turns, scrubs secrets, and projects each turn as a FactEntry into Firm
 * Memory. Dedupe by content hash; per-file line-count checkpoint so re-runs
 * are O(delta) rather than O(corpus).
 *
 * One-time historical run is CPU-bound on the local Xenova/all-MiniLM-L6-v2
 * embedder (~1-3 hours for the founder's full corpus on M-series Mac).
 * Idempotent if interrupted; resume from the saved checkpoint.
 *
 * Skipped event types: `permission-mode`, `file-history-snapshot`, system
 * messages, tool_use blocks, tool_result blocks, thinking blocks.
 * Thinking is private by Anthropic's product contract; tool I/O is too noisy
 * for retrieval (will get its own structured ingestion in v1.4).
 */

import type { Command } from 'commander';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, cpus } from 'node:os';
import { basename, join, relative } from 'node:path';
import { createInterface } from 'node:readline';
import { openFirmMemory, type FactEntry } from '@batiste-aidk/memory';
import { AuditLedger } from '@batiste-aidk/audit';
import { ensureFmRoot, resolvePaths } from '../utils/data-dir.js';
import { shortHash } from '../utils/hash.js';
import { scrub } from '../utils/scrub.js';
import { Plan } from '@batiste-aidk/parallel';
import { withAudit } from '../audit-wrap.js';
import { cyan, gray, green, kv, ok, Progress, section, warn, yellow } from '../utils/output.js';
import { getCheckpoint, loadCheckpoints, saveCheckpoints, setCheckpoint } from '../utils/checkpoint.js';
import { buildAtriumExecutor } from '../utils/parallel-bridge.js';

const DEFAULT_CONCURRENCY = Math.max(1, Math.floor(cpus().length / 2));

interface JsonlEvent {
  type?: string;
  uuid?: string;
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
  message?: { role?: string; content?: unknown };
}

interface ContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
}

function extractText(message: { role?: string; content?: unknown } | undefined): string | null {
  if (!message) return null;
  const content = message.content;
  if (typeof content === 'string') {
    return content.trim() || null;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content as ContentBlock[]) {
      if (block && block.type === 'text' && typeof block.text === 'string') {
        parts.push(block.text);
      }
    }
    const joined = parts.join('\n').trim();
    return joined || null;
  }
  return null;
}

interface JsonlFile {
  path: string;
  cwdDir: string;
  size: number;
}

async function discoverJsonlFiles(projectsRoot: string): Promise<JsonlFile[]> {
  const out: JsonlFile[] = [];
  if (!existsSync(projectsRoot)) return out;
  const entries = await readdir(projectsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = join(projectsRoot, entry.name);
    const files = await readdir(dirPath);
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const fullPath = join(dirPath, file);
      const st = await stat(fullPath);
      out.push({ path: fullPath, cwdDir: entry.name, size: st.size });
    }
  }
  return out;
}

interface TurnRecord {
  jsonlPath: string;
  cwdDir: string;
  sessionId: string;
  uuid: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  lineNumber: number;
}

async function readTurnsFromFile(file: JsonlFile, fromLine: number): Promise<TurnRecord[]> {
  const out: TurnRecord[] = [];
  const stream = createReadStream(file.path, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
  let lineNumber = 0;
  for await (const line of rl) {
    lineNumber++;
    if (lineNumber <= fromLine) continue;
    if (!line.trim()) continue;
    let event: JsonlEvent;
    try { event = JSON.parse(line) as JsonlEvent; }
    catch { continue; }
    if (event.type !== 'user' && event.type !== 'assistant') continue;
    const text = extractText(event.message);
    if (!text) continue;
    out.push({
      jsonlPath: file.path,
      cwdDir: file.cwdDir,
      sessionId: event.sessionId ?? basename(file.path, '.jsonl'),
      uuid: event.uuid ?? `${lineNumber}`,
      role: event.type,
      text,
      timestamp: event.timestamp ?? new Date().toISOString(),
      lineNumber,
    });
  }
  return out;
}

function turnToFact(turn: TurnRecord): { fact: FactEntry; scrubHits: number } {
  const { text: scrubbed, hits } = scrub(turn.text);
  const titleSrc = scrubbed.replace(/\s+/g, ' ').trim();
  const title = titleSrc.length > 80 ? titleSrc.slice(0, 80) + '…' : titleSrc;
  const id = shortHash(`${turn.sessionId}::${turn.uuid}::${scrubbed}`);
  const tags = [
    'source:cc-jsonl',
    `session:${turn.sessionId.slice(0, 8)}`,
    `role:${turn.role}`,
    `cwd:${turn.cwdDir}`,
    ...(hits.length > 0 ? [`scrubbed:${hits.map((h) => h.pattern).join(',')}`] : []),
  ];
  const fact: FactEntry = {
    id,
    kind: 'observation',
    title: title || `${turn.role} turn ${turn.uuid.slice(0, 6)}`,
    body: scrubbed,
    workstream: turn.cwdDir.replace(/^-+/, '').replace(/-/g, '/'),
    sensitivity: 'confidential',
    tags,
    vault_ref: `${relative(homedir(), turn.jsonlPath)}#L${turn.lineNumber}`,
    created_at: turn.timestamp,
    updated_at: new Date().toISOString(),
  };
  return { fact, scrubHits: hits.length };
}

export function registerIngestCcSessions(parent: Command): void {
  parent
    .command('cc-sessions')
    .description('Brain dump — import every Claude Code session jsonl into FM')
    .option('--projects-root <path>', 'override Claude Code projects dir', join(homedir(), '.claude', 'projects'))
    .option('--cwd-filter <substr>', 'only ingest sessions whose CWD dir matches this substring')
    .option('--max-turns <n>', 'cap total turns processed (debug / quick demo)', '0')
    .option('--max-files <n>', 'cap files visited (debug)', '0')
    .option('--dry-run', 'count what would be imported, change nothing', false)
    .option('--concurrency <n>', 'parallel turn processing within a file (default: cpus/2)', String(DEFAULT_CONCURRENCY))
    .action(async (opts: {
      projectsRoot: string;
      cwdFilter?: string;
      maxTurns: string;
      maxFiles: string;
      dryRun: boolean;
      concurrency: string;
    }) => {
      const paths = resolvePaths();
      await ensureFmRoot(paths);

      section('Atrium · ingest cc-sessions (brain dump)');
      kv('Source', gray(opts.projectsRoot));
      kv('FM root', gray(paths.fmRoot));
      kv('Namespace', cyan(paths.namespace));

      let files = await discoverJsonlFiles(opts.projectsRoot);
      if (opts.cwdFilter) {
        const f = opts.cwdFilter;
        files = files.filter((file) => file.cwdDir.includes(f));
      }
      const maxFiles = Number.parseInt(opts.maxFiles, 10) || 0;
      if (maxFiles > 0) files = files.slice(0, maxFiles);
      const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
      kv('Files', `${files.length}  (${(totalBytes / 1024 / 1024).toFixed(1)} MB total)`);

      if (files.length === 0) {
        warn('No jsonl files found.');
        return;
      }

      const checkpoints = await loadCheckpoints(paths.checkpointPath);
      const maxTurns = Number.parseInt(opts.maxTurns, 10) || 0;

      if (opts.dryRun) {
        let totalLines = 0;
        for (const file of files) {
          const fromLine = getCheckpoint<number>(checkpoints, 'cc-sessions', file.path) ?? 0;
          process.stdout.write(`  ${gray('would scan:')} ${file.path}  ${gray(`(from line ${fromLine}, ${(file.size / 1024).toFixed(0)} KB)`)}\n`);
          totalLines += 1; // approximation; full count would require reading
        }
        ok(`Dry-run: ${files.length} files, ~${totalLines} entry points.`);
        return;
      }

      const fm = await openFirmMemory({ dataDir: paths.dataDir, namespace: paths.namespace });
      const ledger = new AuditLedger(paths.auditDbPath);
      const ctx = { ledger, sessionId: `atrium-${Date.now()}`, agentId: 'batiste-fm' };
      const concurrency = Math.max(1, Number.parseInt(opts.concurrency, 10) || DEFAULT_CONCURRENCY);
      kv('Concurrency', String(concurrency));

      let imported = 0;
      let skipped = 0;
      let totalScrubHits = 0;
      let processedTurns = 0;

      try {
        const fileProgress = new Progress('files', files.length);
        let fileIdx = 0;

        // v1.4: one Operation per FILE. Turns inside a file are processed
        // sequentially because the embedder owned by `fm` is shared and
        // concurrent calls into it offer no win. Files are independent
        // and the executor parallelises them up to `concurrency`.
        // Per-file checkpoint save still happens INSIDE the op (after
        // its turns finish), so a crashed run resumes correctly even if
        // sibling ops were mid-flight at the time.
        const executor = buildAtriumExecutor({
          concurrency,
          ledger,
          sessionId: ctx.sessionId,
          agentId: ctx.agentId,
        });
        const plan = new Plan();

        for (const file of files) {
          plan.add(
            `cc-sessions:${basename(file.path)}`,
            { tag: 'io-bound' },
            async () => {
              // Cooperative budget check — sibling ops may have already
              // pushed us over `maxTurns` while we were waiting for a
              // dispatch slot.
              if (maxTurns > 0 && processedTurns >= maxTurns) return;

              const fromLine = getCheckpoint<number>(checkpoints, 'cc-sessions', file.path) ?? 0;
              const turns = await readTurnsFromFile(file, fromLine);
              if (turns.length === 0) {
                fileIdx++;
                fileProgress.tick(fileIdx, gray(`${basename(file.path).slice(0, 8)} skipped (no new turns)`));
                return;
              }

              const turnProgress = new Progress(`  turns in ${basename(file.path).slice(0, 8)}`, turns.length);
              let lastLineProcessed = fromLine;
              let ticked = 0;

              for (let i = 0; i < turns.length; i++) {
                const turn = turns[i];
                if (!turn) continue;
                if (maxTurns > 0 && processedTurns >= maxTurns) break;
                const { fact, scrubHits } = turnToFact(turn);
                totalScrubHits += scrubHits;
                const existing = await fm.facts.get(fact.id);
                if (existing && existing.body === fact.body) {
                  skipped++;
                } else {
                  await withAudit(
                    ctx,
                    'fm.facts.put',
                    { id: fact.id, source: 'cc-jsonl', file: file.path, line: turn.lineNumber },
                    async () => {
                      await fm.facts.put(fact);
                    },
                  );
                  imported++;
                }
                lastLineProcessed = Math.max(lastLineProcessed, turn.lineNumber);
                processedTurns++;
                ticked = Math.max(ticked, i + 1);
                turnProgress.tick(ticked);
              }
              turnProgress.done(green(`+${imported}/-${skipped}`));

              setCheckpoint(checkpoints, 'cc-sessions', file.path, lastLineProcessed);
              await saveCheckpoints(paths.checkpointPath, checkpoints);

              fileIdx++;
              fileProgress.tick(fileIdx);
            },
          );
        }

        const { lineage } = await executor.run(plan);
        const failures = lineage.filter((e) => e.phase === 'end' && e.result === 'error');
        if (failures.length > 0) {
          warn(`${failures.length} file op(s) failed; see audit ledger (tool='parallel.op').`);
        }
        if (maxTurns > 0 && processedTurns >= maxTurns) {
          warn(`Reached --max-turns ${maxTurns}; remaining files were short-circuited.`);
        }
        fileProgress.done(green(`${imported} imported, ${skipped} skipped`));

        section('Summary');
        kv('Turns imported', green(String(imported)));
        kv('Turns skipped (idempotent)', String(skipped));
        kv('Total redactions applied', yellow(String(totalScrubHits)));
        kv('Audit ledger', gray(paths.auditDbPath));
        kv('Checkpoint', gray(paths.checkpointPath));
        ok('cc-sessions ingestion complete.');
      } finally {
        await fm.close();
      }
    });
}
