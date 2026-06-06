/**
 * batiste-fm token-report
 *
 * Promoted from `.scratch/token-report-7d.sh` into a first-class CLI
 * subcommand. Walks every Claude Code session jsonl
 * (`~/.claude/projects/<cwd>/<uuid>.jsonl`), filters events by
 * `type === 'assistant'` + `timestamp >= now - days`, and aggregates the
 * four `message.usage` token counters per day, per cwd, and grand total.
 *
 * Output is human-readable by default (--json toggles machine-readable
 * for piping into a dashboard). The cost column uses approximate list
 * pricing from `utils/anthropic-rates.ts`; cache savings are reported
 * as the delta between actual cost and the hypothetical cost if every
 * `cache_read_input_tokens` had been billed at the full input rate.
 */

import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { RATES, type AnthropicRates } from '../utils/anthropic-rates.js';
import { bold, cyan, gray, green, kv, ok, Progress, section, warn, yellow } from '../utils/output.js';

interface JsonlUsage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}

interface JsonlEvent {
  type?: string;
  timestamp?: string;
  message?: { usage?: JsonlUsage };
}

export interface UsageBucket {
  input: number;
  cacheRead: number;
  cacheCreate: number;
  output: number;
  events: number;
}

export interface ReportTotals extends UsageBucket {
  files: number;
  lines: number;
}

export interface TokenReport {
  window: { startIso: string; endIso: string; days: number };
  rates: AnthropicRates;
  perDay: Record<string, UsageBucket>;
  perCwd: Record<string, UsageBucket>;
  total: ReportTotals;
  costTotalUsd: number;
  cacheSavingsUsd: number;
  noCacheCostUsd: number;
}

function makeBucket(): UsageBucket {
  return { input: 0, cacheRead: 0, cacheCreate: 0, output: 0, events: 0 };
}

/**
 * Pure cost calculator. Exposed for unit tests so the rate math doesn't
 * have to be re-derived inline.
 */
export function bucketCost(b: UsageBucket, rates: AnthropicRates = RATES): number {
  return (
    (b.input * rates.input +
      b.cacheRead * rates.cacheRead +
      b.cacheCreate * rates.cacheCreate +
      b.output * rates.output) /
    1_000_000
  );
}

/**
 * Hypothetical "if we'd never used the cache" surcharge: cache reads
 * would have cost the full input rate instead of the discounted rate.
 * The savings number reported on the CLI is the difference.
 */
export function cacheSavings(b: UsageBucket, rates: AnthropicRates = RATES): number {
  return (b.cacheRead * (rates.input - rates.cacheRead)) / 1_000_000;
}

/**
 * Day key for an ISO timestamp (UTC date). Exported for the day-bucket
 * unit test — tests assert the right boundary semantics for events that
 * straddle midnight UTC.
 */
export function dayKey(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.valueOf())) return 'invalid';
  return d.toISOString().slice(0, 10);
}

/**
 * Apply one parsed jsonl event to a `TokenReport` accumulator. Returns
 * `true` if the event contributed to the totals (assistant + has usage
 * + within window), `false` otherwise. Public for unit testing.
 */
export function applyEvent(
  report: TokenReport,
  cwdDir: string,
  event: JsonlEvent,
  windowStartMs: number,
): boolean {
  if (event.type !== 'assistant') return false;
  if (!event.timestamp) return false;
  const ts = Date.parse(event.timestamp);
  if (Number.isNaN(ts) || ts < windowStartMs) return false;
  const usage = event.message?.usage;
  if (!usage) return false;

  const day = dayKey(event.timestamp);
  const dayBucket = report.perDay[day] ?? makeBucket();
  const cwdBucket = report.perCwd[cwdDir] ?? makeBucket();

  const inp = Number(usage.input_tokens ?? 0);
  const crd = Number(usage.cache_read_input_tokens ?? 0);
  const cwt = Number(usage.cache_creation_input_tokens ?? 0);
  const out = Number(usage.output_tokens ?? 0);

  for (const b of [dayBucket, cwdBucket, report.total] as UsageBucket[]) {
    b.input += inp;
    b.cacheRead += crd;
    b.cacheCreate += cwt;
    b.output += out;
    b.events += 1;
  }

  report.perDay[day] = dayBucket;
  report.perCwd[cwdDir] = cwdBucket;
  return true;
}

interface ScanOptions {
  projectsRoot: string;
  days: number;
  cwdFilter?: string;
  onProgress?: (filesDone: number, totalFiles: number) => void;
}

async function listJsonlFiles(
  projectsRoot: string,
  cwdFilter: string | undefined,
): Promise<{ path: string; cwdDir: string }[]> {
  if (!existsSync(projectsRoot)) return [];
  const out: { path: string; cwdDir: string }[] = [];
  const entries = await readdir(projectsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (cwdFilter && !entry.name.includes(cwdFilter)) continue;
    const dirPath = join(projectsRoot, entry.name);
    let files: string[];
    try {
      files = await readdir(dirPath);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      out.push({ path: join(dirPath, file), cwdDir: entry.name });
    }
  }
  return out;
}

export async function buildReport(opts: ScanOptions): Promise<TokenReport> {
  const now = Date.now();
  const windowStartMs = now - opts.days * 24 * 60 * 60 * 1000;
  const report: TokenReport = {
    window: {
      startIso: new Date(windowStartMs).toISOString(),
      endIso: new Date(now).toISOString(),
      days: opts.days,
    },
    rates: RATES,
    perDay: {},
    perCwd: {},
    total: { ...makeBucket(), files: 0, lines: 0 },
    costTotalUsd: 0,
    cacheSavingsUsd: 0,
    noCacheCostUsd: 0,
  };

  const files = await listJsonlFiles(opts.projectsRoot, opts.cwdFilter);
  for (let fi = 0; fi < files.length; fi++) {
    const file = files[fi];
    if (!file) continue;
    report.total.files += 1;
    let stream;
    try {
      stream = createReadStream(file.path, { encoding: 'utf8' });
    } catch {
      continue;
    }
    const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
    try {
      for await (const line of rl) {
        report.total.lines += 1;
        const trimmed = line.trim();
        if (!trimmed) continue;
        let event: JsonlEvent;
        try {
          event = JSON.parse(trimmed) as JsonlEvent;
        } catch {
          continue;
        }
        applyEvent(report, file.cwdDir, event, windowStartMs);
      }
    } catch {
      // Skip unreadable jsonl; aggregate carries on.
    }
    if (opts.onProgress) opts.onProgress(fi + 1, files.length);
  }

  report.costTotalUsd = bucketCost(report.total);
  report.cacheSavingsUsd = cacheSavings(report.total);
  report.noCacheCostUsd = report.costTotalUsd + report.cacheSavingsUsd;
  return report;
}

function fmtNum(n: number, width = 12): string {
  return n.toLocaleString('en-US').padStart(width, ' ');
}
function fmtUsd(n: number, width = 10): string {
  return ('$' + n.toFixed(2)).padStart(width, ' ');
}
function shortCwd(cwd: string, max = 50): string {
  const replaced = cwd.replace(/^-Users-[^-]+-/, '~');
  if (replaced.length <= max) return replaced;
  return '…' + replaced.slice(-(max - 1));
}

function printHumanReport(report: TokenReport): void {
  section(`Token economy report — last ${report.window.days} day(s)`);
  kv('Window', `${gray(report.window.startIso.slice(0, 10))}  →  ${gray(report.window.endIso.slice(0, 10))}`);
  kv('Files scanned', String(report.total.files));
  kv('Lines parsed', report.total.lines.toLocaleString('en-US'));
  kv('Assistant events', String(report.total.events));

  const dayKeys = Object.keys(report.perDay).sort();
  if (dayKeys.length > 0) {
    section('By day');
    process.stdout.write(
      `  ${gray('date'.padEnd(12))}${gray('events'.padStart(8))}${gray('input'.padStart(14))}${gray(
        'cache_read'.padStart(14),
      )}${gray('cache_create'.padStart(14))}${gray('output'.padStart(14))}${gray('cost USD'.padStart(12))}\n`,
    );
    for (const day of dayKeys) {
      const b = report.perDay[day];
      if (!b) continue;
      process.stdout.write(
        `  ${day.padEnd(12)}${String(b.events).padStart(8)}${fmtNum(b.input, 14)}${fmtNum(b.cacheRead, 14)}${fmtNum(
          b.cacheCreate,
          14,
        )}${fmtNum(b.output, 14)}${fmtUsd(bucketCost(b), 12)}\n`,
      );
    }
  }

  const cwdEntries = Object.entries(report.perCwd)
    .map(([cwd, b]) => ({ cwd, b, cost: bucketCost(b) }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 10);
  if (cwdEntries.length > 0) {
    section('By cwd (top 10 by cost)');
    for (const { cwd, b, cost } of cwdEntries) {
      process.stdout.write(
        `  ${shortCwd(cwd).padEnd(50)}${fmtNum(b.input, 14)}${fmtNum(b.cacheRead, 14)}${fmtUsd(cost, 12)}\n`,
      );
    }
  }

  section('Totals');
  process.stdout.write(
    `  input        ${fmtNum(report.total.input, 14)}  tokens   ${fmtUsd((report.total.input * report.rates.input) / 1_000_000)}\n`,
  );
  process.stdout.write(
    `  cache_read   ${fmtNum(report.total.cacheRead, 14)}  tokens   ${fmtUsd(
      (report.total.cacheRead * report.rates.cacheRead) / 1_000_000,
    )}   ${gray('(paid 10% rate)')}\n`,
  );
  process.stdout.write(
    `  cache_create ${fmtNum(report.total.cacheCreate, 14)}  tokens   ${fmtUsd(
      (report.total.cacheCreate * report.rates.cacheCreate) / 1_000_000,
    )}\n`,
  );
  process.stdout.write(
    `  output       ${fmtNum(report.total.output, 14)}  tokens   ${fmtUsd(
      (report.total.output * report.rates.output) / 1_000_000,
    )}\n`,
  );
  process.stdout.write(`  ${gray('─'.repeat(70))}\n`);
  process.stdout.write(`  ${bold('TOTAL COST')}                                         ${green(fmtUsd(report.costTotalUsd))}\n`);

  const pct = report.noCacheCostUsd > 0 ? (100 * report.cacheSavingsUsd) / report.noCacheCostUsd : 0;
  section('Cache savings (hypothetical no-cache vs actual)');
  kv('Saved by cache reads', `${green(fmtUsd(report.cacheSavingsUsd))}   ${gray(`(${pct.toFixed(1)}% of would-be full cost)`)}`);
  kv('Would-be cost no caching', yellow(fmtUsd(report.noCacheCostUsd)));

  process.stdout.write(`\n  ${gray('Rates approximate per Anthropic public pricing — verify on anthropic.com/pricing.')}\n\n`);
  ok('token-report complete.');
}

export function registerTokenReport(program: Command): void {
  program
    .command('token-report')
    .description('Aggregate Claude Code session token usage and cost estimate')
    .option('--days <n>', 'lookback window in days', '7')
    .option('--projects-root <path>', 'override Claude Code projects dir', join(homedir(), '.claude', 'projects'))
    .option('--json', 'emit machine-readable JSON instead of a formatted table', false)
    .option('--cwd-filter <substr>', 'only count sessions whose CWD dir matches this substring')
    .action(
      async (opts: { days: string; projectsRoot: string; json: boolean; cwdFilter?: string }) => {
        const days = Math.max(1, Number.parseInt(opts.days, 10) || 7);

        if (!existsSync(opts.projectsRoot)) {
          warn(`Claude Code projects dir not found: ${opts.projectsRoot}`);
          return;
        }

        if (!opts.json) {
          section('Atrium · token-report');
          kv('Source', gray(opts.projectsRoot));
          kv('Window', cyan(`${days} day(s)`));
          if (opts.cwdFilter) kv('CWD filter', cyan(opts.cwdFilter));
        }

        // Show a progress bar only if scanning is likely to take >2s; we
        // don't know that up front, so always wire it but Progress
        // throttles its own writes. Skip in --json mode (would corrupt
        // the JSON output).
        const startMs = Date.now();
        let progress: Progress | null = null;
        const report = await buildReport({
          projectsRoot: opts.projectsRoot,
          days,
          cwdFilter: opts.cwdFilter,
          onProgress: opts.json
            ? undefined
            : (done, total) => {
                if (!progress) progress = new Progress('scanning', total);
                progress.tick(done);
                if (done === total) progress.done();
              },
        });

        if (opts.json) {
          process.stdout.write(JSON.stringify(report, null, 2) + '\n');
          return;
        }

        const elapsedMs = Date.now() - startMs;
        printHumanReport(report);
        kv('Scan time', `${(elapsedMs / 1000).toFixed(2)} s`);
      },
    );
}
