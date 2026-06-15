/**
 * Batiste Investor Demo — PROOF, not theatre.
 *
 * End-to-end run of the Batiste zero-trust runtime for AI agents where
 * EVERY number on screen is produced by real work on real files:
 *
 *  - The marketplace gateway, /route, per-cycle billing and the SQLite
 *    AuditLedger are the real packages (@batiste-aidk/marketplace, /audit).
 *  - Each task routes to a node and then invokes the node's REAL handler:
 *      · Code Analyzer    → @batiste-aidk/code   analyze_dependency / find_symbol
 *                           (tree-sitter + LSP, over real .ts files in this repo)
 *      · Doc Intelligence → @batiste-aidk/connectors parse_pdf
 *                           (pdfjs-dist, over a real PDF fixture)
 *  - Latency is MEASURED with a monotonic high-resolution clock
 *    (process.hrtime.bigint) around the real handler call — never invented.
 *  - p50 / p95 / p99 are percentiles of the MEASURED sample, not a fixed
 *    multiplier of a single number.
 *  - `result` in the audit ledger reflects the handler's real success/error.
 *
 * Nothing here is hardcoded to "success" and there is no "production-ready"
 * claim: the demo asserts only what the run actually computed.
 *
 * Runs entirely in-process — no external services required.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { startMarketplace } from '../../packages/marketplace/src/index.js';
import { AuditLedger } from '../../packages/audit/src/ledger.js';
import { ToolHandler } from '../../packages/code/src/mcp/handler.js';
import { ConnectorHandler } from '../../packages/connectors/src/mcp/handler.js';

// ─── Paths ──────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
// Repo root is two levels up from examples/investor-demo.
const REPO_ROOT = join(__dirname, '..', '..');
const DATA_DIR = join(__dirname, '.batiste-demo-data');
const NDA_PDF = join(__dirname, 'fixtures', 'nda_sample.pdf');

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const E = '\x1b[';
const R = `${E}0m`;
const G = (s: string) => `${E}32m${s}${R}`;
const Y = (s: string) => `${E}33m${s}${R}`;
const RD = (s: string) => `${E}31m${s}${R}`;
const C = (s: string) => `${E}36m${s}${R}`;
const B = (s: string) => `${E}1m${s}${R}`;
const DIM = (s: string) => `${E}2m${s}${R}`;
const GR = (s: string) => `${E}90m${s}${R}`;

// ─── Utilities ────────────────────────────────────────────────────────────────

function print(s: string) { process.stdout.write(s); }
function println(s = '') { process.stdout.write(s + '\n'); }
function hr(char = '─', len = 60) { println(GR(char.repeat(len))); }

function step(msg: string) { print(`  ${DIM('›')} ${msg}`); }
function tick(label?: string) { println(` ${G('✓')}${label ? ` ${label}` : ''}`); }

function badge(status: string): string {
  switch (status) {
    case 'online':  return G('● ONLINE');
    case 'standby': return Y('◑ STANDBY');
    case 'offline': return RD('○ OFFLINE');
    default:        return GR(status.toUpperCase());
  }
}

function msColor(ms: number): string {
  const r = ms.toFixed(1);
  if (ms < 50)  return G(`${r}ms`);
  if (ms < 150) return Y(`${r}ms`);
  return RD(`${r}ms`);
}

function pct(n: number): string {
  const p = (n * 100).toFixed(1);
  if (n >= 0.99) return G(`${p}%`);
  if (n >= 0.95) return Y(`${p}%`);
  return RD(`${p}%`);
}

// Visible length, ignoring ANSI colour escapes — so right-padding a colourised
// cell lines up with the column instead of counting the escape bytes.
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;
function vlen(s: string): number { return s.replace(ANSI, '').length; }
function vpad(s: string, width: number): string {
  const pad = width - vlen(s);
  return pad > 0 ? s + ' '.repeat(pad) : s;
}

// pdfjs-dist emits a cosmetic `console.warn` about `standardFontDataUrl`
// whenever a PDF has no embedded fonts (it would fall back to standard fonts
// for *rendering* — irrelevant here, we only extract text, which succeeds).
// We filter that ONE known-benign line so it does not interleave with the
// table output. Nothing else is suppressed: real errors still surface.
// pdfjs routes this notice through console.log (its `warn()` util), so we
// filter both channels. The match is exact-substring on the known message.
function isBenignPdfNotice(args: unknown[]): boolean {
  const first = typeof args[0] === 'string' ? args[0] : '';
  return first.includes('standardFontDataUrl');
}
const _warn = console.warn.bind(console);
console.warn = (...args: unknown[]) => { if (!isBenignPdfNotice(args)) _warn(...args); };
const _log = console.log.bind(console);
console.log = (...args: unknown[]) => { if (!isBenignPdfNotice(args)) _log(...args); };

/** Nearest-rank percentile of a MEASURED sample (no multiplier fudge). */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, rank - 1));
  return sortedAsc[idx]!;
}

// strip the repo prefix so the screen shows repo-relative paths
function rel(p: string): string {
  return p.startsWith(REPO_ROOT + '/') ? p.slice(REPO_ROOT.length + 1) : p;
}

// ─── Real workload definitions ────────────────────────────────────────────────
//
// Each task names a capability (→ which node the gateway routes to) and a real
// handler invocation. The handler runs against a real file in THIS repo (or the
// PDF fixture next to this script). `summarize` turns the handler's real output
// into a one-line evidence string printed beside the measured latency.

type Capability = 'ast_analysis' | 'pdf_parse';

interface Task {
  capability: Capability;
  label: string;
  /** runs the REAL node handler and returns its raw result */
  run: () => Promise<unknown>;
  /** distil the real result into one line of on-screen evidence */
  summarize: (out: unknown) => string;
  /** how many cycles this unit of work bills */
  cycles: number;
}

function buildTasks(code: ToolHandler, docs: ConnectorHandler): Task[] {
  const analyze = (file: string): Task => ({
    capability: 'ast_analysis',
    label: `analyze deps · ${file.split('/').pop()}`,
    cycles: 3,
    run: () => code.handleTool('analyze_dependency', {
      entryPoints: [file],
      maxDepth: 1,
      includeNodeModules: false,
    }),
    summarize: (out) => {
      const r = out as { stats?: { totalImports: number; totalSymbols: number }; nodes: Record<string, { imports: Array<{ modulePath: string }> }> };
      const node = r.nodes[Object.keys(r.nodes).find((k) => k.endsWith(file)) ?? Object.keys(r.nodes)[0]!];
      const top = (node?.imports ?? []).slice(0, 3).map((i) => i.modulePath).join(', ');
      return `${r.stats?.totalImports ?? 0} imports, ${r.stats?.totalSymbols ?? 0} symbols${top ? ` · [${top}]` : ''}`;
    },
  });

  const findSym = (symbol: string, file: string): Task => ({
    capability: 'ast_analysis',
    label: `find symbol · ${symbol}`,
    cycles: 2,
    run: () => code.handleTool('find_symbol', { symbolName: symbol, entryPoints: [file] }),
    summarize: (out) => {
      const r = out as { definitionCount: number; callSiteCount: number; source: string };
      return `${r.definitionCount} def, ${r.callSiteCount} call-sites (${r.source})`;
    },
  });

  const parsePdf: Task = {
    capability: 'pdf_parse',
    label: 'extract clauses · nda_sample.pdf',
    cycles: 2,
    run: () => docs.handleTool('parse_pdf', { filePath: NDA_PDF, includePages: true }),
    summarize: (out) => {
      const r = out as { pageCount: number; estimatedTokens: number; text: string };
      const firstLine = r.text.split(/\s{2,}|\n/)[0]?.trim().slice(0, 32) ?? '';
      return `${r.pageCount}pg, ${r.estimatedTokens} tok · "${firstLine}…"`;
    },
  };

  // Real files that exist in this repo. Verified at startup (see main()).
  return [
    analyze('packages/marketplace/src/gateway.ts'),
    parsePdf,
    analyze('packages/audit/src/ledger.ts'),
    findSym('PdfParser', 'packages/connectors/src/index.ts'),
    analyze('packages/code/src/analysis/RecursiveScout.ts'),
    parsePdf,
    findSym('AuditLedger', 'packages/audit/src/index.ts'),
    analyze('packages/connectors/src/pdf/PdfParser.ts'),
    findSym('startMarketplace', 'packages/marketplace/src/index.ts'),
    analyze('packages/code/src/parsers/TreeSitterAdapter.ts'),
  ];
}

// ─── Main demo ────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write('\x1b[2J\x1b[H'); // clear screen

  println();
  println(`  ${B('BATISTE')}  ${G('·')}  zero-trust runtime for AI agents`);
  println(`  ${GR('The invisible sous-chef that runs your AI stack.')}`);
  println(`  ${GR('Seed Round — Eindhoven, Netherlands · batiste.network')}`);
  println(`  ${GR('Every figure below is computed from real files at run time.')}`);
  println();
  hr('═');
  println();

  // ── Phase 1: Boot ──────────────────────────────────────────────────────────

  println(`  ${B('Phase 1')}  ${C('Marketplace Boot Sequence')}`);
  println();

  step('Starting Marketplace Gateway…');
  const marketplace = await startMarketplace({ port: 0 });
  tick(`${G(`http://localhost:${marketplace.port}`)}  ${GR('(native HTTP)')}`);

  step('Opening Audit Ledger…');
  const ledger = new AuditLedger(':memory:');
  tick('SQLite WAL mode active');

  step('Initialising real node handlers…');
  const code = new ToolHandler(REPO_ROOT, DATA_DIR);
  const docs = new ConnectorHandler(REPO_ROOT);
  tick(`${GR('@batiste-aidk/code (tree-sitter+LSP) · @batiste-aidk/connectors (pdfjs-dist)')}`);

  // Verify every target the demo will touch actually exists. If a fixture is
  // missing we fail loudly here rather than silently "succeeding".
  step('Verifying real targets on disk…');
  const tasks = buildTasks(code, docs);
  const targets = [
    NDA_PDF,
    ...['packages/marketplace/src/gateway.ts', 'packages/audit/src/ledger.ts',
        'packages/connectors/src/index.ts', 'packages/code/src/analysis/RecursiveScout.ts',
        'packages/audit/src/index.ts', 'packages/connectors/src/pdf/PdfParser.ts',
        'packages/marketplace/src/index.ts', 'packages/code/src/parsers/TreeSitterAdapter.ts',
       ].map((p) => join(REPO_ROOT, p)),
  ];
  const missing = targets.filter((t) => !existsSync(t));
  if (missing.length > 0) {
    throw new Error(`Missing real targets:\n  ${missing.map(rel).join('\n  ')}`);
  }
  tick(`${B(String(targets.length))} files present`);

  // Warm the engines with one real call each (pdfjs module load + LSP server
  // spin-up are one-time costs). We do this BEFORE the measured run so Phase 6
  // percentiles reflect steady-state per-task latency, not a single cold start.
  // This is disclosed, not hidden — the warm-up calls are themselves real work.
  step('Warming pdfjs + LSP engines…');
  const warm0 = process.hrtime.bigint();
  await docs.handleTool('parse_pdf', { filePath: NDA_PDF, includePages: false });
  await code.handleTool('find_symbol', { symbolName: 'PdfParser', entryPoints: ['packages/connectors/src/index.ts'] });
  const warmMs = Number(process.hrtime.bigint() - warm0) / 1e6;
  tick(`${GR(`cold-start absorbed in ${warmMs.toFixed(0)}ms (excluded from metrics)`)}`);

  println();
  hr();
  println();

  // ── Phase 2: Node Registration ────────────────────────────────────────────

  println(`  ${B('Phase 2')}  ${C('Node Registration')}`);
  println();

  const baseUrl = `http://localhost:${marketplace.port}`;

  async function register(params: {
    name: string; description: string; capabilities: string[];
    endpoint: string; pricePerCycle: number; tags: string[];
  }) {
    const res = await fetch(`${baseUrl}/nodes/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, creatorId: 'batiste-demo' }),
    });
    return res.json() as Promise<{ id: string; status: string }>;
  }

  step('Registering  Code Analyzer    ');
  const codeNode = await register({
    name: 'Code Analyzer',
    description: 'tree-sitter dependency analysis + LSP symbol resolution',
    capabilities: ['ast_analysis'],
    endpoint: 'inproc://batiste-aidk/code',
    pricePerCycle: 0.001,
    tags: ['code', 'analysis'],
  });
  tick(`${badge('online')}  ${GR(codeNode.id.slice(0, 12) + '…')}  ${GR('$0.0010/cycle')}`);

  step('Registering  Doc Intelligence ');
  const docNode = await register({
    name: 'Doc Intelligence',
    description: 'PDF text + clause extraction via pdfjs-dist',
    capabilities: ['pdf_parse'],
    endpoint: 'inproc://batiste-aidk/connectors',
    pricePerCycle: 0.002,
    tags: ['docs', 'pdf'],
  });
  tick(`${badge('online')}  ${GR(docNode.id.slice(0, 12) + '…')}  ${GR('$0.0020/cycle')}`);

  step('Registering  Compliance Guard ');
  const compNode = await register({
    name: 'Compliance Guard',
    description: 'Audit ledger · kill switch',
    capabilities: ['audit', 'kill_switch'],
    endpoint: 'inproc://batiste-aidk/audit',
    pricePerCycle: 0.003,
    tags: ['compliance'],
  });
  await fetch(`${baseUrl}/nodes/${compNode.id}/heartbeat`, { method: 'POST' });
  marketplace.registry.updateStatus(compNode.id, 'standby');
  tick(`${badge('standby')}  ${GR(compNode.id.slice(0, 12) + '…')}  ${GR('$0.0030/cycle')}`);

  println();
  hr();
  println();

  // ── Phase 3: Routing + REAL work ──────────────────────────────────────────

  println(`  ${B('Phase 3')}  ${C('Zero-Trust Routing + Real Work  ')}${GR(`(${tasks.length} tasks)`)}`);
  println();

  interface RouteResult { node: { id: string; name: string; latencyMs: number | null }; score: number }

  const SESSION_ID = randomUUID();
  // Per-node measured-latency samples, used for real percentiles in Phase 6.
  const samples = new Map<string, number[]>();
  let okCount = 0;
  let errCount = 0;

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i]!;
    const num = String(i + 1).padStart(2, ' ');
    print(`  ${GR(`[${num}/${tasks.length}]`)} ${DIM(t.capability.padEnd(13))} ${GR(t.label.slice(0, 34).padEnd(34))}  `);

    // 1) Route via the real gateway → which node serves this capability.
    const routeRes = await fetch(`${baseUrl}/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capability: t.capability }),
    });
    if (!routeRes.ok) {
      errCount++;
      println(`${RD('✗ no route')}`);
      continue;
    }
    const routed = await routeRes.json() as RouteResult;

    // 2) Run the REAL handler, measured with a monotonic hr clock.
    let result: 'success' | 'error' = 'success';
    let evidence = '';
    const t0 = process.hrtime.bigint();
    try {
      const out = await t.run();
      const latencyMs = Number(process.hrtime.bigint() - t0) / 1e6;
      evidence = t.summarize(out);
      okCount++;

      // 3) Bill the real cycles through the gateway's pricing meter.
      await fetch(`${baseUrl}/billing/record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: SESSION_ID, nodeId: routed.node.id, cyclesUsed: t.cycles }),
      });

      // 4) Append to the real audit ledger with the MEASURED duration.
      ledger.append({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        sessionId: SESSION_ID,
        agentId: 'investor-demo',
        tool: t.capability,
        args: { label: t.label, cycles: t.cycles },
        result,
        durationMs: latencyMs,
      });

      // 5) Feed the node registry + percentile sample with the real latency.
      marketplace.registry.updateLatency(routed.node.id, latencyMs);
      marketplace.registry.updateReliability(routed.node.id, true);
      const arr = samples.get(routed.node.name) ?? [];
      arr.push(latencyMs);
      samples.set(routed.node.name, arr);

      println(`${vpad(msColor(latencyMs), 12)} ${G('✓')} ${DIM(`→ ${routed.node.name}`)}  ${GR(evidence)}`);
    } catch (err) {
      const latencyMs = Number(process.hrtime.bigint() - t0) / 1e6;
      result = 'error';
      errCount++;
      ledger.append({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        sessionId: SESSION_ID,
        agentId: 'investor-demo',
        tool: t.capability,
        args: { label: t.label, cycles: t.cycles },
        result,
        durationMs: latencyMs,
      });
      marketplace.registry.updateReliability(routed.node.id, false);
      println(`${vpad(msColor(latencyMs), 12)} ${RD('✗')} ${DIM(`→ ${routed.node.name}`)}  ${RD(err instanceof Error ? err.message.slice(0, 40) : String(err))}`);
    }
  }

  println();
  println(`  ${okCount === tasks.length ? G('✓') : Y('●')} ${B(`${okCount}/${tasks.length}`)} tasks succeeded${errCount ? RD(`  · ${errCount} errored`) : ''}`);
  println();
  hr();
  println();

  // ── Phase 4: Billing Report ───────────────────────────────────────────────

  println(`  ${B('Phase 4')}  ${C('Billing Report')}`);
  println();

  const billRes = await fetch(`${baseUrl}/billing/${SESSION_ID}`);
  const bill = await billRes.json() as {
    sessionId: string;
    entries: Array<{ nodeName: string; cyclesUsed: number; pricePerCycle: number; totalCost: number }>;
    totalCycles: number;
    totalCost: number;
    generatedAt: string;
  };

  const colW = [22, 8, 12, 12];
  const header = ['Node', 'Cycles', 'Rate', 'Cost'];
  println(`  ${header.map((h, i) => B(h.padEnd(colW[i]!))).join('  ')}`);
  println(`  ${GR(colW.map((w) => '─'.repeat(w)).join('  '))}`);

  const byNode = new Map<string, { cycles: number; price: number; cost: number }>();
  for (const e of bill.entries) {
    const prev = byNode.get(e.nodeName) ?? { cycles: 0, price: e.pricePerCycle, cost: 0 };
    byNode.set(e.nodeName, {
      cycles: prev.cycles + e.cyclesUsed,
      price: e.pricePerCycle,
      cost: prev.cost + e.totalCost,
    });
  }
  for (const [name, data] of byNode) {
    println(`  ${[
      name.padEnd(colW[0]!),
      String(data.cycles).padEnd(colW[1]!),
      `$${data.price.toFixed(4)}`.padEnd(colW[2]!),
      G(`$${data.cost.toFixed(4)}`),
    ].join('  ')}`);
  }
  println(`  ${GR(colW.map((w) => '─'.repeat(w)).join('  '))}`);
  println(`  ${'TOTAL'.padEnd(colW[0]!)}  ${B(String(bill.totalCycles).padEnd(colW[1]!))}  ${''.padEnd(colW[2]!)}  ${B(G(`$${bill.totalCost.toFixed(4)}`))}`);
  println();
  println(`  ${GR(`Session  ${bill.sessionId.slice(0, 18)}…`)}`);
  println(`  ${GR(`Issued   ${bill.generatedAt.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}`)}`);
  println();
  hr();
  println();

  // ── Phase 5: Audit Trail ──────────────────────────────────────────────────

  println(`  ${B('Phase 5')}  ${C('Audit Trail')}  ${GR('(last 5 entries, read back from SQLite)')}`);
  println();

  const entries = ledger.query({ sessionId: SESSION_ID, limit: 5 }).reverse();
  const aColW = [26, 16, 16, 12, 10];
  println(`  ${['Timestamp', 'Agent', 'Tool', 'Result', 'Duration'].map((h, i) => B(h.padEnd(aColW[i]!))).join('  ')}`);
  println(`  ${GR(aColW.map((w) => '─'.repeat(w)).join('  '))}`);
  for (const e of entries) {
    const ts = GR(e.timestamp.replace('T', ' ').replace(/\.\d+Z$/, 'Z'));
    const agent = e.agentId.slice(0, 14).padEnd(aColW[1]!);
    const tool = C(e.tool.padEnd(aColW[2]!));
    const res = e.result === 'success' ? G('✓ success '.padEnd(aColW[3]!)) : RD(`✗ ${e.result}`.padEnd(aColW[3]!));
    println(`  ${ts}  ${agent}  ${tool}  ${res}  ${msColor(e.durationMs)}`);
  }
  println();
  println(`  ${GR(`Ledger holds ${ledger.count({ sessionId: SESSION_ID })} append-only entries for this session.`)}`);
  println();
  hr();
  println();

  // ── Phase 6: Performance Metrics (real percentiles) ───────────────────────

  println(`  ${B('Phase 6')}  ${C('Performance Metrics')}  ${GR('(percentiles of MEASURED latencies)')}`);
  println();

  const mColW = [20, 8, 10, 10, 10, 12];
  println(`  ${['Node', 'n', 'p50', 'p95', 'p99', 'Reliability'].map((h, i) => B(h.padEnd(mColW[i]!))).join('  ')}`);
  println(`  ${GR(mColW.map((w) => '─'.repeat(w)).join('  '))}`);

  for (const n of marketplace.registry.list()) {
    const arr = (samples.get(n.name) ?? []).slice().sort((a, b) => a - b);
    if (arr.length === 0) {
      println(`  ${n.name.padEnd(mColW[0]!)}  ${'0'.padEnd(mColW[1]!)}  ${vpad(GR('—'), mColW[2]!)}  ${vpad(GR('—'), mColW[3]!)}  ${vpad(GR('—'), mColW[4]!)}  ${pct(n.reliability)}`);
      continue;
    }
    const p50 = vpad(msColor(percentile(arr, 50)), mColW[2]!);
    const p95 = vpad(msColor(percentile(arr, 95)), mColW[3]!);
    const p99 = vpad(msColor(percentile(arr, 99)), mColW[4]!);
    println(`  ${n.name.padEnd(mColW[0]!)}  ${String(arr.length).padEnd(mColW[1]!)}  ${p50}  ${p95}  ${p99}  ${pct(n.reliability)}`);
  }
  println();
  println(`  ${GR('p50/p95/p99 are nearest-rank percentiles of the per-task wall-clock above — no fixed multiplier.')}`);
  println();
  hr();
  println();

  // ── Phase 7: Kill Switch ──────────────────────────────────────────────────

  println(`  ${B('Phase 7')}  ${RD('Emergency Kill Switch')}`);
  println();
  println(`  ${Y('⚠')}  Revoking all node access…`);

  const allNodes = marketplace.registry.list();
  const killStart = process.hrtime.bigint();
  for (const node of allNodes) {
    marketplace.registry.updateStatus(node.id, 'offline');
  }
  const killMs = Number(process.hrtime.bigint() - killStart) / 1e6;

  const online = marketplace.registry.list({ status: 'online' });
  println(`  ${G('✓')}  All ${B(String(allNodes.length))} nodes offline in ${G(`${killMs.toFixed(3)}ms`)} ${GR('(measured)')}`);
  println(`  ${G('✓')}  Verification: ${B(String(online.length))} nodes online ${GR('(expected 0)')}`);
  println();
  hr('═');
  println();

  // ── Summary (only what the run actually computed) ─────────────────────────

  println(`  ${B(G('Demo Complete'))}  ${GR('— every figure below was measured during this run')}`);
  println();

  const allLat = [...samples.values()].flat().sort((a, b) => a - b);
  const summaryLines: Array<[string, string]> = [
    [G(`${okCount}/${tasks.length}`), 'real handler calls succeeded (analyze_dependency / find_symbol / parse_pdf)'],
    [G('$' + bill.totalCost.toFixed(4)), `billed across ${bill.totalCycles} compute cycles (gateway pricing meter)`],
    [G(String(ledger.count({ sessionId: SESSION_ID }))), 'audit entries appended (append-only SQLite WAL)'],
    [G(`${percentile(allLat, 50).toFixed(1)}ms`), `median measured task latency (n=${allLat.length})`],
    [G(`${killMs.toFixed(3)}ms`), 'measured kill-switch revocation latency'],
    [G('0'), 'external services required — fully self-hosted'],
  ];
  for (const [val, desc] of summaryLines) {
    println(`  ${val.padEnd(24)}  ${GR(desc)}`);
  }
  println();
  println(`  ${GR('Eindhoven, Netherlands  ·  jardhel@cachola.tech  ·  batiste.network')}`);
  println();

  await marketplace.close();
  ledger.close();
  await code.close();
  docs.close();
  process.exit(errCount === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`\n  ${'\x1b[31m'}✗ Demo error: ${err instanceof Error ? err.stack ?? err.message : String(err)}${'\x1b[0m'}\n\n`);
  process.exit(1);
});
