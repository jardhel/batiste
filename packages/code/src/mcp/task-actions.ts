/**
 * manage_task — contrato por ação, validação, ajuda e análise (triage/report).
 *
 * Nasceu da auditoria de 2026-11-04 (239 tarefas, 76 pendentes com mais de 60 dias,
 * 6 já publicadas e nunca fechadas). O estado apodrecia porque: (1) o texto do label
 * carregava o estado, (2) `completed` era um update livre sem motivo, (3) a CLI
 * engolia `id` e respondia "Task not found: undefined".
 *
 * Tudo aqui é puro (sem I/O) para ser testável; o handler só liga ao TaskManager.
 * O estado estruturado mora em `task.context.metadata` (aditivo: bancos antigos
 * continuam válidos, sem migração):
 *   state    { next, gate }            próximo passo / gate pendente
 *   links    { commit, deploy, release, url }
 *   phase    todo|doing|built|deployed|verified
 *   closed   { proof, at }             fechamento com prova
 *   obsolete { reason, at }            arquivada (status failed + marca)
 *   renewedUntil { until, reason, at } renovação consciente do prazo de stale
 *   notes    [{ at, text }]            append-only
 *   mergedFrom [{ id, label, at, reason }]  mesclas que este alvo absorveu (merge)
   mergedInto  id do alvo (na origem arquivada por merge)
   dedupeKey, tags
 */

import type { Task } from '@batiste-aidk/core/tasks';
import { asText } from './safe.js';
import { clusterSimilar, findSimilar, allPairs, pickTarget, mergeCommand, THRESHOLD_SAME, THRESHOLD_RELATED, type SimTask } from './task-similarity.js';

export const TASK_ACTIONS = [
  'create', 'update', 'get', 'list', 'tree', 'clear', 'reconcile', 'stale',
  'close', 'archive', 'renew', 'merge', 'triage', 'report',
] as const;
export type TaskAction = (typeof TASK_ACTIONS)[number];

export const PHASES = ['todo', 'doing', 'built', 'deployed', 'verified'] as const;
export const LABEL_MAX = 120;
export const DAY = 86_400;
/** Teto do renew: acima disso vira arquivo por outro nome (burla do gate de stale). */
export const RENEW_MAX_DAYS = 45;
export const RENEW_MIN_REASON = 15;
export const RENEW_WARN_COUNT = 2;

/** Erro de contrato: a mensagem já diz o campo certo e traz um exemplo copiável. */
export class TaskInputError extends Error {
  public readonly code = 'TASK_INPUT_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'TaskInputError';
  }
}

interface ActionSpec {
  summary: string;
  required: string[];
  optional: string[];
  examples: string[];
}

const COMMON_META = ['state', 'links', 'phase', 'tags', 'note'];

export const ACTION_SPECS: Record<TaskAction, ActionSpec> = {
  create: {
    summary: `cria tarefa. label curto (ate ${String(LABEL_MAX)} chars); estado vai em state/links, nunca no label. ` +
      `Compara com as ABERTAS: score >= ${String(THRESHOLD_SAME)} = mesma tarefa (nao cria; devolve a existente com merged:true e anexa a descricao como note); ` +
      `${String(THRESHOLD_RELATED)}-${(THRESHOLD_SAME - 0.01).toFixed(2)} = correlata (cria e devolve related[] com o comando merge). allowDuplicate:true pula tudo.`,
    required: ['label'],
    optional: ['parentId', 'dedupeKey', 'allowDuplicate', ...COMMON_META],
    examples: [
      '{"action":"create","label":"hefesto-pacote-segunda","state":{"next":"deploy","gate":"prova-no-ar"}}',
      '{"action":"create","label":"proposta-x","dedupeKey":"proposta:x:2026-11"}',
    ],
  },
  update: {
    summary: 'muda status/estado. completed exige proof ou reason (ou use close). note e append-only.',
    required: ['taskId'],
    optional: ['status', 'label', 'toolOutput', 'proof', 'reason', 'reopen', ...COMMON_META],
    examples: [
      '{"action":"update","taskId":"<id>","status":"running","note":"comecei o deploy"}',
      '{"action":"update","taskId":"<id>","phase":"built","links":{"commit":"abc1234"}}',
      '{"action":"update","taskId":"<id>","toolOutput":{"output":{"ok":true}}}   // toolName e opcional',
    ],
  },
  get: {
    summary: 'le uma tarefa. Id inexistente e erro (exit 1).',
    required: ['taskId'],
    optional: [],
    examples: ['{"action":"get","taskId":"<id>"}'],
  },
  list: {
    summary: 'lista tarefas. Filtros e modo compacto (sem context) para nao despejar o board inteiro.',
    required: [],
    optional: ['status', 'olderThanDays', 'labelPrefix', 'limit', 'compact'],
    examples: [
      '{"action":"list","status":"pending","olderThanDays":60,"compact":true,"limit":20}',
      '{"action":"list","labelPrefix":"proposta-gerada","compact":true}',
    ],
  },
  tree: { summary: 'arvore de tarefas.', required: [], optional: [], examples: ['{"action":"tree"}'] },
  clear: {
    summary: 'APAGA todas as tarefas (faz backup do tasks.db antes). Exige confirm igual a "APAGAR <N> TAREFAS".',
    required: [],
    optional: ['confirm'],
    examples: ['{"action":"clear","confirm":"APAGAR 239 TAREFAS"}   // N = contagem atual'],
  },
  reconcile: {
    summary: 'fecha tarefas pelos trailers Task-done: dos commits (prova = sha). Avisa ambiguidade e janela perdida.',
    required: [],
    optional: ['since', 'staleDays'],
    examples: ['{"action":"reconcile"}', '{"action":"reconcile","since":"HEAD~50"}'],
  },
  stale: {
    summary: 'sinaliza pendentes antigas e running sem heartbeat (48 h). So mostra; nao fecha.',
    required: [],
    optional: ['staleDays', 'runningStaleHours'],
    examples: ['{"action":"stale","staleDays":30}'],
  },
  close: {
    summary: 'fecha com prova (status completed). proof = commit, url, id de deploy ou saida de prova-no-ar.',
    required: ['taskId', 'proof'],
    optional: ['links', 'note'],
    examples: ['{"action":"close","taskId":"<id>","proof":"commit e36e6ef + prova-no-ar verde https://x.cachola.tech/"}'],
  },
  archive: {
    summary: 'arquiva como obsoleta (status failed + marca obsolete). reason obrigatorio.',
    required: ['taskId', 'reason'],
    optional: ['note'],
    examples: ['{"action":"archive","taskId":"<id>","reason":"plano fora do ar; superado por X"}'],
  },
  renew: {
    summary: 'renova conscientemente o prazo de stale ate uma data (maximo 45 dias a frente). reason obrigatorio, minimo 15 caracteres; a 3a renovacao avisa.',
    required: ['taskId', 'until', 'reason'],
    optional: [],
    examples: [
      '{"action":"renew","taskId":"<id>","until":"2026-12-01","reason":"aguardando resposta do cliente"}',
      '{"action":"renew","taskId":"<id>","until":"+14d","reason":"bloqueada por falta de credito na conta"}',
    ],
  },
  merge: {
    summary: 'mescla tarefa correlata: o alvo absorve a origem (notes append-only com carimbo/origem, une links/tags/refs, reparenta filhos, registra metadata.mergedFrom) e a origem e arquivada como "mesclada em <targetId>". Idempotente; rejeita ciclo e tarefa fechada.',
    required: ['sourceId', 'targetId'],
    optional: ['reason'],
    examples: [
      '{"action":"merge","sourceId":"<id-da-copia>","targetId":"<id-que-fica>","reason":"mesma entrega, nomes diferentes"}',
    ],
  },
  triage: {
    summary: `lista candidatas a fechar/arquivar/mesclar. 'mesclar' usa similaridade (>= ${String(THRESHOLD_SAME)}, clusters A~B~C com alvo sugerido); correlatas ${String(THRESHOLD_RELATED)}-${(THRESHOLD_SAME - 0.01).toFixed(2)} saem em suggestions. Dry-run por padrao; apply:true + confirm:"TRIAGE" arquiva as de arquivar e MESCLA as de mesclar.`,
    required: [],
    optional: ['staleDays', 'minGroup', 'apply', 'confirm'],
    examples: ['{"action":"triage"}', '{"action":"triage","staleDays":60,"minGroup":5}'],
  },
  report: {
    summary: 'burn-down: criadas vs concluidas por mes, idade p50/p90 dos abertos, top prefixos, % concluidas com prova.',
    required: [],
    optional: ['months'],
    examples: ['{"action":"report"}'],
  },
};

const ALL_KEYS = new Set<string>([
  'action', 'taskId', 'label', 'parentId', 'status', 'toolOutput', 'since', 'staleDays',
  'runningStaleHours', 'proof', 'reason', 'until', 'reopen', 'confirm', 'apply', 'minGroup',
  'olderThanDays', 'labelPrefix', 'limit', 'compact', 'months', 'dedupeKey', 'allowDuplicate', 'help', 'sourceId', 'targetId',
  ...COMMON_META,
]);

const ALIASES: Record<string, string> = { id: 'taskId', task_id: 'taskId', task: 'taskId', evidence: 'proof', motivo: 'reason' };

function levenshtein(a: string, b: string): number {
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur.push(Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost));
    }
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

export function didYouMean(key: string): string | null {
  const alias = ALIASES[key];
  if (alias) return alias;
  let best: string | null = null;
  let bestD = 3;
  for (const k of ALL_KEYS) {
    const d = levenshtein(key.toLowerCase(), k.toLowerCase());
    if (d < bestD) { bestD = d; best = k; }
  }
  return best;
}

export function exampleFor(action: TaskAction): string {
  return ACTION_SPECS[action].examples[0] ?? '';
}

export interface NormalizedTaskArgs {
  args: Record<string, unknown>;
  warnings: string[];
}

/**
 * Normaliza ANTES do zod (que descartaria chaves desconhecidas em silencio):
 * alias id -> taskId (com aviso), chaves desconhecidas = erro com "voce quis dizer",
 * campos obrigatorios por acao com exemplo copiavel.
 */
export function normalizeTaskArgs(raw: Record<string, unknown>): NormalizedTaskArgs {
  const warnings: string[] = [];
  const args: Record<string, unknown> = { ...raw };
  const action = args.action;
  if (typeof action !== 'string' || !(TASK_ACTIONS as readonly string[]).includes(action)) {
    throw new TaskInputError(
      `action invalida: ${JSON.stringify(action)}. Use uma de: ${TASK_ACTIONS.join(', ')}. ` +
        `Exemplo: {"action":"list","compact":true}`
    );
  }
  const spec = ACTION_SPECS[action as TaskAction];

  for (const [alias, canon] of Object.entries(ALIASES)) {
    if (alias in args) {
      if (args[canon] === undefined) {
        args[canon] = args[alias];
        warnings.push(`campo '${alias}' aceito como alias de '${canon}' (preferido: '${canon}')`);
      } else if (args[canon] !== args[alias]) {
        throw new TaskInputError(`'${alias}' e '${canon}' foram enviados com valores diferentes; envie so '${canon}'.`);
      }
      Reflect.deleteProperty(args, alias);
    }
  }

  for (const key of Object.keys(args)) {
    if (!ALL_KEYS.has(key)) {
      const guess = didYouMean(key);
      throw new TaskInputError(
        `campo desconhecido '${key}' em manage_task.${action}` +
          (guess ? ` (voce quis dizer '${guess}'?)` : '') +
          `. Campos aceitos nesta acao: ${['action', ...spec.required, ...spec.optional].join(', ')}. ` +
          `Exemplo: ${exampleFor(action as TaskAction)}`
      );
    }
  }

  for (const req of spec.required) {
    const v = args[req];
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
      throw new TaskInputError(
        `campo obrigatorio '${req}' ausente em manage_task.${action}. Exemplo: ${exampleFor(action as TaskAction)}`
      );
    }
  }

  if (action === 'create') {
    const label = asText(args.label).trim();
    if (label.length > LABEL_MAX) {
      throw new TaskInputError(
        `label com ${String(label.length)} chars (limite ${String(LABEL_MAX)}). Label e titulo, nao estado: ` +
          `mova o resto para state ({"next":"...","gate":"..."}), links ou note. Exemplo: ${exampleFor('create')}`
      );
    }
    args.label = label;
  }
  if (action === 'update') {
    const mutating = ['status', 'label', 'toolOutput', 'state', 'links', 'phase', 'tags', 'note', 'proof', 'reason'];
    if (!mutating.some((k) => args[k] !== undefined)) {
      throw new TaskInputError(
        `update sem nada para mudar. Envie ao menos um de: status, state, links, phase, tags, note, toolOutput. ` +
          `Exemplo: ${exampleFor('update')}`
      );
    }
    if (typeof args.label === 'string' && args.label.length > LABEL_MAX) {
      throw new TaskInputError(`label com ${String(args.label.length)} chars (limite ${String(LABEL_MAX)}); use note/state para o resto.`);
    }
  }
  if (args.phase !== undefined && !(PHASES as readonly string[]).includes(asText(args.phase))) {
    throw new TaskInputError(`phase invalida '${asText(args.phase)}'. Use: ${PHASES.join(', ')}.`);
  }
  if (args.toolOutput !== undefined) {
    const to = args.toolOutput as Record<string, unknown> | null;
    if (!to || typeof to !== 'object' || !('output' in to)) {
      throw new TaskInputError(
        `toolOutput deve ser objeto {"output": ...} (toolName e opcional, padrao "manual"). ` +
          `Exemplo: {"action":"update","taskId":"<id>","toolOutput":{"toolName":"deploy","output":{"ok":true}}}`
      );
    }
    args.toolOutput = { toolName: typeof to.toolName === 'string' && to.toolName ? to.toolName : 'manual', output: to.output };
  }
  if (action === 'merge') {
    if (asText(args.sourceId).trim() === asText(args.targetId).trim()) {
      throw new TaskInputError(`merge: sourceId e targetId sao a mesma tarefa. Exemplo: ${exampleFor('merge')}`);
    }
    args.sourceId = asText(args.sourceId).trim();
    args.targetId = asText(args.targetId).trim();
    if (args.reason !== undefined) args.reason = asText(args.reason).trim();
  }
  if (action === 'renew') {
    args.until = parseUntil(asText(args.until));
    const reason = asText(args.reason ?? '').trim();
    if (reason.length < RENEW_MIN_REASON) {
      throw new TaskInputError(`reason do renew precisa de ao menos ${String(RENEW_MIN_REASON)} caracteres (explique o bloqueio de verdade). Exemplo: ${exampleFor('renew')}`);
    }
    args.reason = reason;
  }
  return { args, warnings };
}

/** "2026-12-01" ou "+14d" -> data ISO (YYYY-MM-DD). */
export function parseUntil(until: string, now: Date = new Date()): string {
  const rel = /^\+(\d+)d$/.exec(until.trim());
  if (rel) {
    const d = new Date(now.getTime() + Number(rel[1]) * DAY * 1000);
    return capUntil(d.toISOString().slice(0, 10), now);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until.trim()) || Number.isNaN(Date.parse(until))) {
    throw new TaskInputError(`until invalido '${until}'. Use AAAA-MM-DD ou +Nd. Exemplo: ${exampleFor('renew')}`);
  }
  return capUntil(until.trim(), now);
}

function capUntil(iso: string, now: Date): string {
  const days = Math.floor((Date.parse(iso) - now.getTime()) / (DAY * 1000));
  if (days > RENEW_MAX_DAYS) {
    throw new TaskInputError(`until ${iso} esta ${String(days)} dias a frente; o teto do renew e ${String(RENEW_MAX_DAYS)} dias. Passou disso: arquive ou feche.`);
  }
  return iso;
}

export function formatHelp(action?: string): string {
  if (action && (TASK_ACTIONS as readonly string[]).includes(action)) {
    const s = ACTION_SPECS[action as TaskAction];
    return [
      `manage_task ${action}: ${s.summary}`,
      `  obrigatorios: ${s.required.join(', ') || '(nenhum)'}`,
      `  opcionais:    ${s.optional.join(', ') || '(nenhum)'}`,
      `  exemplos (batiste-direct manage_task '<json>'):`,
      ...s.examples.map((e) => `    ${e}`),
    ].join('\n');
  }
  return [
    'manage_task: DAG de tarefas persistente. Acoes:',
    ...TASK_ACTIONS.map((a) => `  ${a.padEnd(10)} ${ACTION_SPECS[a].summary}`),
    '',
    "Ajuda por acao: batiste-direct manage_task <acao> --help",
    "Alias aceito: id -> taskId. toolOutput.toolName e opcional. Campos desconhecidos sao erro.",
  ].join('\n');
}

// ------------------------------------------------------------------ metadados e transicoes

export type Meta = Record<string, unknown>;
export const metaOf = (t: Task): Meta => (t.context.metadata ?? {});
export const isOpen = (t: Task): boolean => t.status === 'pending' || t.status === 'running';
export const isObsolete = (t: Task): boolean => !!metaOf(t).obsolete;

/** completed e arquivada (failed+obsolete) sao terminais: sair delas exige reopen:true com reason. */
export function checkTransition(task: Task, to: Task['status'], opts: { reopen?: boolean; reason?: string }): void {
  const terminal = task.status === 'completed' || (task.status === 'failed' && isObsolete(task));
  if (terminal && to !== task.status) {
    if (!opts.reopen || !opts.reason) {
      throw new TaskInputError(
        `transicao ${task.status} -> ${to} negada: ${task.status === 'completed' ? 'completed' : 'arquivada'} e terminal. ` +
          `Para reabrir envie reopen:true e reason. Exemplo: {"action":"update","taskId":"${task.id}","status":"${to}","reopen":true,"reason":"regrediu em prod"}`
      );
    }
  }
}

export function labelPrefix(label: string): string {
  const first = label.trim().toLowerCase().split(/[\s:·—]/)[0] ?? '';
  return first.split('-').slice(0, 2).join('-');
}

const OBSOLETE_RE = /fora do ar|obsolet|superad|dropad|descontinu|cancelad|n[aã]o vamos|abandon/i;

export interface TriageCandidate {
  kind: 'archive' | 'merge' | 'close-parent-done' | 'abandon-running';
  taskId: string;
  label: string;
  ageDays: number;
  prefix: string;
  reason: string;
  mergeInto?: string;
  score?: number;
}

export function ageDays(t: Task, now: number): number {
  return t.updatedAt == null ? 0 : Math.floor((now - t.updatedAt) / DAY);
}

/** Candidatas — nunca executa. O handler so aplica com apply:true + confirm. */
export function triage(tasks: Task[], opts: { now: number; staleDays?: number; minGroup?: number; runningHours?: number }): TriageCandidate[] {
  const staleDays = opts.staleDays ?? 60;
  const minGroup = opts.minGroup ?? 5;
  const runningHours = opts.runningHours ?? 48;
  const out: TriageCandidate[] = [];
  const picked = new Set<string>();
  const push = (c: TriageCandidate) => { if (!picked.has(c.taskId)) { picked.add(c.taskId); out.push(c); } };
  const open = tasks.filter(isOpen);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const renewed = (t: Task) => {
    const r = metaOf(t).renewedUntil as { until?: string; reason?: string; at?: number } | undefined;
    if (!r?.until || (r.reason ?? '').trim().length < RENEW_MIN_REASON) return false;
    const until = Date.parse(r.until);
    return until >= opts.now * 1000 && until <= ((r.at ?? opts.now) + RENEW_MAX_DAYS * DAY) * 1000 + DAY * 1000;
  };

  for (const t of open) {
    const text = `${t.label} ${JSON.stringify(metaOf(t).state ?? '')}`;
    if (OBSOLETE_RE.test(text) && !renewed(t)) {
      push({ kind: 'archive', taskId: t.id, label: t.label, ageDays: ageDays(t, opts.now), prefix: labelPrefix(t.label), reason: `marcada como obsoleta no texto (${OBSOLETE_RE.exec(text)?.[0] ?? ''})` });
    }
  }
  for (const t of open) {
    if (t.status === 'running' && t.updatedAt != null && opts.now - t.updatedAt > runningHours * 3600 && !renewed(t)) {
      push({ kind: 'abandon-running', taskId: t.id, label: t.label, ageDays: ageDays(t, opts.now), prefix: labelPrefix(t.label), reason: `running sem update ha mais de ${String(runningHours)} h` });
    }
  }
  // correlatas/duplicadas: similaridade >= THRESHOLD_SAME (label identico = 1.0). Cluster A~B~C -> um alvo
  // (maior fase, depois o mais antigo); as demais viram candidatas 'merge' (nao arquivar a toa: o merge preserva notas).
  const clusters = clusterSimilar(open, { threshold: THRESHOLD_SAME });
  for (const cl of clusters) {
    const target = byId.get(cl.targetId);
    if (!target) continue;
    for (const m of cl.merges) {
      const src = byId.get(m.sourceId);
      if (!src) continue;
      push({ kind: 'merge', taskId: src.id, label: src.label, ageDays: ageDays(src, opts.now), prefix: labelPrefix(src.label), reason: `correlata de ${target.id.slice(0, 8)} (score ${String(m.score)})`, mergeInto: target.id, score: m.score });
    }
  }
  // grupos de prefixo inteiros parados: proposta-* com >= minGroup abertas e todas antigas
  const byPrefix = new Map<string, Task[]>();
  for (const t of open) byPrefix.set(labelPrefix(t.label), [...(byPrefix.get(labelPrefix(t.label)) ?? []), t]);
  for (const [prefix, group] of byPrefix) {
    if (group.length < minGroup) continue;
    const allOld = group.every((t) => t.updatedAt != null && opts.now - t.updatedAt > staleDays * DAY);
    if (!allOld) continue;
    for (const t of group) {
      if (renewed(t)) continue;
      push({ kind: 'archive', taskId: t.id, label: t.label, ageDays: ageDays(t, opts.now), prefix, reason: `${String(group.length)} abertas com prefixo '${prefix}', todas paradas ha mais de ${String(staleDays)} dias` });
    }
  }
  // filha pendente de pai ja concluido
  for (const t of open) {
    const parent = t.parentId ? byId.get(t.parentId) : undefined;
    if (parent?.status === 'completed') {
      push({ kind: 'close-parent-done', taskId: t.id, label: t.label, ageDays: ageDays(t, opts.now), prefix: labelPrefix(t.label), reason: `pai ${parent.id.slice(0, 8)} ja concluido` });
    }
  }
  return out.sort((a, b) => b.ageDays - a.ageDays);
}

/** Correlatas 0.50-0.79 entre abertas (sugestao; nunca candidata de apply). */
export function relatedSuggestions(tasks: Task[], limit = 20): { a: string; b: string; labelA: string; labelB: string; score: number; command: string }[] {
  const open = tasks.filter(isOpen) as SimTask[];
  const byId = new Map(open.map((t) => [t.id, t]));
  const ix = clusterPairs(open);
  return ix.slice(0, limit).map((p) => ({ a: p.a, b: p.b, labelA: byId.get(p.a)?.label ?? p.a, labelB: byId.get(p.b)?.label ?? p.b, score: p.score, command: p.command }));
}

function clusterPairs(open: SimTask[]): { a: string; b: string; score: number; command: string }[] {
  const byId = new Map(open.map((t) => [t.id, t]));
  return allPairs(open, { min: THRESHOLD_RELATED })
    .filter((p) => p.score < THRESHOLD_SAME)
    .flatMap((p) => {
      const ta = byId.get(p.a);
      const tb = byId.get(p.b);
      if (!ta || !tb) return [];
      const target = pickTarget([ta, tb]);
      const source = target.id === p.a ? p.b : p.a;
      return [{ a: p.a, b: p.b, score: p.score, command: mergeCommand(source, target.id) }];
    });
}

/** create: candidatas abertas parecidas com o que esta sendo criado (exclui ancestrais do pai). */
export function similarOpen(
  probe: SimTask,
  open: Task[],
  opts: { excludeIds?: Set<string> } = {}
) {
  const pool = (open as SimTask[]).filter((t) => !opts.excludeIds?.has(t.id));
  return findSimilar(probe, pool, { min: THRESHOLD_RELATED });
}

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

export function burnReport(tasks: Task[], now: number, months = 6) {
  const ym = (s: number) => new Date(s * 1000).toISOString().slice(0, 7);
  const byMonth: Record<string, { created: number; completed: number; archived: number }> = {};
  const slot = (m: string) => (byMonth[m] ??= { created: 0, completed: 0, archived: 0 });
  for (const t of tasks) {
    if (t.createdAt != null) slot(ym(t.createdAt)).created++;
    if (t.status === 'completed' && t.updatedAt != null) {
      const at = (metaOf(t).closed as { at?: number } | undefined)?.at ?? t.updatedAt;
      slot(ym(at)).completed++;
    }
    if (t.status === 'failed' && isObsolete(t) && t.updatedAt != null) slot(ym(t.updatedAt)).archived++;
  }
  const keys = Object.keys(byMonth).sort().slice(-months);
  const open = tasks.filter(isOpen);
  const ages = open.map((t) => ageDays(t, now)).sort((a, b) => a - b);
  const prefixes: Record<string, number> = {};
  for (const t of open) prefixes[labelPrefix(t.label)] = (prefixes[labelPrefix(t.label)] ?? 0) + 1;
  const completed = tasks.filter((t) => t.status === 'completed');
  const withProof = completed.filter((t) => {
    const m = metaOf(t);
    const links = m.links;
    const hasLinks = typeof links === 'object' && links !== null && Object.keys(links).length > 0;
    return Boolean(m.closed) || Boolean(m.reconciledFromCommit) || hasLinks;
  });
  return {
    total: tasks.length,
    open: open.length,
    byMonth: Object.fromEntries(keys.map((k) => [k, byMonth[k]])),
    openAgeDays: { p50: percentile(ages, 50), p90: percentile(ages, 90), max: ages[ages.length - 1] ?? 0 },
    topPrefixes: Object.entries(prefixes).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([prefix, n]) => ({ prefix, n })),
    completedWithProofPct: completed.length ? Math.round((withProof.length / completed.length) * 100) : 0,
  };
}

export function filterTasks(
  tasks: Task[],
  f: { status?: string; olderThanDays?: number; labelPrefix?: string; limit?: number },
  now: number
): Task[] {
  let r = tasks;
  if (f.status) r = r.filter((t) => t.status === f.status);
  const olderThanDays = f.olderThanDays;
  if (olderThanDays != null) r = r.filter((t) => t.updatedAt != null && now - t.updatedAt > olderThanDays * DAY);
  const prefix = f.labelPrefix;
  if (prefix) r = r.filter((t) => t.label.toLowerCase().startsWith(prefix.toLowerCase()));
  if (f.limit != null) r = r.slice(0, f.limit);
  return r;
}

export const compactTask = (t: Task) => ({
  id: t.id, label: t.label.length > 160 ? `${t.label.slice(0, 157)}...` : t.label, status: t.status,
  parentId: t.parentId, createdAt: t.createdAt, updatedAt: t.updatedAt,
  phase: metaOf(t).phase, obsolete: isObsolete(t) || undefined,
});
