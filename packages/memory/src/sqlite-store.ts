/**
 * @batiste-aidk/memory · SQLite + LanceDB Firm Memory backend
 *
 * Implements the Firm Memory contracts (PromptStore, FactStore, FirmMemory)
 * with durable persistence. SQLite holds canonical entries; LanceDB holds
 * {id, vector, namespace} for vector retrieval. Search merges lexical +
 * vector hits unless `vectorOnly: true`.
 *
 * Governance: see ADR-0002 (Firm Memory governance). Namespace isolation
 * is mandatory — every row and every search filters by namespace.
 *
 * Milestone v1.2.0-alpha.3: this file closes the TODO declared in
 * in-memory-store.ts ("SQLite-backed implementation lands in v1.2.0-alpha.3").
 */

import Database from 'better-sqlite3';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { EmbeddingEngine } from './vector/embed.js';
import { VectorStore, type VectorRecord } from './vector/store.js';
import { lexicalScore } from './lexical.js';
import type {
  FactEntry,
  FactStore,
  FirmMemory,
  MemoryStats,
  PromptEntry,
  PromptStore,
  SearchHit,
  SearchOptions,
} from './types.js';

export interface SqliteFirmMemoryOptions {
  /** Directory where the SQLite db, LanceDB tables, and model cache live. */
  dataDir: string;
  /**
   * Tenant namespace — non-negotiable per ADR-0002. Every row carries this
   * tag; every search filters by it. Default: `'default'`.
   */
  namespace?: string;
  /** Override embedding model. Default: Xenova/all-MiniLM-L6-v2 (384 dims). */
  model?: string;
  /** Override dimensions. Default: 384. */
  dimensions?: number;
}

const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
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

CREATE INDEX IF NOT EXISTS idx_prompts_category ON prompts(namespace, category);
CREATE INDEX IF NOT EXISTS idx_prompts_sensitivity ON prompts(namespace, sensitivity);

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

CREATE INDEX IF NOT EXISTS idx_facts_kind ON facts(namespace, kind);
CREATE INDEX IF NOT EXISTS idx_facts_sensitivity ON facts(namespace, sensitivity);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

function nowIso(): string {
  return new Date().toISOString();
}

function keyForVector(namespace: string, id: string): string {
  return `${namespace}::${id}`;
}

/**
 * Shared core — both stores funnel writes/reads through here. Kept internal
 * to the module so the two public classes remain a clean API surface.
 */
class Backend {
  readonly db: Database.Database;
  readonly vectors: VectorStore;
  readonly embedder: EmbeddingEngine;
  readonly namespace: string;
  private embedderReady = false;

  constructor(opts: SqliteFirmMemoryOptions) {
    this.namespace = opts.namespace ?? 'default';
    const dbPath = join(opts.dataDir, 'memory.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA_SQL);
    this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
      'schema_version',
      String(SCHEMA_VERSION)
    );
    this.vectors = new VectorStore(opts.dataDir);
    this.embedder = new EmbeddingEngine({
      dataDir: opts.dataDir,
      model: opts.model,
      dimensions: opts.dimensions,
    });
  }

  async initialize(): Promise<void> {
    await this.vectors.initialize();
    // Embedder init is lazy — paid only on first put/search.
  }

  async ensureEmbedder(): Promise<void> {
    if (this.embedderReady) return;
    await this.embedder.initialize();
    this.embedderReady = true;
  }

  async indexText(table: 'prompts' | 'facts', id: string, text: string): Promise<void> {
    await this.ensureEmbedder();
    const vector = await this.embedder.embed(text);
    const record: VectorRecord = {
      id: keyForVector(this.namespace, id),
      vector,
      updated_at: nowIso(),
    };
    await this.vectors.upsert(table, [record]);
  }

  async vectorSearch(
    table: 'prompts' | 'facts',
    query: string,
    limit: number
  ): Promise<Map<string, number>> {
    await this.ensureEmbedder();
    const qVec = await this.embedder.embedQuery(query);
    const hits = await this.vectors.search(table, qVec, limit * 3);
    const prefix = `${this.namespace}::`;
    const byId = new Map<string, number>();
    for (const h of hits) {
      if (!h.id.startsWith(prefix)) continue;
      const plainId = h.id.slice(prefix.length);
      // distance → score: LanceDB returns L2/cosine distance (lower = closer).
      // Convert to similarity in [0,1] via 1 / (1 + d).
      byId.set(plainId, 1 / (1 + h.distance));
    }
    return byId;
  }

  async removeFromVectors(table: 'prompts' | 'facts', id: string): Promise<void> {
    await this.vectors.delete(table, keyForVector(this.namespace, id));
  }

  close(): void {
    this.db.close();
    this.vectors.close();
  }
}

function parseJsonArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function rowToPromptEntry(row: Record<string, unknown>): PromptEntry {
  return {
    id: row.id as string,
    title: row.title as string,
    category: row.category as string,
    body: row.body as string,
    version: row.version as number,
    sensitivity: row.sensitivity as PromptEntry['sensitivity'],
    tags: parseJsonArray(row.tags as string),
    validated_on: (row.validated_on as string | null) ?? undefined,
    validated_by: (row.validated_by as string | null) ?? undefined,
    model_preference: row.model_preference as PromptEntry['model_preference'],
    languages: parseJsonArray(row.languages as string),
    supersedes: (row.supersedes as string | null) ?? undefined,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function rowToFactEntry(row: Record<string, unknown>): FactEntry {
  return {
    id: row.id as string,
    kind: row.kind as FactEntry['kind'],
    title: row.title as string,
    body: row.body as string,
    counterparty: (row.counterparty as string | null) ?? undefined,
    workstream: (row.workstream as string | null) ?? undefined,
    sensitivity: row.sensitivity as FactEntry['sensitivity'],
    tags: parseJsonArray(row.tags as string),
    vault_ref: (row.vault_ref as string | null) ?? undefined,
    audit_ref: (row.audit_ref as string | null) ?? undefined,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export class SqlitePromptStore implements PromptStore {
  constructor(private backend: Backend) {}

  async put(entry: PromptEntry): Promise<void> {
    const existing = this.backend.db
      .prepare('SELECT id FROM prompts WHERE namespace = ? AND id = ?')
      .get(this.backend.namespace, entry.id);
    const now = nowIso();
    const createdAt = existing ? undefined : entry.created_at || now;
    if (createdAt) {
      this.backend.db.prepare(
        `INSERT INTO prompts (id, namespace, title, category, body, version, sensitivity, tags, validated_on, validated_by, model_preference, languages, supersedes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        entry.id,
        this.backend.namespace,
        entry.title,
        entry.category,
        entry.body,
        entry.version,
        entry.sensitivity,
        JSON.stringify(entry.tags),
        entry.validated_on ?? null,
        entry.validated_by ?? null,
        entry.model_preference,
        JSON.stringify(entry.languages),
        entry.supersedes ?? null,
        createdAt,
        now
      );
    } else {
      this.backend.db.prepare(
        `UPDATE prompts SET title = ?, category = ?, body = ?, version = ?, sensitivity = ?, tags = ?, validated_on = ?, validated_by = ?, model_preference = ?, languages = ?, supersedes = ?, updated_at = ?
         WHERE namespace = ? AND id = ?`
      ).run(
        entry.title,
        entry.category,
        entry.body,
        entry.version,
        entry.sensitivity,
        JSON.stringify(entry.tags),
        entry.validated_on ?? null,
        entry.validated_by ?? null,
        entry.model_preference,
        JSON.stringify(entry.languages),
        entry.supersedes ?? null,
        now,
        this.backend.namespace,
        entry.id
      );
    }
    await this.backend.indexText('prompts', entry.id, `${entry.title}\n${entry.body}`);
  }

  async get(id: string): Promise<PromptEntry | null> {
    const row = this.backend.db
      .prepare('SELECT * FROM prompts WHERE namespace = ? AND id = ?')
      .get(this.backend.namespace, id) as Record<string, unknown> | undefined;
    return row ? rowToPromptEntry(row) : null;
  }

  async list(
    options: Pick<SearchOptions, 'tags' | 'sensitivity' | 'category' | 'limit'> = {}
  ): Promise<PromptEntry[]> {
    const where: string[] = ['namespace = ?'];
    const params: unknown[] = [this.backend.namespace];
    if (options.category) {
      where.push('category = ?');
      params.push(options.category);
    }
    if (options.sensitivity && options.sensitivity.length > 0) {
      where.push(`sensitivity IN (${options.sensitivity.map(() => '?').join(',')})`);
      params.push(...options.sensitivity);
    }
    const limit = options.limit ?? 1000;
    const rows = this.backend.db
      .prepare(`SELECT * FROM prompts WHERE ${where.join(' AND ')} LIMIT ?`)
      .all(...params, limit) as Record<string, unknown>[];
    const tagSet = new Set(options.tags ?? []);
    const filtered = rows
      .map(rowToPromptEntry)
      .filter((e) => tagSet.size === 0 || e.tags.some((t) => tagSet.has(t)));
    return filtered;
  }

  async search(query: string, options: SearchOptions = {}): Promise<Array<SearchHit<PromptEntry>>> {
    const limit = options.limit ?? 20;
    const candidates = await this.list({
      tags: options.tags,
      sensitivity: options.sensitivity,
      category: options.category,
    });
    const byId = new Map(candidates.map((e) => [e.id, e]));

    const vectorHits = options.vectorOnly
      ? await this.backend.vectorSearch('prompts', query, limit)
      : await this.backend.vectorSearch('prompts', query, limit).catch(() => new Map<string, number>());

    const out: Array<SearchHit<PromptEntry>> = [];
    const seen = new Set<string>();

    for (const [id, vScore] of vectorHits.entries()) {
      const entry = byId.get(id);
      if (!entry) continue;
      out.push({ entry, score: vScore, reason: 'vector' });
      seen.add(id);
    }

    if (!options.vectorOnly) {
      for (const entry of candidates) {
        if (seen.has(entry.id)) continue;
        const direct = entry.id === query ? 1 : 0;
        const lex = direct || lexicalScore(query, entry.body, entry.title, entry.tags);
        if (lex <= 0) continue;
        out.push({ entry, score: lex, reason: direct ? 'exact-id' : 'lexical' });
      }
    }

    const minScore = options.minScore ?? 0.05;
    return out.filter((h) => h.score >= minScore).sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async delete(id: string): Promise<void> {
    this.backend.db
      .prepare('DELETE FROM prompts WHERE namespace = ? AND id = ?')
      .run(this.backend.namespace, id);
    await this.backend.removeFromVectors('prompts', id);
  }

  async stats(): Promise<MemoryStats> {
    const row = this.backend.db
      .prepare(
        'SELECT COUNT(*) as c, COALESCE(SUM(LENGTH(title) + LENGTH(body)), 0) as b, MAX(updated_at) as u FROM prompts WHERE namespace = ?'
      )
      .get(this.backend.namespace) as { c: number; b: number; u: string | null };
    return { prompts: row.c, facts: 0, bytes: row.b, lastUpdated: row.u };
  }
}

export class SqliteFactStore implements FactStore {
  constructor(private backend: Backend) {}

  async put(entry: FactEntry): Promise<void> {
    const existing = this.backend.db
      .prepare('SELECT id FROM facts WHERE namespace = ? AND id = ?')
      .get(this.backend.namespace, entry.id);
    const now = nowIso();
    const createdAt = existing ? undefined : entry.created_at || now;
    if (createdAt) {
      this.backend.db.prepare(
        `INSERT INTO facts (id, namespace, kind, title, body, counterparty, workstream, sensitivity, tags, vault_ref, audit_ref, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        entry.id,
        this.backend.namespace,
        entry.kind,
        entry.title,
        entry.body,
        entry.counterparty ?? null,
        entry.workstream ?? null,
        entry.sensitivity,
        JSON.stringify(entry.tags),
        entry.vault_ref ?? null,
        entry.audit_ref ?? null,
        createdAt,
        now
      );
    } else {
      this.backend.db.prepare(
        `UPDATE facts SET kind = ?, title = ?, body = ?, counterparty = ?, workstream = ?, sensitivity = ?, tags = ?, vault_ref = ?, audit_ref = ?, updated_at = ?
         WHERE namespace = ? AND id = ?`
      ).run(
        entry.kind,
        entry.title,
        entry.body,
        entry.counterparty ?? null,
        entry.workstream ?? null,
        entry.sensitivity,
        JSON.stringify(entry.tags),
        entry.vault_ref ?? null,
        entry.audit_ref ?? null,
        now,
        this.backend.namespace,
        entry.id
      );
    }
    await this.backend.indexText('facts', entry.id, `${entry.title}\n${entry.body}`);
  }

  async get(id: string): Promise<FactEntry | null> {
    const row = this.backend.db
      .prepare('SELECT * FROM facts WHERE namespace = ? AND id = ?')
      .get(this.backend.namespace, id) as Record<string, unknown> | undefined;
    return row ? rowToFactEntry(row) : null;
  }

  async list(
    options: Pick<SearchOptions, 'tags' | 'sensitivity' | 'kind' | 'limit'> = {}
  ): Promise<FactEntry[]> {
    const where: string[] = ['namespace = ?'];
    const params: unknown[] = [this.backend.namespace];
    if (options.kind) {
      where.push('kind = ?');
      params.push(options.kind);
    }
    if (options.sensitivity && options.sensitivity.length > 0) {
      where.push(`sensitivity IN (${options.sensitivity.map(() => '?').join(',')})`);
      params.push(...options.sensitivity);
    }
    const limit = options.limit ?? 1000;
    const rows = this.backend.db
      .prepare(`SELECT * FROM facts WHERE ${where.join(' AND ')} LIMIT ?`)
      .all(...params, limit) as Record<string, unknown>[];
    const tagSet = new Set(options.tags ?? []);
    return rows
      .map(rowToFactEntry)
      .filter((e) => tagSet.size === 0 || e.tags.some((t) => tagSet.has(t)));
  }

  async search(query: string, options: SearchOptions = {}): Promise<Array<SearchHit<FactEntry>>> {
    const limit = options.limit ?? 20;
    const candidates = await this.list({
      tags: options.tags,
      sensitivity: options.sensitivity,
      kind: options.kind,
    });
    const byId = new Map(candidates.map((e) => [e.id, e]));

    const vectorHits = options.vectorOnly
      ? await this.backend.vectorSearch('facts', query, limit)
      : await this.backend.vectorSearch('facts', query, limit).catch(() => new Map<string, number>());

    const out: Array<SearchHit<FactEntry>> = [];
    const seen = new Set<string>();

    for (const [id, vScore] of vectorHits.entries()) {
      const entry = byId.get(id);
      if (!entry) continue;
      out.push({ entry, score: vScore, reason: 'vector' });
      seen.add(id);
    }

    if (!options.vectorOnly) {
      for (const entry of candidates) {
        if (seen.has(entry.id)) continue;
        const direct = entry.id === query ? 1 : 0;
        const lex = direct || lexicalScore(query, entry.body, entry.title, entry.tags);
        if (lex <= 0) continue;
        out.push({ entry, score: lex, reason: direct ? 'exact-id' : 'lexical' });
      }
    }

    const minScore = options.minScore ?? 0.05;
    return out.filter((h) => h.score >= minScore).sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async delete(id: string): Promise<void> {
    this.backend.db
      .prepare('DELETE FROM facts WHERE namespace = ? AND id = ?')
      .run(this.backend.namespace, id);
    await this.backend.removeFromVectors('facts', id);
  }

  async stats(): Promise<MemoryStats> {
    const row = this.backend.db
      .prepare(
        'SELECT COUNT(*) as c, COALESCE(SUM(LENGTH(title) + LENGTH(body)), 0) as b, MAX(updated_at) as u FROM facts WHERE namespace = ?'
      )
      .get(this.backend.namespace) as { c: number; b: number; u: string | null };
    return { prompts: 0, facts: row.c, bytes: row.b, lastUpdated: row.u };
  }
}

export class SqliteFirmMemory implements FirmMemory {
  public readonly prompts: SqlitePromptStore;
  public readonly facts: SqliteFactStore;
  private backend: Backend;

  constructor(opts: SqliteFirmMemoryOptions) {
    this.backend = new Backend(opts);
    this.prompts = new SqlitePromptStore(this.backend);
    this.facts = new SqliteFactStore(this.backend);
  }

  /**
   * Must be awaited before first put/search. Opens the LanceDB connection
   * and creates the models cache dir. Embedder initialization is lazy
   * (first embed call downloads the model on a fresh machine).
   */
  async initialize(): Promise<void> {
    await this.backend.initialize();
  }

  async stats(): Promise<MemoryStats> {
    const p = await this.prompts.stats();
    const f = await this.facts.stats();
    return {
      prompts: p.prompts,
      facts: f.facts,
      bytes: p.bytes + f.bytes,
      lastUpdated:
        p.lastUpdated && f.lastUpdated
          ? p.lastUpdated > f.lastUpdated
            ? p.lastUpdated
            : f.lastUpdated
          : p.lastUpdated ?? f.lastUpdated,
    };
  }

  async close(): Promise<void> {
    this.backend.close();
  }
}

/**
 * Convenience factory. Callers that want persistence just use this.
 */
export async function openFirmMemory(opts: SqliteFirmMemoryOptions): Promise<SqliteFirmMemory> {
  const dataDirPromise = mkdir(opts.dataDir, { recursive: true });
  const fm = new SqliteFirmMemory(opts);
  await dataDirPromise;
  await fm.initialize();
  return fm;
}
