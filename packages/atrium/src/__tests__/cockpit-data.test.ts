/**
 * Unit tests for utils/cockpit-data.ts.
 *
 * Each test stands up a temp SQLite db with the same DDL the live audit
 * ledger / firm memory use, seeds a few rows, and asserts the helper's
 * shape and ordering. We import `better-sqlite3` directly (transitive dep
 * via @batiste-aidk/audit) rather than spinning up the real ledger or
 * firm memory — that keeps the tests fast and avoids dragging in the
 * embedder model download.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import {
  browseFm,
  getFmEntry,
  readScope,
  tailAudit,
} from '../utils/cockpit-data.js';

const TEST_NAMESPACE = 'cockpit-tests';

interface TempCtx {
  dir: string;
  auditDb: Database.Database;
  fmDb: Database.Database;
}

function makeAuditSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      session_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      args_json TEXT NOT NULL,
      result TEXT NOT NULL,
      duration_ms REAL NOT NULL,
      ast_nodes_accessed INTEGER,
      bytes_transferred INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(timestamp);
  `);
}

function makeFmSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS prompts (
      id TEXT NOT NULL,
      namespace TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      body TEXT NOT NULL,
      version INTEGER NOT NULL,
      sensitivity TEXT NOT NULL,
      tags TEXT NOT NULL,
      validated_on TEXT,
      validated_by TEXT,
      model_preference TEXT NOT NULL,
      languages TEXT NOT NULL,
      supersedes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (namespace, id)
    );
    CREATE TABLE IF NOT EXISTS facts (
      id TEXT NOT NULL,
      namespace TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      counterparty TEXT,
      workstream TEXT,
      sensitivity TEXT NOT NULL,
      tags TEXT NOT NULL,
      vault_ref TEXT,
      audit_ref TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (namespace, id)
    );
  `);
}

function seedAudit(db: Database.Database, n: number): string[] {
  const ids: string[] = [];
  const insert = db.prepare(
    `INSERT INTO audit_log (id, timestamp, session_id, agent_id, tool, args_json, result, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // Build n entries with strictly increasing timestamps so tail order is testable.
  const base = Date.parse('2026-04-24T10:00:00.000Z');
  for (let i = 0; i < n; i++) {
    const id = randomUUID();
    ids.push(id);
    insert.run(
      id,
      new Date(base + i * 1000).toISOString(),
      `sess-${i % 3}`,
      `agent-${i % 2}`,
      i % 4 === 0 ? 'find_symbol' : 'validate_code',
      JSON.stringify({ ix: i }),
      i % 5 === 0 ? 'denied' : 'success',
      10 + i,
    );
  }
  return ids;
}

function seedFacts(db: Database.Database, n: number, namespace = TEST_NAMESPACE): string[] {
  const ids: string[] = [];
  const insert = db.prepare(
    `INSERT INTO facts (id, namespace, kind, title, body, counterparty, workstream, sensitivity, tags, vault_ref, audit_ref, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const base = Date.parse('2026-04-20T10:00:00.000Z');
  for (let i = 0; i < n; i++) {
    const id = `fact-${i.toString().padStart(3, '0')}`;
    ids.push(id);
    insert.run(
      id,
      namespace,
      'decision',
      `Title ${i} ${i === 7 ? 'special-marker' : ''}`,
      `Body content for entry ${i}. `.repeat(20),
      null,
      'workstream-a',
      'confidential',
      JSON.stringify(['tag-a', `tag-${i % 3}`]),
      null,
      null,
      new Date(base + i * 1000).toISOString(),
      new Date(base + i * 1000).toISOString(),
    );
  }
  return ids;
}

function seedPrompts(db: Database.Database, n: number, namespace = TEST_NAMESPACE): string[] {
  const ids: string[] = [];
  const insert = db.prepare(
    `INSERT INTO prompts (id, namespace, title, category, body, version, sensitivity, tags, model_preference, languages, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const base = Date.parse('2026-04-22T10:00:00.000Z');
  for (let i = 0; i < n; i++) {
    const id = `prompt-${i.toString().padStart(3, '0')}`;
    ids.push(id);
    insert.run(
      id,
      namespace,
      `Prompt ${i}`,
      'deal-making',
      `Prompt body ${i}`,
      1,
      'internal',
      JSON.stringify(['p-tag']),
      'any',
      JSON.stringify(['en']),
      new Date(base + i * 1000).toISOString(),
      new Date(base + i * 1000).toISOString(),
    );
  }
  return ids;
}

let ctx: TempCtx;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'cockpit-data-'));
  const auditDb = new Database(join(dir, 'audit.db'));
  const fmDb = new Database(join(dir, 'memory.db'));
  makeAuditSchema(auditDb);
  makeFmSchema(fmDb);
  ctx = { dir, auditDb, fmDb };
});

afterEach(() => {
  ctx.auditDb.close();
  ctx.fmDb.close();
  rmSync(ctx.dir, { recursive: true, force: true });
});

describe('cockpit-data: tailAudit', () => {
  it('returns rows newest-first up to the requested limit', () => {
    seedAudit(ctx.auditDb, 12);
    const out = tailAudit(ctx.auditDb, undefined, 5);
    expect(out).toHaveLength(5);
    // newest-first: timestamps should be strictly decreasing.
    for (let i = 1; i < out.length; i++) {
      const prev = out[i - 1];
      const cur = out[i];
      expect(prev).toBeDefined();
      expect(cur).toBeDefined();
      if (prev && cur) {
        expect(prev.timestamp >= cur.timestamp).toBe(true);
      }
    }
  });

  it('respects sinceTs and only returns strictly newer rows', () => {
    seedAudit(ctx.auditDb, 6);
    const all = tailAudit(ctx.auditDb, undefined, 50);
    expect(all.length).toBe(6);
    const middle = all[3];
    expect(middle).toBeDefined();
    if (!middle) return;
    const fresh = tailAudit(ctx.auditDb, middle.timestamp, 50);
    // sinceTs uses `>` not `>=`, so the boundary row itself is excluded.
    expect(fresh.every((r) => r.timestamp > middle.timestamp)).toBe(true);
    expect(fresh.length).toBe(3);
  });

  it('parses args_json into a Record and never throws on malformed JSON', () => {
    seedAudit(ctx.auditDb, 1);
    // Inject a row with malformed JSON to prove the helper degrades gracefully.
    ctx.auditDb.prepare(
      `INSERT INTO audit_log (id, timestamp, session_id, agent_id, tool, args_json, result, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      '2026-04-24T11:00:00.000Z',
      'sess-x', 'agent-x', 'broken',
      '{not-json',
      'error',
      99,
    );
    const out = tailAudit(ctx.auditDb);
    const broken = out.find((r) => r.tool === 'broken');
    expect(broken).toBeDefined();
    expect(broken?.args).toEqual({});
    const ok = out.find((r) => r.tool !== 'broken');
    expect(ok?.args).toBeDefined();
    expect(typeof ok?.args).toBe('object');
  });
});

describe('cockpit-data: browseFm', () => {
  it('paginates facts in updated_at DESC order', () => {
    seedFacts(ctx.fmDb, 25);
    const page1 = browseFm(ctx.fmDb, { page: 1, limit: 10, namespace: TEST_NAMESPACE });
    expect(page1.entries).toHaveLength(10);
    expect(page1.total).toBe(25);
    expect(page1.hasMore).toBe(true);
    expect(page1.entries[0]?.id).toBe('fact-024'); // newest first
    const page3 = browseFm(ctx.fmDb, { page: 3, limit: 10, namespace: TEST_NAMESPACE });
    expect(page3.entries).toHaveLength(5);
    expect(page3.hasMore).toBe(false);
  });

  it('filters by query against title/body (case-insensitive substring)', () => {
    seedFacts(ctx.fmDb, 10);
    const out = browseFm(ctx.fmDb, {
      query: 'special-marker',
      namespace: TEST_NAMESPACE,
      limit: 50,
    });
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0]?.id).toBe('fact-007');
  });

  it('switches to prompts table when type=prompt', () => {
    seedFacts(ctx.fmDb, 4);
    seedPrompts(ctx.fmDb, 7);
    const facts = browseFm(ctx.fmDb, { type: 'fact', namespace: TEST_NAMESPACE });
    const prompts = browseFm(ctx.fmDb, { type: 'prompt', namespace: TEST_NAMESPACE });
    expect(facts.total).toBe(4);
    expect(prompts.total).toBe(7);
    expect(prompts.entries.every((e) => e.type === 'prompt')).toBe(true);
    expect(facts.entries.every((e) => e.type === 'fact')).toBe(true);
  });

  it('clamps body preview to 240 chars with an ellipsis', () => {
    seedFacts(ctx.fmDb, 1);
    const out = browseFm(ctx.fmDb, { namespace: TEST_NAMESPACE });
    const entry = out.entries[0];
    expect(entry).toBeDefined();
    if (!entry) return;
    expect(entry.preview.length).toBeLessThanOrEqual(241); // 240 + ellipsis
    expect(entry.preview.endsWith('…')).toBe(true);
  });
});

describe('cockpit-data: getFmEntry', () => {
  it('returns the full fact detail including vault_ref/audit_ref keys', () => {
    seedFacts(ctx.fmDb, 3);
    const detail = getFmEntry(ctx.fmDb, 'fact-001', 'fact', TEST_NAMESPACE);
    expect(detail).not.toBeNull();
    expect(detail?.type).toBe('fact');
    expect(detail?.id).toBe('fact-001');
    if (detail && detail.type === 'fact') {
      expect(detail.kind).toBe('decision');
      expect(detail.workstream).toBe('workstream-a');
      expect(detail.sensitivity).toBe('confidential');
      expect(Array.isArray(detail.tags)).toBe(true);
    }
  });

  it('returns null for an unknown id', () => {
    seedFacts(ctx.fmDb, 1);
    const detail = getFmEntry(ctx.fmDb, 'fact-does-not-exist', 'fact', TEST_NAMESPACE);
    expect(detail).toBeNull();
  });

  it('returns prompt detail with prompt-only fields when type=prompt', () => {
    seedPrompts(ctx.fmDb, 2);
    const detail = getFmEntry(ctx.fmDb, 'prompt-001', 'prompt', TEST_NAMESPACE);
    expect(detail).not.toBeNull();
    if (detail && detail.type === 'prompt') {
      expect(detail.category).toBe('deal-making');
      expect(detail.modelPreference).toBe('any');
      expect(detail.languages).toEqual(['en']);
    }
  });
});

describe('cockpit-data: readScope', () => {
  it('returns the documented role + scope shape', () => {
    const snap = readScope();
    expect(typeof snap.namespace).toBe('string');
    expect(snap.namespace.length).toBeGreaterThan(0);
    expect(typeof snap.fmRoot).toBe('string');
    expect(snap.rls.roles.map((r) => r.role).sort()).toEqual(['advisor', 'analista', 'gestora']);
    const gestora = snap.rls.roles.find((r) => r.role === 'gestora');
    expect(gestora?.canWrite).toBe(true);
    const advisor = snap.rls.roles.find((r) => r.role === 'advisor');
    expect(advisor?.canWrite).toBe(false);
    expect(advisor?.sensitivities).toEqual(['public', 'internal']);
    expect(snap.scopeRules.some((r) => r.effect === 'deny' && r.pattern.includes('.env'))).toBe(true);
    expect(snap.scopeRules.some((r) => r.effect === 'allow' && r.pattern.startsWith('src/'))).toBe(true);
  });
});
