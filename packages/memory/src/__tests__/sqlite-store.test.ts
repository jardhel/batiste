import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  openFirmMemory,
  SqliteFirmMemory,
  type FactEntry,
  type PromptEntry,
} from '../index.js';

// Shared model cache across test runs so we download the 23MB MiniLM once.
const SHARED_MODEL_CACHE = join(tmpdir(), 'batiste-memory-test-models');

function factOf(partial: Partial<FactEntry> & Pick<FactEntry, 'id' | 'title' | 'body'>): FactEntry {
  const now = new Date().toISOString();
  return {
    id: partial.id,
    kind: partial.kind ?? 'observation',
    title: partial.title,
    body: partial.body,
    counterparty: partial.counterparty,
    workstream: partial.workstream,
    sensitivity: partial.sensitivity ?? 'internal',
    tags: partial.tags ?? [],
    vault_ref: partial.vault_ref,
    audit_ref: partial.audit_ref,
    created_at: partial.created_at ?? now,
    updated_at: partial.updated_at ?? now,
  };
}

function promptOf(partial: Partial<PromptEntry> & Pick<PromptEntry, 'id' | 'title' | 'body'>): PromptEntry {
  const now = new Date().toISOString();
  return {
    id: partial.id,
    title: partial.title,
    category: partial.category ?? 'general',
    body: partial.body,
    version: partial.version ?? 1,
    sensitivity: partial.sensitivity ?? 'internal',
    tags: partial.tags ?? [],
    validated_on: partial.validated_on,
    validated_by: partial.validated_by,
    model_preference: partial.model_preference ?? 'any',
    languages: partial.languages ?? [],
    supersedes: partial.supersedes,
    created_at: partial.created_at ?? now,
    updated_at: partial.updated_at ?? now,
  };
}

describe('SqliteFirmMemory', () => {
  let tmp: string;
  let fm: SqliteFirmMemory;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'batiste-memory-'));
    // Point model cache at shared dir so first test downloads; rest reuse.
    process.env.TRANSFORMERS_CACHE = SHARED_MODEL_CACHE;
    fm = await openFirmMemory({ dataDir: tmp, namespace: 'default' });
  });

  afterEach(async () => {
    await fm.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('round-trips a FactEntry (put → get)', async () => {
    const entry = factOf({
      id: 'fact-1',
      title: 'Test fact',
      body: 'This is a body about testing.',
      tags: ['test', 'sample'],
    });
    await fm.facts.put(entry);
    const got = await fm.facts.get('fact-1');
    expect(got).not.toBeNull();
    expect(got?.title).toBe('Test fact');
    expect(got?.tags).toContain('test');
  });

  it('lists facts with tag filter', async () => {
    await fm.facts.put(factOf({ id: 'f1', title: 'A', body: 'alpha', tags: ['x'] }));
    await fm.facts.put(factOf({ id: 'f2', title: 'B', body: 'beta', tags: ['y'] }));
    await fm.facts.put(factOf({ id: 'f3', title: 'C', body: 'gamma', tags: ['x', 'y'] }));

    const xOnly = await fm.facts.list({ tags: ['x'] });
    expect(xOnly.map((e) => e.id).sort()).toEqual(['f1', 'f3']);
  });

  it('finds facts via lexical search', async () => {
    await fm.facts.put(factOf({ id: 'doc-1', title: 'Contract NDA', body: 'Non-disclosure clauses' }));
    await fm.facts.put(factOf({ id: 'doc-2', title: 'Pricing', body: 'Volume discount tiers' }));
    const hits = await fm.facts.search('disclosure');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].entry.id).toBe('doc-1');
  });

  it(
    'finds facts via vector search (semantic)',
    async () => {
      await fm.facts.put(factOf({ id: 'nda', title: 'Non-disclosure agreement', body: 'Parties agree to keep confidential information secret.' }));
      await fm.facts.put(factOf({ id: 'pricing', title: 'Volume pricing tiers', body: 'Discounts scale with usage.' }));
      await fm.facts.put(factOf({ id: 'vacation', title: 'Vacation policy', body: 'Employees accrue 15 days per year.' }));

      const hits = await fm.facts.search('non-disclosure terms', { vectorOnly: true, limit: 5 });
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].entry.id).toBe('nda');
      expect(hits[0].reason).toBe('vector');
    },
    120_000
  );

  it('deletes facts (SQL + vector)', async () => {
    await fm.facts.put(factOf({ id: 'ephemeral', title: 'Will die', body: 'poof' }));
    expect(await fm.facts.get('ephemeral')).not.toBeNull();
    await fm.facts.delete('ephemeral');
    expect(await fm.facts.get('ephemeral')).toBeNull();
  });

  it('round-trips a PromptEntry (put → get)', async () => {
    const entry = promptOf({
      id: 'prompt-1',
      title: 'System preamble',
      body: 'You are a helpful assistant with {{name}}.',
      category: 'system',
      tags: ['system', 'preamble'],
    });
    await fm.prompts.put(entry);
    const got = await fm.prompts.get('prompt-1');
    expect(got?.title).toBe('System preamble');
    expect(got?.category).toBe('system');
  });

  it('reports stats across both stores', async () => {
    await fm.facts.put(factOf({ id: 'f1', title: 'Hello', body: 'world' }));
    await fm.prompts.put(promptOf({ id: 'p1', title: 'Greet', body: 'Say hi to {{name}}.' }));
    const stats = await fm.stats();
    expect(stats.facts).toBe(1);
    expect(stats.prompts).toBe(1);
    expect(stats.bytes).toBeGreaterThan(0);
  });
});

describe('SqliteFirmMemory namespace isolation (ADR-0002 gate)', () => {
  let dataDir: string;
  let fmA: SqliteFirmMemory;
  let fmB: SqliteFirmMemory;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'batiste-memory-iso-'));
    process.env.TRANSFORMERS_CACHE = SHARED_MODEL_CACHE;
    fmA = await openFirmMemory({ dataDir, namespace: 'tenant-a' });
    fmB = await openFirmMemory({ dataDir, namespace: 'tenant-b' });
  });

  afterEach(async () => {
    await fmA.close();
    await fmB.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it(
    'does not leak facts across tenants (lexical)',
    async () => {
      await fmA.facts.put(
        factOf({ id: 'secret-a', title: 'Tenant A secret', body: 'Confidential strategy memo alpha.' })
      );

      const fromBLexical = await fmB.facts.search('strategy memo');
      expect(fromBLexical).toHaveLength(0);

      const directB = await fmB.facts.get('secret-a');
      expect(directB).toBeNull();

      // Sanity: tenant A still sees its own.
      const fromA = await fmA.facts.search('strategy memo');
      expect(fromA.length).toBeGreaterThan(0);
      expect(fromA[0].entry.id).toBe('secret-a');
    },
    120_000
  );

  it(
    'does not leak facts across tenants (vector)',
    async () => {
      await fmA.facts.put(
        factOf({ id: 'patient-42', title: 'Patient record', body: 'Medical condition: hypertension. Treatment plan: lifestyle.' })
      );

      const fromBVec = await fmB.facts.search('hypertension treatment', { vectorOnly: true, limit: 10 });
      expect(fromBVec).toHaveLength(0);

      const fromAVec = await fmA.facts.search('hypertension treatment', { vectorOnly: true, limit: 10 });
      expect(fromAVec.length).toBeGreaterThan(0);
      expect(fromAVec[0].entry.id).toBe('patient-42');
    },
    120_000
  );

  it('stats are per-namespace', async () => {
    await fmA.facts.put(factOf({ id: 'a-1', title: 'A', body: 'A body' }));
    await fmA.facts.put(factOf({ id: 'a-2', title: 'A2', body: 'A2 body' }));
    await fmB.facts.put(factOf({ id: 'b-1', title: 'B', body: 'B body' }));

    const statsA = await fmA.stats();
    const statsB = await fmB.stats();
    expect(statsA.facts).toBe(2);
    expect(statsB.facts).toBe(1);
  });
});
