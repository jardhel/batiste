import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdir, rm } from 'fs/promises';
import { ToolHandler } from './handler.js';
import { planMerge } from './task-merge.js';
import type { Task } from '@batiste-aidk/core/tasks';

const describeWithSQLite = process.env.CI ? describe.skip : describe;
type R = Record<string, any>;

const mk = (id: string, label: string, meta: R = {}, extra: Partial<Task> = {}): Task =>
  ({ id, label, status: 'pending', context: { metadata: meta }, createdAt: 100, ...extra }) as Task;

describe('planMerge (puro)', () => {
  const base = { nowSec: 1000, nowIso: '2026-11-04T12:00:00.000Z', getById: () => undefined };
  it('une notas com carimbo e origem, links/tags, registra mergedFrom e arquiva a origem', () => {
    const src = mk('src-1111', 'copia', { notes: [{ at: 'ontem', text: 'achei a causa' }], links: { commit: 'abc', url: 'u1' }, tags: ['a'], phase: 'built', state: { next: 'deploy' } });
    const tgt = mk('tgt-2222', 'alvo', { notes: [{ at: 'x', text: 'nota antiga' }], links: { url: 'u2' }, tags: ['b'], phase: 'todo' });
    const p = planMerge({ ...base, source: src, target: tgt, sourceChildren: [mk('kid-3333', 'filho', {}, { parentId: 'src-1111' })], reason: 'mesma entrega' });
    const notes = p.targetPatch.notes as Array<{ text: string; mergedFrom?: string }>;
    expect(notes[0]!.text).toBe('nota antiga');
    expect(notes.at(-1)!.text).toMatch(/links\.url da origem: u1/);
    expect(notes.some((n) => /\[de src-1111 em ontem\] achei a causa/.test(n.text))).toBe(true);
    expect(notes.some((n) => /\[mesclada de src-1111\] "copia" — mesma entrega/.test(n.text))).toBe(true);
    expect(p.targetPatch.links).toEqual({ url: 'u2', commit: 'abc' });
    expect(p.targetPatch.tags).toEqual(['b', 'a']);
    expect(p.targetPatch.phase).toBe('built');
    expect((p.targetPatch.mergedFrom as R[])[0]).toMatchObject({ id: 'src-1111', label: 'copia', reason: 'mesma entrega' });
    expect(p.sourcePatch.obsolete).toEqual({ reason: 'mesclada em tgt-2222', at: 1000 });
    expect(p.reparent).toEqual(['kid-3333']);
  });
  it('rejeita mesma tarefa, fechada e ciclo; idempotente quando ja mesclada', () => {
    const a = mk('a', 'a');
    const b = mk('b', 'b', {}, { parentId: 'a' });
    expect(() => planMerge({ ...base, source: a, target: a, sourceChildren: [] })).toThrow(/mesma tarefa/);
    expect(() => planMerge({ ...base, source: mk('c', 'c', {}, { status: 'completed' }), target: a, sourceChildren: [] })).toThrow(/ja esta fechada/);
    expect(() => planMerge({ ...base, source: a, target: mk('d', 'd', {}, { status: 'completed' }), sourceChildren: [] })).toThrow(/ja esta fechado/);
    expect(() => planMerge({ ...base, source: a, target: b, sourceChildren: [b], getById: (id) => (id === 'a' ? a : id === 'b' ? b : undefined) })).toThrow(/ciclico/);
    const done = mk('s', 's', { obsolete: { reason: 'mesclada em t' }, mergedInto: 't' }, { status: 'failed' });
    expect(planMerge({ ...base, source: done, target: mk('t', 't'), sourceChildren: [] }).alreadyMerged).toBe(true);
  });
});

describeWithSQLite('manage_task merge / create correlato / triage (handler)', () => {
  let dir: string;
  let h: ToolHandler;
  const mt = async (o: R) => (await h.handleTool('manage_task', o)) as R;

  beforeEach(async () => {
    dir = join(tmpdir(), `mt-merge-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(dir, '.batiste'), { recursive: true });
    h = new ToolHandler(dir, join(dir, '.batiste'));
  });
  afterEach(async () => {
    await h.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('create: >= 0.80 nao cria, devolve a existente (merged:true, score) e anexa a descricao como note', async () => {
    const a = await mt({ action: 'create', label: 'site-a: publicar pagina de precos em producao' });
    const r = await mt({ action: 'create', label: 'site-a: deploy da pagina de precos em producao', note: 'tambem trocar o og:image', tags: ['web'] });
    expect(r.created).toBe(false);
    expect(r.merged).toBe(true);
    expect(r.deduped).toBe(true);
    expect(r.taskId).toBe(a.task.id);
    expect(r.score).toBeGreaterThanOrEqual(0.8);
    const notes = r.task.context.metadata.notes;
    expect(notes[0].text).toMatch(/deploy da pagina de precos.*tambem trocar o og:image/);
    expect(r.task.context.metadata.tags).toEqual(['web']);
    expect((await mt({ action: 'list', status: 'pending' })).matched).toBe(1);
  });

  it('create: 0.50-0.79 cria e devolve related[] com o comando merge exato; allowDuplicate pula tudo', async () => {
    const a = await mt({ action: 'create', label: 'site-a: publicar pagina de precos em producao' });
    const r = await mt({ action: 'create', label: 'site-a: conferir cache da pagina de precos em producao' });
    expect(r.created).toBe(true);
    expect(r.related).toHaveLength(1);
    expect(r.related[0]).toMatchObject({ taskId: a.task.id });
    expect(r.related[0].score).toBeGreaterThanOrEqual(0.5);
    expect(r.related[0].score).toBeLessThan(0.8);
    expect(r.related[0].merge).toBe(`batiste-direct manage_task '${JSON.stringify({ action: 'merge', sourceId: r.task.id, targetId: a.task.id })}'`);
    const dup = await mt({ action: 'create', label: 'site-a: deploy da pagina de precos em producao', allowDuplicate: true });
    expect(dup.created).toBe(true);
    expect(dup.related).toBeUndefined();
  });

  it('merge: alvo absorve notas/links/tags, reparenta filhos, arquiva a origem; idempotente; audit', async () => {
    const tgt = await mt({ action: 'create', label: 'alvo-x tarefa principal', tags: ['t1'], note: 'nota do alvo' });
    const src = await mt({ action: 'create', label: 'origem-y outra coisa', tags: ['t2'], links: { commit: 'abc1234' }, note: 'conhecimento da origem' });
    const kid = await mt({ action: 'create', label: 'filho-z passo seguinte', parentId: src.task.id });
    const r = await mt({ action: 'merge', sourceId: src.task.id, targetId: tgt.task.id, reason: 'mesma entrega' });
    expect(r.merged).toBe(true);
    expect(r.reparented).toEqual([kid.task.id]);
    const t = (await mt({ action: 'get', taskId: tgt.task.id })).task;
    const s = (await mt({ action: 'get', taskId: src.task.id })).task;
    const k = (await mt({ action: 'get', taskId: kid.task.id })).task;
    expect(k.parentId).toBe(tgt.task.id);
    expect(s.status).toBe('failed');
    expect(s.context.metadata.obsolete.reason).toBe(`mesclada em ${tgt.task.id}`);
    expect(s.context.metadata.mergedInto).toBe(tgt.task.id);
    expect(t.context.metadata.mergedFrom).toHaveLength(1);
    expect(t.context.metadata.tags.sort()).toEqual(['t1', 't2']);
    expect(t.context.metadata.links).toEqual({ commit: 'abc1234' });
    const texts = t.context.metadata.notes.map((n: R) => n.text) as string[];
    expect(texts[0]).toBe('nota do alvo');
    expect(texts.some((x) => /conhecimento da origem/.test(x))).toBe(true);
    const again = await mt({ action: 'merge', sourceId: src.task.id, targetId: tgt.task.id });
    expect(again.alreadyMerged).toBe(true);
    expect((await mt({ action: 'get', taskId: tgt.task.id })).task.context.metadata.notes).toHaveLength(texts.length);
    await expect(mt({ action: 'merge', sourceId: tgt.task.id, targetId: tgt.task.id })).rejects.toThrow(/mesma tarefa/);
    await expect(mt({ action: 'merge', sourceId: src.task.id, targetId: kid.task.id })).rejects.toThrow(/fechada/);
    await expect(mt({ action: 'merge', sourceId: tgt.task.id })).rejects.toThrow(/targetId/);
  });

  it('merge ciclico (alvo descendente da origem) e rejeitado', async () => {
    const p = await mt({ action: 'create', label: 'pai-aaa raiz do plano' });
    const c = await mt({ action: 'create', label: 'filho-bbb passo do plano', parentId: p.task.id });
    await expect(mt({ action: 'merge', sourceId: p.task.id, targetId: c.task.id })).rejects.toThrow(/ciclico/);
  });

  it('triage: merge por similaridade (cluster A~B~C, um alvo), dry-run por padrao, apply com confirm mescla', async () => {
    const a = await mt({ action: 'create', label: 'proj-x: publicar pagina de contato em producao' });
    const b = await mt({ action: 'create', label: 'proj-x: deploy da pagina de contato em producao', allowDuplicate: true });
    const c = await mt({ action: 'create', label: 'proj-x: subir pagina de contato para producao', allowDuplicate: true });
    await mt({ action: 'create', label: 'proj-x: calcular imposto do trimestre' });
    const dry = await mt({ action: 'triage' });
    expect(dry.dryRun).toBe(true);
    const merges = dry.items.filter((i: R) => i.kind === 'merge');
    expect(merges).toHaveLength(2);
    expect(new Set(merges.map((m: R) => m.mergeInto)).size).toBe(1);
    expect(dry.mergeClusters[0].targetId).toBe(a.task.id);
    expect(dry.mergeClusters[0].commands[0]).toMatch(/"action":"merge"/);
    expect((await mt({ action: 'list', status: 'pending' })).matched).toBe(4);
    await expect(mt({ action: 'triage', apply: true })).rejects.toThrow(/confirm "TRIAGE"/);
    const ap = await mt({ action: 'triage', apply: true, confirm: 'TRIAGE' });
    expect(ap.merged).toBe(2);
    expect((await mt({ action: 'list', status: 'pending' })).matched).toBe(2);
    expect((await mt({ action: 'get', taskId: a.task.id })).task.context.metadata.mergedFrom).toHaveLength(2);
    expect((await mt({ action: 'get', taskId: b.task.id })).task.context.metadata.mergedInto).toBe(a.task.id);
    expect((await mt({ action: 'get', taskId: c.task.id })).task.status).toBe('failed');
  });
});
