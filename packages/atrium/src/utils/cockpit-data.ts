/**
 * Cockpit data helpers — server-side reads for the operator-trust dashboard.
 *
 * All four panels of the cockpit (Running / Permitted / Activity / Memory)
 * fan out to one of these pure-ish helpers. Keeping the SQLite traffic in
 * one file means the route handlers in `../ui/server.ts` stay thin and the
 * unit tests in `../__tests__/cockpit-data.test.ts` can pin every query
 * shape against a temp database.
 *
 * The helpers do NOT open or close database handles themselves — callers
 * pass in a `Database` instance from `better-sqlite3`. That keeps the
 * cockpit endpoints cheap (one connection per process, reused for the
 * lifetime of the wizard server) and makes the tests trivial.
 *
 * Brand: nothing in here is operator-facing copy. UI strings live in
 * `../ui/static/cockpit.html` and `cockpit.js`.
 */

import type Database from 'better-sqlite3';
import { resolvePaths } from './data-dir.js';

/* ────────────────────────────────────────────────────────────────────────── *
 * Permitted scope (Panel 2).
 * ────────────────────────────────────────────────────────────────────────── */

export interface ScopeRule {
  pattern: string;
  effect: 'allow' | 'deny';
  rationale: string;
}

export interface RlsRoleSummary {
  role: string;
  description: string;
  /** Sensitivities (per `@batiste-aidk/memory`) the role may read. */
  sensitivities: string[];
  /** Whether the role may write to Firm Memory at all. */
  canWrite: boolean;
}

export interface ScopeSnapshot {
  namespace: string;
  fmRoot: string;
  rls: {
    description: string;
    roles: RlsRoleSummary[];
  };
  scopeRules: ScopeRule[];
}

/**
 * Static scope snapshot for v1.4. Mirrors the documented role split in
 * ADR-0002: `gestora` (founder) is the only writer; analista/advisor are
 * read-only with progressively narrower sensitivity ceilings. The scope
 * rules echo the SECRET_PATH_PATTERNS bundled with `@batiste-aidk/scope`
 * — we don't import the live patterns here because the Cockpit is a
 * read-only summary surface, not a policy editor (that lands in v1.5).
 */
export function readScope(): ScopeSnapshot {
  const paths = resolvePaths();
  return {
    namespace: paths.namespace,
    fmRoot: paths.fmRoot,
    rls: {
      description:
        'Row-level security mirrors the firm hierarchy: gestora writes, ' +
        'analista reads everything except privileged, advisor reads only ' +
        'public and internal entries.',
      roles: [
        {
          role: 'gestora',
          description: 'Founder / managing partner. Sole writer to Firm Memory.',
          sensitivities: ['public', 'internal', 'confidential', 'confidential-nda', 'privileged'],
          canWrite: true,
        },
        {
          role: 'analista',
          description: 'Analyst seat. Read-only across non-privileged entries.',
          sensitivities: ['public', 'internal', 'confidential', 'confidential-nda'],
          canWrite: false,
        },
        {
          role: 'advisor',
          description: 'External advisor. Read-only on public + internal entries.',
          sensitivities: ['public', 'internal'],
          canWrite: false,
        },
      ],
    },
    scopeRules: [
      { pattern: 'src/**', effect: 'allow', rationale: 'Project source code is in-scope by default.' },
      { pattern: 'docs/**', effect: 'allow', rationale: 'Project documentation is in-scope by default.' },
      { pattern: 'packages/**', effect: 'allow', rationale: 'Workspace packages are in-scope by default.' },
      { pattern: '**/.env*', effect: 'deny', rationale: 'Secrets — blocked by SECRET_PATH_PATTERNS.' },
      { pattern: '**/*.pem', effect: 'deny', rationale: 'Private keys — blocked by SECRET_PATH_PATTERNS.' },
      { pattern: '**/credentials.json', effect: 'deny', rationale: 'Credentials — blocked by SECRET_PATH_PATTERNS.' },
      { pattern: '**/node_modules/**', effect: 'deny', rationale: 'Dependency tree — never indexed.' },
      { pattern: '**/.git/**', effect: 'deny', rationale: 'Internal VCS state — never indexed.' },
    ],
  };
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Audit tail (Panel 3).
 * ────────────────────────────────────────────────────────────────────────── */

export interface AuditTailEntry {
  id: string;
  timestamp: string;
  sessionId: string;
  agentId: string;
  tool: string;
  result: 'success' | 'denied' | 'error';
  durationMs: number;
  args: Record<string, unknown>;
}

interface AuditRow {
  id: string;
  timestamp: string;
  session_id: string;
  agent_id: string;
  tool: string;
  args_json: string;
  result: string;
  duration_ms: number;
}

/**
 * Tail the audit ledger. Returns up to `limit` rows newest-first, optionally
 * constrained to entries strictly newer than `sinceTs` (ISO8601). The route
 * handler uses `sinceTs` to poll for new rows without re-sending the tail.
 *
 * The query uses the `idx_audit_ts` index that ledger.ts creates at boot,
 * so this stays O(log N) even on a long-running ledger.
 */
export function tailAudit(
  db: Database.Database,
  sinceTs?: string,
  limit = 50,
): AuditTailEntry[] {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const rows = sinceTs
    ? (db
        .prepare('SELECT * FROM audit_log WHERE timestamp > ? ORDER BY timestamp DESC LIMIT ?')
        .all(sinceTs, safeLimit) as AuditRow[])
    : (db
        .prepare('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?')
        .all(safeLimit) as AuditRow[]);

  return rows.map((row) => {
    let args: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(row.args_json) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      // Leave args as {} on malformed JSON; we never throw inside the tail.
    }
    return {
      id: row.id,
      timestamp: row.timestamp,
      sessionId: row.session_id,
      agentId: row.agent_id,
      tool: row.tool,
      result: row.result as 'success' | 'denied' | 'error',
      durationMs: row.duration_ms,
      args,
    };
  });
}

/* ────────────────────────────────────────────────────────────────────────── *
 * FM browser (Panel 4).
 * ────────────────────────────────────────────────────────────────────────── */

export type FmEntryType = 'fact' | 'prompt';

export interface FmListEntry {
  id: string;
  type: FmEntryType;
  title: string;
  /** `kind` for facts, `category` for prompts. */
  kind: string;
  sensitivity: string;
  tags: string[];
  preview: string;
  updatedAt: string;
}

export interface FmBrowseResult {
  entries: FmListEntry[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface FmBrowseOptions {
  page?: number;
  limit?: number;
  query?: string;
  type?: FmEntryType;
  namespace?: string;
}

interface FactRow {
  id: string;
  kind: string;
  title: string;
  body: string;
  counterparty: string | null;
  workstream: string | null;
  sensitivity: string;
  tags: string;
  vault_ref: string | null;
  audit_ref: string | null;
  created_at: string;
  updated_at: string;
}

interface PromptRow {
  id: string;
  title: string;
  category: string;
  body: string;
  version: number;
  sensitivity: string;
  tags: string;
  validated_on: string | null;
  validated_by: string | null;
  model_preference: string;
  languages: string;
  supersedes: string | null;
  created_at: string;
  updated_at: string;
}

const PREVIEW_CHARS = 240;

function clampPreview(body: string): string {
  if (body.length <= PREVIEW_CHARS) return body;
  return body.slice(0, PREVIEW_CHARS).trimEnd() + '…';
}

function safeParseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // fall through
  }
  return [];
}

function escapeLike(raw: string): string {
  // SQLite LIKE: % and _ are wildcards; \ is the escape char we declare in SQL.
  return raw.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/**
 * Browse Firm Memory entries. Default scans the `facts` table; pass
 * `type: 'prompt'` to scan `prompts`. Search (`query`) does a case-insensitive
 * LIKE against title and body — cheap and good enough for a browser. The
 * vector index is intentionally not consulted here: this panel is for
 * discovery/auditing, not retrieval.
 */
export function browseFm(
  db: Database.Database,
  opts: FmBrowseOptions = {},
): FmBrowseResult {
  const type: FmEntryType = opts.type ?? 'fact';
  const namespace = opts.namespace ?? resolvePaths().namespace;
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const limit = Math.max(1, Math.min(100, Math.floor(opts.limit ?? 20)));
  const offset = (page - 1) * limit;

  const where: string[] = ['namespace = ?'];
  const params: unknown[] = [namespace];

  const trimmedQuery = (opts.query ?? '').trim();
  if (trimmedQuery.length > 0) {
    const like = `%${escapeLike(trimmedQuery)}%`;
    where.push("(title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')");
    params.push(like, like);
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const table = type === 'fact' ? 'facts' : 'prompts';
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS cnt FROM ${table} ${whereSql}`)
    .get(...params) as { cnt: number };
  const total = totalRow.cnt;

  const orderedParams = [...params, limit, offset];
  let entries: FmListEntry[];
  if (type === 'fact') {
    const rows = db
      .prepare(
        `SELECT * FROM facts ${whereSql} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...orderedParams) as FactRow[];
    entries = rows.map((row) => ({
      id: row.id,
      type: 'fact',
      title: row.title,
      kind: row.kind,
      sensitivity: row.sensitivity,
      tags: safeParseTags(row.tags),
      preview: clampPreview(row.body),
      updatedAt: row.updated_at,
    }));
  } else {
    const rows = db
      .prepare(
        `SELECT * FROM prompts ${whereSql} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...orderedParams) as PromptRow[];
    entries = rows.map((row) => ({
      id: row.id,
      type: 'prompt',
      title: row.title,
      kind: row.category,
      sensitivity: row.sensitivity,
      tags: safeParseTags(row.tags),
      preview: clampPreview(row.body),
      updatedAt: row.updated_at,
    }));
  }

  const hasMore = offset + entries.length < total;
  return { entries, total, page, limit, hasMore };
}

export interface FmFactDetail {
  id: string;
  type: 'fact';
  kind: string;
  title: string;
  body: string;
  counterparty: string | null;
  workstream: string | null;
  sensitivity: string;
  tags: string[];
  vaultRef: string | null;
  auditRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FmPromptDetail {
  id: string;
  type: 'prompt';
  category: string;
  title: string;
  body: string;
  version: number;
  sensitivity: string;
  tags: string[];
  validatedOn: string | null;
  validatedBy: string | null;
  modelPreference: string;
  languages: string[];
  supersedes: string | null;
  createdAt: string;
  updatedAt: string;
}

export type FmDetail = FmFactDetail | FmPromptDetail;

/**
 * Fetch a single FM entry by id. Returns `null` if not found in the given
 * namespace + table. The route handler tries `fact` first, then `prompt`,
 * unless the caller passes `?type=prompt` explicitly.
 */
export function getFmEntry(
  db: Database.Database,
  id: string,
  type: FmEntryType,
  namespace?: string,
): FmDetail | null {
  const ns = namespace ?? resolvePaths().namespace;
  if (type === 'fact') {
    const row = db
      .prepare('SELECT * FROM facts WHERE namespace = ? AND id = ?')
      .get(ns, id) as FactRow | undefined;
    if (!row) return null;
    return {
      id: row.id,
      type: 'fact',
      kind: row.kind,
      title: row.title,
      body: row.body,
      counterparty: row.counterparty,
      workstream: row.workstream,
      sensitivity: row.sensitivity,
      tags: safeParseTags(row.tags),
      vaultRef: row.vault_ref,
      auditRef: row.audit_ref,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
  const row = db
    .prepare('SELECT * FROM prompts WHERE namespace = ? AND id = ?')
    .get(ns, id) as PromptRow | undefined;
  if (!row) return null;
  return {
    id: row.id,
    type: 'prompt',
    category: row.category,
    title: row.title,
    body: row.body,
    version: row.version,
    sensitivity: row.sensitivity,
    tags: safeParseTags(row.tags),
    validatedOn: row.validated_on,
    validatedBy: row.validated_by,
    modelPreference: row.model_preference,
    languages: safeParseTags(row.languages),
    supersedes: row.supersedes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
