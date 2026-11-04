/**
 * manage_task merge — planejamento PURO da mescla (sem I/O; o handler aplica o plano).
 *
 * Tarefa correlata se mescla, nao se duplica: o alvo absorve a origem sem perder conhecimento.
 *   - notes: append-only, cada nota da origem entra no alvo com carimbo e origem
 *   - links/tags/refs: uniao (em conflito de chave de link, o alvo vence e o valor da origem vai na nota)
 *   - filhos da origem: reparentados para o alvo
 *   - metadata.mergedFrom[]: registro da mescla (idempotente por id)
 *   - origem: arquivada (status failed + obsolete 'mesclada em <targetId>'), como o archive
 */

import type { Task } from '@batiste-aidk/core/tasks';
import { TaskInputError, metaOf, isOpen, isObsolete, PHASES } from './task-actions.js';

export interface MergeInput {
  source: Task;
  target: Task;
  /** filhos diretos da origem (para reparentar) */
  sourceChildren: Task[];
  /** resolve ancestrais para detectar ciclo */
  getById: (id: string) => Task | undefined;
  reason?: string;
  nowSec: number;
  nowIso: string;
}

export interface MergePlan {
  /** ja era uma mescla desta origem neste alvo: nada a fazer */
  alreadyMerged: boolean;
  targetPatch: Record<string, unknown>;
  sourcePatch: Record<string, unknown>;
  reparent: string[];
  notesAppended: number;
}

const isClosed = (t: Task): boolean => t.status === 'completed' || (t.status === 'failed' && isObsolete(t));
const short = (id: string): string => id.slice(0, 8);

type Note = { at?: string; text?: string; [k: string]: unknown };

const uniq = <T>(a: T[]): T[] => [...new Set(a)];
const phaseIdx = (t: Task): number => Math.max(0, (PHASES as readonly string[]).indexOf(String(metaOf(t).phase ?? 'todo')));

export function planMerge(inp: MergeInput): MergePlan {
  const { source, target, nowIso, nowSec } = inp;
  if (source.id === target.id) {
    throw new TaskInputError('merge: sourceId e targetId sao a mesma tarefa. Exemplo: {"action":"merge","sourceId":"<id-da-copia>","targetId":"<id-que-fica>"}');
  }
  const sm = metaOf(source);
  const tm = metaOf(target);

  // idempotencia: reexecutar a mesma mescla e inofensivo
  if (isObsolete(source) && sm.mergedInto === target.id) {
    return { alreadyMerged: true, targetPatch: {}, sourcePatch: {}, reparent: [], notesAppended: 0 };
  }
  if (isClosed(source)) {
    throw new TaskInputError(`merge: a origem ${source.id} ja esta fechada (${source.status}); so se mescla tarefa aberta.`);
  }
  if (isClosed(target)) {
    throw new TaskInputError(`merge: o alvo ${target.id} ja esta fechado (${target.status}); escolha um alvo aberto (ou reabra com update reopen:true).`);
  }
  if (!isOpen(source) || !isOpen(target)) {
    throw new TaskInputError('merge: origem e alvo precisam estar abertas (pending/running).');
  }
  // ciclo: o alvo nao pode ser descendente da origem (a origem vira obsoleta; filhos iriam para um no dentro da propria subarvore)
  const seen = new Set<string>();
  for (let cur: Task | undefined = target; cur; cur = cur.parentId ? inp.getById(cur.parentId) : undefined) {
    if (cur.id === source.id && cur.id !== target.id) {
      throw new TaskInputError(`merge ciclico: o alvo ${target.id} e descendente da origem ${source.id}. Mescle na outra direcao (origem e alvo trocados).`);
    }
    if (seen.has(cur.id)) break;
    seen.add(cur.id);
  }

  // notas: cabecalho + notas da origem (append-only, com carimbo e origem)
  const header: Note = {
    at: nowIso,
    text: `[mesclada de ${short(source.id)}] "${source.label}"${inp.reason ? ` — ${inp.reason}` : ''}`,
    mergedFrom: source.id,
  };
  const srcNotes = ((sm.notes as Note[] | undefined) ?? []).filter((n) => typeof n?.text === 'string');
  const moved: Note[] = srcNotes.map((n) => ({
    at: nowIso,
    text: `[de ${short(source.id)}${n.at ? ` em ${n.at}` : ''}] ${n.text}`,
    mergedFrom: source.id,
  }));
  const extra: string[] = [];

  const sState = (sm.state ?? {}) as Record<string, unknown>;
  const tState = (tm.state ?? {}) as Record<string, unknown>;
  const stateOut: Record<string, unknown> = { ...tState };
  for (const [k, v] of Object.entries(sState)) {
    if (stateOut[k] === undefined || stateOut[k] === '') stateOut[k] = v;
    else if (JSON.stringify(stateOut[k]) !== JSON.stringify(v)) extra.push(`state.${k} da origem: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  }

  const sLinks = (sm.links ?? {}) as Record<string, unknown>;
  const tLinks = (tm.links ?? {}) as Record<string, unknown>;
  const linksOut: Record<string, unknown> = { ...tLinks };
  for (const [k, v] of Object.entries(sLinks)) {
    if (linksOut[k] === undefined) linksOut[k] = v;
    else if (linksOut[k] !== v) extra.push(`links.${k} da origem: ${String(v)}`);
  }
  if (extra.length) moved.push({ at: nowIso, text: `[de ${short(source.id)}] valores divergentes preservados: ${extra.join('; ')}`, mergedFrom: source.id });

  const tags = uniq([...(Array.isArray(tm.tags) ? (tm.tags as string[]) : []), ...(Array.isArray(sm.tags) ? (sm.tags as string[]) : [])]);
  const refs = uniq([...(Array.isArray(tm.refs) ? (tm.refs as string[]) : []), ...(Array.isArray(sm.refs) ? (sm.refs as string[]) : [])]);

  const mergedFrom = [...((tm.mergedFrom as Array<{ id: string }> | undefined) ?? [])];
  if (!mergedFrom.some((m) => m.id === source.id)) {
    mergedFrom.push({
      id: source.id, label: source.label, at: nowSec, status: source.status,
      ...(inp.reason ? { reason: inp.reason } : {}), notes: srcNotes.length,
      ...(Array.isArray(sm.mergedFrom) && (sm.mergedFrom as unknown[]).length ? { carried: (sm.mergedFrom as Array<{ id: string }>).map((m) => m.id) } : {}),
    } as { id: string });
  }
  // o alvo herda o historico de mesclas anteriores da origem
  for (const m of (sm.mergedFrom as Array<{ id: string }> | undefined) ?? []) if (!mergedFrom.some((x) => x.id === m.id)) mergedFrom.push(m);

  const targetPatch: Record<string, unknown> = {
    notes: [...((tm.notes as Note[] | undefined) ?? []), header, ...moved],
    mergedFrom,
    ...(Object.keys(stateOut).length ? { state: stateOut } : {}),
    ...(Object.keys(linksOut).length ? { links: linksOut } : {}),
    ...(tags.length ? { tags } : {}),
    ...(refs.length ? { refs } : {}),
    ...(phaseIdx(source) > phaseIdx(target) ? { phase: sm.phase } : {}),
  };
  const sourcePatch: Record<string, unknown> = {
    obsolete: { reason: `mesclada em ${target.id}`, at: nowSec },
    mergedInto: target.id,
    ...(inp.reason ? { mergeReason: inp.reason } : {}),
  };
  return {
    alreadyMerged: false,
    targetPatch,
    sourcePatch,
    reparent: inp.sourceChildren.filter((c) => c.id !== target.id).map((c) => c.id),
    notesAppended: 1 + moved.length,
  };
}
