/**
 * @batiste-aidk/memory · in-memory store (reference implementation)
 *
 * An in-process, in-memory implementation of PromptStore and FactStore.
 * This is the v0.1 scaffold: it proves the contract, exercises the lexical
 * search path, and is what the unit tests run against. A SQLite-backed
 * implementation (with sqlite-vec for vector search) lands in v1.2.0-alpha.3.
 *
 * Production deployments MUST NOT use this — it has no persistence. It
 * exists so the API is real today and the v2.0 delivery is substitution,
 * not a rewrite.
 */

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

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

function lexicalScore(query: string, body: string, title: string, tags: string[]): number {
  const qTokens = new Set(tokenize(query));
  if (qTokens.size === 0) return 0;
  const titleTokens = new Set(tokenize(title));
  const bodyTokens = new Set(tokenize(body));
  const tagTokens = new Set(tags.flatMap((t) => tokenize(t)));

  let hits = 0;
  let titleHits = 0;
  let tagHits = 0;
  for (const q of qTokens) {
    if (titleTokens.has(q)) { hits++; titleHits++; }
    else if (bodyTokens.has(q)) { hits++; }
    if (tagTokens.has(q)) tagHits++;
  }
  const coverage = hits / qTokens.size;
  const titleBoost = titleHits / qTokens.size;
  const tagBoost = tagHits / qTokens.size;
  return coverage * 0.6 + titleBoost * 0.3 + tagBoost * 0.1;
}

function nowIso(): string {
  return new Date().toISOString();
}

export class InMemoryPromptStore implements PromptStore {
  private readonly data = new Map<string, PromptEntry>();

  async put(entry: PromptEntry): Promise<void> {
    const stamped = { ...entry, updated_at: nowIso() };
    if (!this.data.has(entry.id)) stamped.created_at = stamped.created_at || nowIso();
    this.data.set(entry.id, stamped);
  }

  async get(id: string): Promise<PromptEntry | null> {
    return this.data.get(id) ?? null;
  }

  async list(options: Pick<SearchOptions, 'tags' | 'sensitivity' | 'category' | 'limit'> = {}): Promise<PromptEntry[]> {
    const tagSet = new Set(options.tags ?? []);
    const senSet = new Set(options.sensitivity ?? []);
    const filtered = [...this.data.values()].filter((e) => {
      if (options.category && e.category !== options.category) return false;
      if (senSet.size > 0 && !senSet.has(e.sensitivity)) return false;
      if (tagSet.size > 0 && !e.tags.some((t) => tagSet.has(t))) return false;
      return true;
    });
    return options.limit ? filtered.slice(0, options.limit) : filtered;
  }

  async search(query: string, options: SearchOptions = {}): Promise<Array<SearchHit<PromptEntry>>> {
    if (options.vectorOnly) {
      throw new Error('vector search is not available in the in-memory store — use the SQLite+sqlite-vec backend when it ships (v1.2.0-alpha.3)');
    }
    const min = options.minScore ?? 0.05;
    const candidates = await this.list(options);
    const hits = candidates
      .map<SearchHit<PromptEntry>>((entry) => {
        const direct = entry.id === query ? 1 : 0;
        const score = direct || lexicalScore(query, entry.body, entry.title, entry.tags);
        return { entry, score, reason: direct ? 'exact-id' : 'lexical' };
      })
      .filter((h) => h.score >= min)
      .sort((a, b) => b.score - a.score);
    return options.limit ? hits.slice(0, options.limit) : hits;
  }

  async delete(id: string): Promise<void> {
    this.data.delete(id);
  }

  async stats(): Promise<MemoryStats> {
    let bytes = 0;
    let lastUpdated: string | null = null;
    for (const e of this.data.values()) {
      bytes += e.body.length + e.title.length;
      if (!lastUpdated || e.updated_at > lastUpdated) lastUpdated = e.updated_at;
    }
    return { prompts: this.data.size, facts: 0, bytes, lastUpdated };
  }
}

export class InMemoryFactStore implements FactStore {
  private readonly data = new Map<string, FactEntry>();

  async put(entry: FactEntry): Promise<void> {
    const stamped = { ...entry, updated_at: nowIso() };
    if (!this.data.has(entry.id)) stamped.created_at = stamped.created_at || nowIso();
    this.data.set(entry.id, stamped);
  }

  async get(id: string): Promise<FactEntry | null> {
    return this.data.get(id) ?? null;
  }

  async list(options: Pick<SearchOptions, 'tags' | 'sensitivity' | 'kind' | 'limit'> = {}): Promise<FactEntry[]> {
    const tagSet = new Set(options.tags ?? []);
    const senSet = new Set(options.sensitivity ?? []);
    const filtered = [...this.data.values()].filter((e) => {
      if (options.kind && e.kind !== options.kind) return false;
      if (senSet.size > 0 && !senSet.has(e.sensitivity)) return false;
      if (tagSet.size > 0 && !e.tags.some((t) => tagSet.has(t))) return false;
      return true;
    });
    return options.limit ? filtered.slice(0, options.limit) : filtered;
  }

  async search(query: string, options: SearchOptions = {}): Promise<Array<SearchHit<FactEntry>>> {
    if (options.vectorOnly) {
      throw new Error('vector search is not available in the in-memory store — use the SQLite+sqlite-vec backend when it ships (v1.2.0-alpha.3)');
    }
    const min = options.minScore ?? 0.05;
    const candidates = await this.list(options);
    const hits = candidates
      .map<SearchHit<FactEntry>>((entry) => {
        const direct = entry.id === query ? 1 : 0;
        const score = direct || lexicalScore(query, entry.body, entry.title, entry.tags);
        return { entry, score, reason: direct ? 'exact-id' : 'lexical' };
      })
      .filter((h) => h.score >= min)
      .sort((a, b) => b.score - a.score);
    return options.limit ? hits.slice(0, options.limit) : hits;
  }

  async delete(id: string): Promise<void> {
    this.data.delete(id);
  }

  async stats(): Promise<MemoryStats> {
    let bytes = 0;
    let lastUpdated: string | null = null;
    for (const e of this.data.values()) {
      bytes += e.body.length + e.title.length;
      if (!lastUpdated || e.updated_at > lastUpdated) lastUpdated = e.updated_at;
    }
    return { prompts: 0, facts: this.data.size, bytes, lastUpdated };
  }
}

export class InMemoryFirmMemory implements FirmMemory {
  public readonly prompts: InMemoryPromptStore;
  public readonly facts: InMemoryFactStore;

  constructor() {
    this.prompts = new InMemoryPromptStore();
    this.facts = new InMemoryFactStore();
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
          ? p.lastUpdated > f.lastUpdated ? p.lastUpdated : f.lastUpdated
          : p.lastUpdated ?? f.lastUpdated,
    };
  }

  async close(): Promise<void> {
    // no-op for in-memory
  }
}
