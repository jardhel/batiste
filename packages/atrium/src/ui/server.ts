/**
 * batiste-fm install --ui · local install wizard server.
 *
 * Single-page operator UI for the Cachola Tech Firm Memory setup flow.
 * Vanilla HTML + CSS + JS (no framework, no build step) served by a small
 * Node `http` listener bound to 127.0.0.1. The wizard lets the operator
 * opt-in to ingestion sources (cc-memory, cc-sessions, vault, drive,
 * trello), then watches each ingestion subprocess via Server-Sent Events.
 *
 * Brand surface: Cachola Tech only. The string "Batiste" only appears in
 * an optional tiny "Powered by Batiste" footer (see static/index.html);
 * everything operator-facing reads as a Cachola Tech sovereign artefact.
 *
 * Local-only by design: no auth, no CSRF, no HTTPS — that is per spec
 * (single-user local install). Bind address is hard-coded to 127.0.0.1 so
 * we never accidentally expose the wizard to the LAN.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname, extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { KillSwitch } from '@batiste-aidk/audit';
import { resolvePaths } from '../utils/data-dir.js';
import {
  browseFm,
  getFmEntry,
  readScope,
  tailAudit,
  type FmEntryType,
} from '../utils/cockpit-data.js';

interface SourceDescriptor {
  id: 'cc-memory' | 'cc-sessions' | 'vault' | 'drive' | 'trello';
  label: string;
  description: string;
  defaultOn: boolean;
  /** `available` = wizard can run it now; `stub` = disabled with "Coming in v1.4" badge. */
  status: 'available' | 'stub';
}

const SOURCES: SourceDescriptor[] = [
  {
    id: 'cc-memory',
    label: 'Claude Code memory',
    description: 'Auto-memory MD files across every project CWD, classified by frontmatter type and deduplicated by content hash.',
    defaultOn: true,
    status: 'available',
  },
  {
    id: 'cc-sessions',
    label: 'Claude Code sessions',
    description: 'Brain dump of every historical session jsonl. CPU-bound on first run, idempotent on resume.',
    defaultOn: true,
    status: 'available',
  },
  {
    id: 'vault',
    label: 'Obsidian vault',
    description: 'Project the founder vault via Graphify (Leiden clustering on wikilinks, tags, frontmatter).',
    defaultOn: false,
    status: 'stub',
  },
  {
    id: 'drive',
    label: 'Google Drive',
    description: 'Sync a Drive folder as asset precedents. OAuth substrate is shared with future Gmail and Calendar.',
    defaultOn: false,
    status: 'stub',
  },
  {
    id: 'trello',
    label: 'Trello',
    description: 'Project boards as briefing facts: cards become slides, labels become palette tags, checklists become elements.',
    defaultOn: false,
    status: 'stub',
  },
];

const RUNNABLE_SOURCES = new Set<SourceDescriptor['id']>(['cc-memory', 'cc-sessions']);

/* ────────────────────────────────────────────────────────────────────────── *
 * Static asset root resolution.
 * ────────────────────────────────────────────────────────────────────────── */

function resolveStaticRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // Production layout (post-build with copied assets): dist/ui/static/.
  // Dev layout (running compiled dist/ui/server.js against repo): src/ui/static/.
  const candidates = [
    resolve(here, 'static'),
    resolve(here, '..', '..', 'src', 'ui', 'static'),
    resolve(here, '..', 'static'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
  }
  // Last resort — return the most likely path even if it doesn't exist yet,
  // so the error message names a real expected location.
  return candidates[0] ?? here;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function send(res: ServerResponse, status: number, body: string | Buffer, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function serveStatic(res: ServerResponse, root: string, requestedPath: string): void {
  // Defence in depth: normalise then check the resolved path stays under root.
  const safe = normalize(requestedPath).replace(/^[/\\]+/, '');
  const full = resolve(root, safe);
  if (!full.startsWith(root)) {
    send(res, 403, 'Forbidden');
    return;
  }
  if (!existsSync(full) || !statSync(full).isFile()) {
    send(res, 404, 'Not found');
    return;
  }
  const mime = MIME[extname(full).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
  createReadStream(full).pipe(res);
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Run registry — tracks live ingestion subprocesses by runId and lets the
 * SSE endpoint subscribe to their stdout/stderr stream.
 * ────────────────────────────────────────────────────────────────────────── */

interface RunSubscriber {
  onLog: (line: string) => void;
  onProgress: (data: ProgressEvent) => void;
  onDone: (exitCode: number | null) => void;
}

interface RunHandle {
  id: string;
  source: SourceDescriptor['id'];
  child: ChildProcess;
  buffered: { type: 'log' | 'progress' | 'done'; payload: unknown }[];
  subscribers: Set<RunSubscriber>;
  exitCode: number | null;
  finished: boolean;
}

interface ProgressEvent {
  imported?: number;
  skipped?: number;
  redactions?: number;
  done?: number;
  total?: number;
  pct?: number;
  rate?: string;
  label?: string;
}

const runs = new Map<string, RunHandle>();

/**
 * The CLI emits ANSI-coloured progress lines like:
 *   `  importing  ████░░░░  42/100  3.4/s  +5/-1`
 * and structured kv lines like `  Imported   12`. Strip ANSI then sniff for
 * patterns we know — anything else stays a plain log line.
 */
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const PROGRESS_RE = /^\s*([a-zA-Z][a-zA-Z0-9 _-]+?)\s+[█░▓▒]+\s+(\d+)\/(\d+)(?:\s+([\d.]+\/s))?(?:\s+(.+))?$/;
const COUNTER_LINE_RE = /^\s*(Imported|Skipped|Turns imported|Turns skipped|Total redactions applied|Files with redactions)\s+\(?[a-z ]*\)?\s*([\d]+)/;

function parseLogLine(raw: string): { kind: 'log' | 'progress'; payload: unknown } {
  const line = raw.replace(ANSI_RE, '').replace(/\r/g, '').trimEnd();
  const progressMatch = PROGRESS_RE.exec(line);
  if (progressMatch) {
    const label = progressMatch[1]?.trim() ?? 'progress';
    const done = Number.parseInt(progressMatch[2] ?? '0', 10);
    const total = Number.parseInt(progressMatch[3] ?? '0', 10);
    const rate = progressMatch[4] ?? undefined;
    const suffix = progressMatch[5]?.trim() ?? undefined;
    const pct = total > 0 ? Math.min(1, done / total) : 0;
    const ev: ProgressEvent = { label, done, total, pct, rate, ...(suffix ? { suffix } : {}) } as ProgressEvent;
    return { kind: 'progress', payload: ev };
  }
  const counterMatch = COUNTER_LINE_RE.exec(line);
  if (counterMatch) {
    const key = (counterMatch[1] ?? '').toLowerCase();
    const value = Number.parseInt(counterMatch[2] ?? '0', 10);
    const ev: ProgressEvent = {};
    if (key.includes('import')) ev.imported = value;
    else if (key.includes('skipped')) ev.skipped = value;
    else if (key.includes('redaction')) ev.redactions = value;
    return { kind: 'progress', payload: ev };
  }
  return { kind: 'log', payload: line };
}

function locateBatisteFmBin(): string {
  // The atrium package's own bin shim — works whether we run from dist/ui/
  // (compiled) or from a sibling install. Walk up from this file looking
  // for `bin/batiste-fm.js`.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '..', '..', 'bin', 'batiste-fm.js'),
    resolve(here, '..', '..', '..', 'bin', 'batiste-fm.js'),
    resolve(here, '..', 'bin', 'batiste-fm.js'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0] ?? 'batiste-fm';
}

function startRun(source: SourceDescriptor['id']): RunHandle {
  const id = randomUUID();
  const bin = locateBatisteFmBin();
  const child = spawn(process.execPath, [bin, 'ingest', source], {
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const handle: RunHandle = {
    id,
    source,
    child,
    buffered: [],
    subscribers: new Set(),
    exitCode: null,
    finished: false,
  };
  runs.set(id, handle);

  function emit(type: 'log' | 'progress' | 'done', payload: unknown): void {
    handle.buffered.push({ type, payload });
    // Cap replay buffer to 500 events so a long ingestion doesn't pin RAM.
    if (handle.buffered.length > 500) handle.buffered.splice(0, handle.buffered.length - 500);
    for (const sub of handle.subscribers) {
      if (type === 'log') sub.onLog(String(payload));
      else if (type === 'progress') sub.onProgress(payload as ProgressEvent);
      else sub.onDone((payload as { exitCode: number | null }).exitCode);
    }
  }

  function attachLineReader(stream: NodeJS.ReadableStream): void {
    let pending = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      pending += chunk;
      let idx = pending.indexOf('\n');
      while (idx !== -1) {
        const line = pending.slice(0, idx);
        pending = pending.slice(idx + 1);
        if (line.length > 0) {
          const parsed = parseLogLine(line);
          emit(parsed.kind, parsed.payload);
        }
        idx = pending.indexOf('\n');
      }
    });
    stream.on('end', () => {
      if (pending.length > 0) {
        const parsed = parseLogLine(pending);
        emit(parsed.kind, parsed.payload);
      }
    });
  }

  if (child.stdout) attachLineReader(child.stdout);
  if (child.stderr) attachLineReader(child.stderr);

  child.on('close', (code) => {
    handle.exitCode = code;
    handle.finished = true;
    emit('done', { exitCode: code });
  });

  child.on('error', (err) => {
    emit('log', `process error: ${err.message}`);
    handle.exitCode = 1;
    handle.finished = true;
    emit('done', { exitCode: 1 });
  });

  return handle;
}

/* ────────────────────────────────────────────────────────────────────────── *
 * SSE writer.
 * ────────────────────────────────────────────────────────────────────────── */

function writeSseEvent(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function attachSse(res: ServerResponse, handle: RunHandle): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': stream open\n\n');

  // Replay buffered events so a late subscriber sees the full run.
  for (const ev of handle.buffered) writeSseEvent(res, ev.type, ev.payload);

  if (handle.finished) {
    res.end();
    return;
  }

  const sub: RunSubscriber = {
    onLog: (line) => writeSseEvent(res, 'log', line),
    onProgress: (p) => writeSseEvent(res, 'progress', p),
    onDone: (exitCode) => {
      writeSseEvent(res, 'done', { exitCode });
      res.end();
    },
  };
  handle.subscribers.add(sub);

  res.on('close', () => {
    handle.subscribers.delete(sub);
  });
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Cockpit support — operator-trust dashboard endpoints.
 *
 * The Cockpit is a read-only surface over the live audit ledger and Firm
 * Memory database. We hold one `better-sqlite3` connection per file
 * (audit + memory) for the lifetime of the wizard server, opened lazily on
 * first request and closed on server.close(). All queries are local-file
 * O(log N) reads guarded by indexes.
 *
 * The `KillSwitch` lives in-process. v1.4 ships a single global instance
 * (no central agent registry yet) — `kill_all` flips the paused flag and
 * any currently-running ingestion subprocess gets SIGTERM as a backstop.
 * ────────────────────────────────────────────────────────────────────────── */

const cockpitState: {
  auditDb: Database.Database | null;
  fmDb: Database.Database | null;
  killSwitch: KillSwitch;
} = {
  auditDb: null,
  fmDb: null,
  killSwitch: new KillSwitch(),
};

function openAuditDb(): Database.Database | null {
  if (cockpitState.auditDb) return cockpitState.auditDb;
  const path = resolvePaths().auditDbPath;
  if (!existsSync(path)) return null;
  try {
    const db = new Database(path, { readonly: true, fileMustExist: true });
    cockpitState.auditDb = db;
    return db;
  } catch {
    return null;
  }
}

function openFmDb(): Database.Database | null {
  if (cockpitState.fmDb) return cockpitState.fmDb;
  const dataDir = resolvePaths().dataDir;
  const path = resolve(dataDir, 'memory.db');
  if (!existsSync(path)) return null;
  try {
    const db = new Database(path, { readonly: true, fileMustExist: true });
    cockpitState.fmDb = db;
    return db;
  } catch {
    return null;
  }
}

function closeCockpitDbs(): void {
  if (cockpitState.auditDb) {
    try { cockpitState.auditDb.close(); } catch { /* already closed */ }
    cockpitState.auditDb = null;
  }
  if (cockpitState.fmDb) {
    try { cockpitState.fmDb.close(); } catch { /* already closed */ }
    cockpitState.fmDb = null;
  }
}

function openSseHeaders(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': stream open\n\n');
}

/**
 * In-flight ops feed. v1.4 has no central registry of running operations
 * (the hooks shipped by Agent G don't write one yet), so we just emit a
 * heartbeat with `ops: []` every 5 s. The panel renders the empty state;
 * the v1.4.1 follow-up will wire `runs` (the ingestion registry above)
 * and any hook-spawned operations into this stream.
 *
 * The 5 s interval is a deliberate ceiling: anything tighter starts to
 * eat CPU on every page reload, and the panel doesn't need millisecond
 * accuracy — it's a "is anything happening?" surface, not a profiler.
 */
function attachInFlightSse(res: ServerResponse): void {
  openSseHeaders(res);

  const emit = (): void => {
    // Bridge the existing ingestion registry — the wizard's `runs` map is
    // the only authoritative source of in-flight operations today.
    const ops = Array.from(runs.values())
      .filter((r) => !r.finished)
      .map((r) => ({
        id: r.id,
        source: r.source,
        startedAt: undefined, // not tracked on RunHandle in v1.4
      }));
    writeSseEvent(res, 'ops', { ops, ts: new Date().toISOString() });
  };

  emit();
  const interval = setInterval(emit, 5_000);
  res.on('close', () => clearInterval(interval));
}

/**
 * Audit-tail SSE. Sends the last 50 entries on connect, then polls the
 * SQLite file every 2 s for entries strictly newer than the last seen
 * timestamp. Polling (rather than sqlite hooks) is intentional — the file
 * is local, the index is hot, and we never hold a write lock.
 */
function attachAuditTailSse(res: ServerResponse): void {
  openSseHeaders(res);

  const db = openAuditDb();
  if (!db) {
    writeSseEvent(res, 'empty', { reason: 'audit ledger not yet initialised' });
    // Keep the connection open so the panel re-renders if the ledger
    // appears later in the same session — cheap heartbeat every 10s.
    const heartbeat = setInterval(() => {
      writeSseEvent(res, 'heartbeat', { ts: new Date().toISOString() });
    }, 10_000);
    res.on('close', () => clearInterval(heartbeat));
    return;
  }

  let lastTs: string | undefined;
  const initial = tailAudit(db, undefined, 50);
  // Stream initial batch oldest → newest so the client renders top-to-bottom
  // with newest first naturally (it prepends each `entry`).
  for (let i = initial.length - 1; i >= 0; i--) {
    const row = initial[i];
    if (!row) continue;
    writeSseEvent(res, 'entry', row);
    if (!lastTs || row.timestamp > lastTs) lastTs = row.timestamp;
  }

  const tick = (): void => {
    try {
      const fresh = tailAudit(db, lastTs, 50);
      for (let i = fresh.length - 1; i >= 0; i--) {
        const row = fresh[i];
        if (!row) continue;
        writeSseEvent(res, 'entry', row);
        if (!lastTs || row.timestamp > lastTs) lastTs = row.timestamp;
      }
    } catch (err) {
      writeSseEvent(res, 'error', { message: err instanceof Error ? err.message : String(err) });
    }
  };
  const interval = setInterval(tick, 2_000);
  res.on('close', () => clearInterval(interval));
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Request router.
 * ────────────────────────────────────────────────────────────────────────── */

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw) as unknown;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, staticRoot: string): Promise<void> {
  const host = req.headers.host ?? '127.0.0.1';
  const url = new URL(req.url ?? '/', `http://${host}`);
  const method = req.method ?? 'GET';
  const path = url.pathname;

  if (method === 'GET' && (path === '/' || path === '/index.html')) {
    serveStatic(res, staticRoot, 'index.html');
    return;
  }

  if (method === 'GET' && path === '/cockpit') {
    serveStatic(res, staticRoot, 'cockpit.html');
    return;
  }

  if (method === 'GET' && path === '/favicon.ico') {
    serveStatic(res, staticRoot, 'brand/favicon.svg');
    return;
  }

  if (method === 'GET' && path.startsWith('/static/')) {
    serveStatic(res, staticRoot, path.slice('/static/'.length));
    return;
  }

  if (method === 'GET' && path.startsWith('/brand/')) {
    serveStatic(res, staticRoot, path); // brand/* lives under static/brand/
    return;
  }

  if (method === 'GET' && path === '/api/sources') {
    sendJson(res, 200, { sources: SOURCES });
    return;
  }

  if (method === 'GET' && path === '/api/paths') {
    const paths = resolvePaths();
    sendJson(res, 200, paths);
    return;
  }

  if (method === 'POST' && path === '/api/run') {
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: 'invalid JSON body' });
      return;
    }
    const source = (body as { source?: string }).source;
    if (!source || !RUNNABLE_SOURCES.has(source as SourceDescriptor['id'])) {
      sendJson(res, 400, { error: 'source must be one of: ' + Array.from(RUNNABLE_SOURCES).join(', ') });
      return;
    }
    const handle = startRun(source as SourceDescriptor['id']);
    sendJson(res, 200, { runId: handle.id });
    return;
  }

  if (method === 'GET' && path === '/api/events') {
    const runId = url.searchParams.get('runId');
    if (!runId) {
      sendJson(res, 400, { error: 'runId query parameter required' });
      return;
    }
    const handle = runs.get(runId);
    if (!handle) {
      sendJson(res, 404, { error: 'unknown runId' });
      return;
    }
    attachSse(res, handle);
    return;
  }

  /* ── Cockpit endpoints ── */

  if (method === 'GET' && path === '/api/in-flight') {
    attachInFlightSse(res);
    return;
  }

  if (method === 'GET' && path === '/api/scope') {
    sendJson(res, 200, readScope());
    return;
  }

  if (method === 'GET' && path === '/api/audit-tail') {
    attachAuditTailSse(res);
    return;
  }

  if (method === 'GET' && path === '/api/fm-browse') {
    const db = openFmDb();
    if (!db) {
      sendJson(res, 200, { entries: [], total: 0, page: 1, limit: 20, hasMore: false });
      return;
    }
    const pageRaw = url.searchParams.get('page');
    const limitRaw = url.searchParams.get('limit');
    const queryParam = url.searchParams.get('q') ?? undefined;
    const typeParam = url.searchParams.get('type');
    const type: FmEntryType | undefined =
      typeParam === 'prompt' ? 'prompt' : typeParam === 'fact' ? 'fact' : undefined;
    const result = browseFm(db, {
      page: pageRaw ? Number.parseInt(pageRaw, 10) : 1,
      limit: limitRaw ? Number.parseInt(limitRaw, 10) : 20,
      query: queryParam,
      type,
    });
    sendJson(res, 200, result);
    return;
  }

  const fmEntryMatch = /^\/api\/fm-entry\/([A-Za-z0-9_-]+)$/.exec(path);
  if (method === 'GET' && fmEntryMatch) {
    const id = fmEntryMatch[1];
    if (!id) {
      sendJson(res, 400, { error: 'id required' });
      return;
    }
    const db = openFmDb();
    if (!db) {
      sendJson(res, 404, { error: 'firm memory not initialised' });
      return;
    }
    const typeParam = url.searchParams.get('type');
    if (typeParam === 'prompt') {
      const detail = getFmEntry(db, id, 'prompt');
      if (!detail) { sendJson(res, 404, { error: 'not found' }); return; }
      sendJson(res, 200, detail);
      return;
    }
    // Default: try fact first, then prompt — the FM browser hits this
    // without a type when the user clicks a row from a mixed result list.
    const fact = getFmEntry(db, id, 'fact');
    if (fact) { sendJson(res, 200, fact); return; }
    const prompt = getFmEntry(db, id, 'prompt');
    if (prompt) { sendJson(res, 200, prompt); return; }
    sendJson(res, 404, { error: 'not found' });
    return;
  }

  if (method === 'POST' && path === '/api/kill-all') {
    // Kill any in-flight ingestion subprocesses tracked by the wizard's
    // own registry, then trip the global pause flag so any new agent
    // session bound to this KillSwitch is denied entry. The KillSwitch
    // is intentionally local to this process — operators run one wizard
    // server at a time and the cockpit hangs off it.
    let stopped = 0;
    for (const handle of runs.values()) {
      if (handle.finished) continue;
      try { handle.child.kill('SIGTERM'); stopped++; } catch { /* already gone */ }
    }
    cockpitState.killSwitch.execute({
      action: 'kill_all',
      reason: 'operator pressed KILL ALL in cockpit',
    });
    sendJson(res, 200, { stopped, ts: new Date().toISOString() });
    return;
  }

  send(res, 404, 'Not found');
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Public entry.
 * ────────────────────────────────────────────────────────────────────────── */

export interface StartUiServerOptions {
  port?: number;
  openBrowser?: boolean;
}

export interface StartedUiServer {
  url: string;
  close: () => Promise<void>;
}

export async function startUiServer(opts: StartUiServerOptions = {}): Promise<StartedUiServer> {
  const port = opts.port ?? 7777;
  const openBrowser = opts.openBrowser ?? false;
  const staticRoot = resolveStaticRoot();

  const server: Server = createServer((req, res) => {
    handleRequest(req, res, staticRoot).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        sendJson(res, 500, { error: msg });
      } catch {
        // response already sent
      }
    });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, '127.0.0.1', () => resolveListen());
  });

  const url = `http://127.0.0.1:${port}/`;

  if (openBrowser && process.platform === 'darwin') {
    spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
  }

  return {
    url,
    close: () => new Promise<void>((resolveClose, rejectClose) => {
      // Kill any in-flight subprocesses so we don't orphan ingestion runs.
      for (const handle of runs.values()) {
        if (!handle.finished) {
          try { handle.child.kill('SIGTERM'); } catch { /* already gone */ }
        }
      }
      // Release the read-only cockpit handles so SQLite WAL can checkpoint.
      closeCockpitDbs();
      server.close((err) => {
        if (err) rejectClose(err);
        else resolveClose();
      });
    }),
  };
}
