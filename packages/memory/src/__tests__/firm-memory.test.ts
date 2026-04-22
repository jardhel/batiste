import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryFirmMemory,
  PromptEntrySchema,
  FactEntrySchema,
  type PromptEntry,
  type FactEntry,
} from '../index.js';

function makePrompt(overrides: Partial<PromptEntry> = {}): PromptEntry {
  const now = new Date().toISOString();
  return {
    id: 'commercial-reset-package',
    title: 'Commercial reset package',
    category: 'deal-making',
    body: 'Generate email + minuta for scope-creep client reset with deadline.',
    version: 1,
    sensitivity: 'confidential',
    tags: ['deal-making', 'reset', 'commercial'],
    model_preference: 'any',
    languages: ['pt'],
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function makeFact(overrides: Partial<FactEntry> = {}): FactEntry {
  const now = new Date().toISOString();
  return {
    id: 'decision-inside-orchestration',
    kind: 'decision',
    title: 'Inside orchestration as primary thesis',
    body: 'Firm positioning crystallized — integrators license capability; resale without disclosure by design.',
    sensitivity: 'public',
    tags: ['thesis', 'positioning'],
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('InMemoryFirmMemory', () => {
  let mem: InMemoryFirmMemory;

  beforeEach(() => {
    mem = new InMemoryFirmMemory();
  });

  it('PromptStore round-trips an entry', async () => {
    const p = makePrompt();
    await mem.prompts.put(p);
    const got = await mem.prompts.get('commercial-reset-package');
    expect(got?.title).toBe('Commercial reset package');
  });

  it('PromptStore filters by tag', async () => {
    await mem.prompts.put(makePrompt());
    await mem.prompts.put(
      makePrompt({ id: 'prospect-pre-read', title: 'Prospect pre-read', category: 'deal-making', tags: ['prospect', 'pre-read'] }),
    );
    await mem.prompts.put(
      makePrompt({ id: 'gvs-note-stamper', title: 'GVS note stamper', category: 'governance', tags: ['governance', 'gvs'] }),
    );

    const gov = await mem.prompts.list({ tags: ['governance'] });
    expect(gov).toHaveLength(1);
    expect(gov[0]?.id).toBe('gvs-note-stamper');
  });

  it('PromptStore lexical search finds by body keyword', async () => {
    await mem.prompts.put(makePrompt());
    await mem.prompts.put(
      makePrompt({ id: 'prospect-pre-read', title: 'Prospect pre-read', body: 'Generate a 4-page pre-read PDF for a cold prospect.', tags: [] }),
    );

    const hits = await mem.prompts.search('reset minuta');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.entry.id).toBe('commercial-reset-package');
  });

  it('PromptStore search rejects vectorOnly — signalling that vector backend is not wired yet', async () => {
    await mem.prompts.put(makePrompt());
    await expect(mem.prompts.search('reset', { vectorOnly: true })).rejects.toThrow(/vector search.*not available/);
  });

  it('FactStore round-trips a decision and filters by kind', async () => {
    await mem.facts.put(makeFact());
    await mem.facts.put(
      makeFact({ id: 'precedent-whatsapp-nori', kind: 'precedent', title: 'WhatsApp Nori agreement', body: 'USD 40k (20+20) for phase 1+2 agreed informally.' }),
    );

    const precedents = await mem.facts.list({ kind: 'precedent' });
    expect(precedents).toHaveLength(1);
    expect(precedents[0]?.id).toBe('precedent-whatsapp-nori');
  });

  it('stats aggregate across both stores', async () => {
    await mem.prompts.put(makePrompt());
    await mem.facts.put(makeFact());
    const s = await mem.stats();
    expect(s.prompts).toBe(1);
    expect(s.facts).toBe(1);
    expect(s.bytes).toBeGreaterThan(0);
  });

  it('schema validates entries', () => {
    const valid = makePrompt();
    expect(() => PromptEntrySchema.parse(valid)).not.toThrow();
    const invalid = { ...valid, version: -1 };
    expect(() => PromptEntrySchema.parse(invalid)).toThrow();

    const validFact = makeFact();
    expect(() => FactEntrySchema.parse(validFact)).not.toThrow();
    const invalidFact = { ...validFact, kind: 'nonsense' } as unknown;
    expect(() => FactEntrySchema.parse(invalidFact)).toThrow();
  });

  it('exact-id search returns score 1', async () => {
    await mem.prompts.put(makePrompt());
    const hits = await mem.prompts.search('commercial-reset-package');
    expect(hits[0]?.reason).toBe('exact-id');
    expect(hits[0]?.score).toBe(1);
  });
});
