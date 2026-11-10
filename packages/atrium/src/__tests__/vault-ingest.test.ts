/**
 * Vault -> Firm Memory: mapeamento de sensibilidade, projecao, idempotencia
 * por hash (contra o InMemoryFirmMemory) e peso de curadoria no ranking.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryFirmMemory, type FactEntry } from '@batiste-aidk/memory';
import {
  classificationToSensitivity, decideAction, noteToFact, resolveSensitivity,
  resolveWorkstream, tierToSensitivity, vaultFactId,
} from '../utils/vault-notes.js';
import { curationWeight, searchRanked } from '../utils/rank.js';

const note = (relPath: string, fm: string, body = 'Corpo da nota sobre radar.') =>
  ({ relPath, raw: `---\n${fm}\n---\n\n${body}\n` });

describe('mapeamento de sensibilidade', () => {
  it('tier T0/T1/T2 -> internal/confidential/privileged', () => {
    expect(tierToSensitivity('T0')).toBe('internal');
    expect(tierToSensitivity('t1')).toBe('confidential');
    expect(tierToSensitivity('T2')).toBe('privileged');
    expect(tierToSensitivity('x')).toBeUndefined();
  });
  it('classification -> enum do FM', () => {
    expect(classificationToSensitivity('INTERNAL')).toBe('internal');
    expect(classificationToSensitivity('PUBLIC')).toBe('public');
    expect(classificationToSensitivity('confidential-nda')).toBe('confidential-nda');
    expect(classificationToSensitivity('PII-RESTRICTED-THIRD-PARTY')).toBe('privileged');
  });
  it('vale a mais estrita entre tier_default e classification; sem nada = confidential', () => {
    expect(resolveSensitivity({ tier_default: 'T0', classification: 'confidential' })).toBe('confidential');
    expect(resolveSensitivity({ tier_default: 'T2', classification: 'internal' })).toBe('privileged');
    expect(resolveSensitivity({ tags: '[axis/memory, classification/confidential-nda]' })).toBe('confidential-nda');
    expect(resolveSensitivity({ classification: 'PII-RESTRICTED-THIRD-PARTY  # ou outra' })).toBe('privileged');
    expect(resolveSensitivity({})).toBe('confidential');
  });
});

describe('projecao nota -> fato', () => {
  it('ficha: kind precedent, workstream, tags vault+ficha, vault_ref e id estavel', () => {
    const f = noteToFact(note('05 Memory/Hefesto — painel.md', 'title: Hefesto — painel\nworkstream: hefesto\ntier_default: T1'))!;
    expect(f.kind).toBe('precedent');
    expect(f.workstream).toBe('hefesto');
    expect(f.sensitivity).toBe('confidential');
    expect(f.tags).toEqual(expect.arrayContaining(['vault', 'ficha', 'source:vault']));
    expect(f.vault_ref).toBe('05 Memory/Hefesto — painel.md');
    expect(f.id).toBe(vaultFactId('05 Memory/Hefesto — painel.md'));
  });
  it('decisao e policy viram kind decision; fora das fontes = undefined', () => {
    expect(noteToFact(note('04 Decision/2026-04-21 — X.md', 'title: X\nclassification: public'))!.kind).toBe('decision');
    expect(noteToFact(note('02 Policy/p.md', 'title: P'))!.tags).toContain('policy');
    expect(noteToFact(note('06 Audit/a.md', 'title: A'))).toBeUndefined();
  });
  it('workstream: prefixo do titulo; data ou sem separador = casa', () => {
    expect(resolveWorkstream({}, 'Pegasus — presenca')).toBe('pegasus');
    expect(resolveWorkstream({}, '2026-04-21 — Decline')).toBe('casa');
    expect(resolveWorkstream({}, 'Sem separador')).toBe('casa');
  });
});

describe('idempotencia por hash', () => {
  it('reingestao nao duplica; nota alterada substitui o fato', async () => {
    const fm = new InMemoryFirmMemory();
    const ingest = async (raw: string) => {
      const fact = noteToFact({ relPath: '05 Memory/A — a.md', raw })!;
      const action = decideAction(await fm.facts.get(fact.id), fact);
      if (action !== 'skip') await fm.facts.put(fact);
      return action;
    };
    const v1 = '---\ntitle: A — a\n---\nversao um';
    expect(await ingest(v1)).toBe('insert');
    expect(await ingest(v1)).toBe('skip');
    expect((await fm.facts.list()).length).toBe(1);
    expect(await ingest('---\ntitle: A — a\n---\nversao dois')).toBe('update');
    const all = await fm.facts.list();
    expect(all.length).toBe(1);
    expect(all[0]!.body).toContain('versao dois');
  });
});

describe('ranking: curado vence fragmento de conversa', () => {
  const obs = (id: string, body: string): FactEntry => ({
    id, kind: 'observation', title: 'fragmento de sessao', body, sensitivity: 'confidential',
    tags: ['source:cc-sessions'], created_at: 'x', updated_at: 'x',
  });
  it('pesos', () => {
    expect(curationWeight({ kind: 'observation', tags: [] })).toBeLessThan(curationWeight({ kind: 'decision', tags: [] }));
    expect(curationWeight({ kind: 'decision', tags: [] })).toBeLessThan(curationWeight({ kind: 'precedent', tags: ['source:vault'] }));
  });
  it('ficha do vault fica em 1o mesmo com fragmento de sessao de score cru parecido', async () => {
    const fm = new InMemoryFirmMemory();
    for (let i = 0; i < 30; i++) await fm.facts.put(obs(`o${i}`, 'conversa sobre Griphon radar e outras coisas'));
    const ficha = noteToFact({ relPath: '05 Memory/Griphon — radar.md', raw: '---\ntitle: Griphon — radar\nworkstream: griphon\n---\nGriphon radar ficha curada' })!;
    await fm.facts.put(ficha);
    const hits = await searchRanked(fm.facts, 'Griphon radar', { limit: 3, minScore: 0.05 });
    expect(hits[0]!.entry.id).toBe(ficha.id);
  });
});
