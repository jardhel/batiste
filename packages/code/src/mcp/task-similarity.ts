/**
 * Similaridade de tarefas do TaskLog — modulo PURO e deterministico (sem rede, sem LLM, sem I/O).
 *
 * Por que existe: dedupe por label identico nao pega tarefas CORRELATAS ("deploy da pagina X" e
 * "publicar pagina X em producao"). Como no refinamento de backlog agil, tarefa correlata se mescla,
 * nao se duplica.
 *
 * Modelo: cada tarefa vira um vetor TF-IDF de unigramas + bigramas do label (peso 3) e do texto de
 * contexto (state, notes, links, toolOutputs resumidos; peso 1). O idf e calculado sobre o universo
 * recebido (as tarefas abertas + a candidata). Score = max(cosseno, contencao do label curto no longo, teto 0.75) + bonus - penalidades, em [0,1].
 *
 *   bonus   prefixo igual (+0.04) · mesmo produto (+0.04) · refs compartilhadas (+0.15, +0.05 por ref extra, teto 0.25)
 *           refs = URL, sha de commit, releases/AAAA-..., arquivo/diretorio de repo, deploy id, dedupeKey
 *   penal.  produtos diferentes (-0.15) · designadores diferentes no label, como B1 vs B2, F3 vs F4,
 *           etapa1 vs etapa3, os-01 vs os-02, v0.1 vs v0.1.1 (-0.20): irmas distintas, nao a mesma tarefa
 *
 * LIMIARES (validados em pares rotulados a mao do TaskLog da casa; ver test/task-similarity.node.test.mjs):
 *   score >= 0.80  'mesma'     -> mesclar (create nao cria; gate reprova)
 *   0.50 .. 0.79   'correlata' -> sugerir mescla (create cria e avisa; gate so avisa)
 *   score <  0.50  'distinta'
 *
 * Tem de ser sintaxe 'apagavel' (sem enum, sem parameter properties): o gate tasklog-hygiene (.mjs)
 * importa este arquivo direto com o type-stripping do Node, para nao haver duas implementacoes.
 */

export const THRESHOLD_SAME = 0.8;
export const THRESHOLD_RELATED = 0.5;

export interface SimTask {
  id: string;
  parentId?: string;
  label: string;
  status: string;
  context?: { metadata?: Record<string, unknown>; toolOutputs?: Record<string, unknown>; [k: string]: unknown };
  createdAt?: number;
  updatedAt?: number;
}

export type SimKind = 'same' | 'related' | 'distinct';

export interface SimResult {
  score: number;
  kind: SimKind;
  cosine: number;
  bonus: number;
  penalty: number;
  sharedRefs: string[];
}

const W_LABEL = 3;
const W_CTX = 1;
/** bigrama pesa metade do unigrama: premia ordem, mas nao pune reescrita com as mesmas palavras */
const W_BIGRAM = 0.5;
const CTX_MAX_TOKENS = 80;

const STOP = new Set(
  (
    // PT
    'a o as os um uma uns umas de do da dos das em no na nos nas por pra para com sem sob sobre entre ate ao aos ' +
    'e ou mas que se como quando onde qual quais ja so tambem mais menos muito muita muitos muitas ' +
    'e ser sao foi era sera esta estao estar tem ter tinha ha vai vao ir isso isto esse essa esses essas este esta estes estas ' +
    'seu sua seus suas meu minha nosso nossa dele dela eles elas lhe me te nos depois antes ' +
    // EN
    'the an and or of to in on at for with without from by as is are was were be been being it its this that these those ' +
    'do does did has have had will would can could should not no yes if then than so also into over under about up out'
  ).split(/\s+/)
);

/** sinonimos de dominio (deterministico): canonicaliza antes do stemming leve. */
const SYN: Array<[RegExp, string]> = [
  [/^(deploy\w*|publi\w+|subir|sobe|subida|ship\w*|lancar|lancamento|go-?live)$/, 'publicar'],
  [/^(producao|production|prod|ar)$/, 'prod'],
  [/^(pagina|paginas|page|pages|landing)$/, 'pagina'],
  [/^(corrig\w+|conserta\w*|fix\w*|bug|hotfix)$/, 'corrigir'],
  [/^(criar|cria\w*|create\w*|build|construir|implementar|implementa\w*)$/, 'criar'],
  [/^(revis\w+|review\w*|auditoria|audit\w*)$/, 'revisar'],
  [/^(email|e-mail|mail)$/, 'email'],
];

const SUFFIXES = ['amento', 'acao', 'coes', 'ando', 'endo', 'indo', 'ados', 'adas', 'ado', 'ada', 'ido', 'ida', 'ar', 'er', 'ir', 'es', 's'];

function stem(w: string): string {
  for (const [re, canon] of SYN) if (re.test(w)) return canon;
  if (w.length < 5 || /\d/.test(w)) return w;
  for (const suf of SUFFIXES) {
    if (w.endsWith(suf) && w.length - suf.length >= 4) {
      if (suf === 's' && w.endsWith('ss')) continue;
      return w.slice(0, -suf.length);
    }
  }
  return w;
}

const stripAccents = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

const RE_URL = /https?:\/\/[^\s)>"'\]]+/gi;
const RE_SHA = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g;
const RE_RELEASE = /\breleases\/\d{4}-\d{2}-\d{2}-[a-z0-9._-]+/gi;
const RE_REPO_PATH = /\b(?:products|tools|packages|infra|brand|scripts|obs_vault|docs)\/[a-z0-9_.-]+(?:\/[a-z0-9_.@-]+)*/gi;
const RE_FILE = /\b[a-z0-9_-]+(?:\/[a-z0-9_.-]+)*\.(?:mjs|js|ts|tsx|json|md|py|sh|html|css|tf|yml|yaml|pdf|txt)\b/gi;
const RE_DATE = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b|\b\d{1,2}h\d{0,2}\b/g;
/** designadores que separam irmas: b1, f3, os-01, etapa2, fase1, v0.3, v0.1.1 */
const RE_DESIG = /(?<![a-z0-9])(?:[a-z]\d{1,2}(?:\.\d+)?|os-?\d{1,2}|etapa-?\d+|fase-?\d+|v\d+(?:\.\d+)*)(?![a-z0-9])/g;

function normalizeText(raw: string): string {
  return stripAccents(String(raw ?? '').toLowerCase());
}

/** tokens significativos: sem datas, numeros soltos, stopwords; com stem/sinonimo. */
export function tokenize(raw: string, opts: { keepNumbers?: boolean } = {}): string[] {
  let s = normalizeText(raw);
  s = s.replace(RE_URL, ' ').replace(RE_SHA, ' ').replace(RE_DATE, ' ');
  // preserva versoes (v0.3, v0.1.1) como um token so
  const versions = (s.match(/(?<![a-z0-9])v\d+(?:\.\d+)+/g) ?? []).map((v) => v);
  s = s.replace(/(?<![a-z0-9])v\d+(?:\.\d+)+/g, ' ');
  const out: string[] = [];
  for (const w of s.split(/[^a-z0-9]+/)) {
    if (!w) continue;
    if (/^\d+$/.test(w) && !opts.keepNumbers) continue; // numero solto
    if (w.length < 2 && !opts.keepNumbers) continue;
    if (STOP.has(w) && !opts.keepNumbers) continue;
    out.push(stem(w));
  }
  return [...out, ...versions];
}

function bigrams(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < tokens.length; i++) out.push(`${tokens[i]}_${tokens[i + 1]}`);
  return out;
}

/** Texto de contexto: state, notes, links, tags, toolOutputs resumidos. */
export function contextText(t: SimTask): string {
  const m = (t.context?.metadata ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  const st = m.state;
  if (st && typeof st === 'object') parts.push(String((st as any).next ?? ''), String((st as any).gate ?? ''));
  else if (typeof st === 'string') parts.push(st);
  for (const n of (m.notes as Array<{ text?: unknown }> | undefined) ?? []) if (typeof n?.text === 'string') parts.push(n.text);
  if (Array.isArray(m.tags)) parts.push((m.tags as unknown[]).map(String).join(' '));
  const links = m.links as Record<string, unknown> | undefined;
  if (links) parts.push(Object.values(links).map(String).join(' '));
  const outs = t.context?.toolOutputs as Record<string, { output?: unknown }> | undefined;
  if (outs) {
    for (const [name, v] of Object.entries(outs).slice(0, 5)) {
      const o = v?.output;
      const txt = typeof o === 'string' ? o : o == null ? '' : JSON.stringify(o);
      parts.push(`${name} ${txt.slice(0, 300)}`);
    }
  }
  return parts.join(' ');
}

/** Referencias estaveis: url, sha, release, caminho/arquivo de repo, deploy id, dedupeKey. */
export function extractRefs(t: SimTask): string[] {
  const m = (t.context?.metadata ?? {}) as Record<string, unknown>;
  const text = `${t.label} ${contextText(t)}`;
  const refs = new Set<string>();
  const add = (kind: string, v: string) => {
    const n = v.trim().replace(/[.,;:]+$/, '').toLowerCase();
    if (n.length >= 4) refs.add(`${kind}:${n}`);
  };
  for (const u of text.match(RE_URL) ?? []) add('url', u.replace(/\/+$/, ''));
  for (const s of text.match(RE_SHA) ?? []) add('sha', s.slice(0, 7));
  for (const r of text.match(RE_RELEASE) ?? []) add('release', r);
  for (const r of text.match(RE_REPO_PATH) ?? []) add('path', r.replace(/\/+$/, ''));
  for (const f of text.match(RE_FILE) ?? []) if (f.includes('/')) add('file', f);
  const links = m.links as Record<string, unknown> | undefined;
  if (links) {
    if (typeof links.commit === 'string') add('sha', links.commit.slice(0, 7));
    if (typeof links.deploy === 'string') add('deploy', links.deploy);
    if (typeof links.release === 'string') add('release', links.release.startsWith('releases/') ? links.release : `releases/${links.release}`);
    if (typeof links.url === 'string') add('url', links.url.replace(/\/+$/, ''));
  }
  if (typeof m.dedupeKey === 'string') add('key', m.dedupeKey);
  return [...refs].sort();
}

/** produto: tag product/produto/deploy:<x>, ou slug inicial do label ("astrus-bussola-..", "poseidon · ..", "x: .."). */
export function productOf(t: SimTask): string | null {
  const m = (t.context?.metadata ?? {}) as Record<string, unknown>;
  const explicit = [m.product, m.produto, ...(Array.isArray(m.tags) ? (m.tags as unknown[]).map((x) => String(x).replace(/^deploy:/, '')) : [])];
  for (const e of explicit) if (typeof e === 'string' && e.trim()) return normalizeText(e).trim();
  const label = normalizeText(t.label).trim();
  const first = label.split(/\s/)[0] ?? '';
  const after = label.slice(first.length).trimStart();
  const slug = first.split('-')[0]!.replace(/[^a-z0-9]/g, '');
  if (!slug || slug.length < 3) return null;
  const hasSep = first.includes('-') || /^[·:—]/.test(after) || first.endsWith(':');
  return hasSep ? slug : null;
}

export function prefixOf(label: string): string {
  const first = normalizeText(label).trim().split(/[\s:·—]/)[0] ?? '';
  return first.split('-').slice(0, 2).join('-');
}

const isSlug = (label: string): boolean => !/\s/.test(label.trim());

/** mesmo produto, tolerando abreviacao (eki ~ ekimetrics). */
const sameProduct = (x: string, y: string): boolean => x === y || (Math.min(x.length, y.length) >= 3 && (x.startsWith(y) || y.startsWith(x)));

function designators(label: string): Set<string> {
  const s = normalizeText(label);
  const set = new Set((s.match(RE_DESIG) ?? []).map((d) => d.replace(/-/g, '')));
  // numeros soltos tambem distinguem ('task 1' vs 'task 2', 'proposta ...-003' vs '...-005'); datas e shas nao
  const bare = s.replace(RE_URL, ' ').replace(RE_DATE, ' ').replace(RE_SHA, ' ').replace(RE_DESIG, ' ');
  for (const n of bare.match(/(?<![a-z0-9.])\d{1,4}(?![a-z0-9.])/g) ?? []) set.add(n);
  return set;
}

interface Doc {
  task: SimTask;
  feats: Map<string, number>;
  labelToks: Set<string>;
  refs: Set<string>;
  product: string | null;
  prefix: string;
  desig: Set<string>;
}

function buildDoc(t: SimTask): Doc {
  const feats = new Map<string, number>();
  const bump = (k: string, w: number) => feats.set(k, (feats.get(k) ?? 0) + w);
  // label-slug (uma palavra so, ex. proposta-gerada-ct-as-2026-08-003): e identificador, os numeros distinguem
  const lt = tokenize(t.label, { keepNumbers: isSlug(t.label) });
  for (const k of lt) bump(`u:${k}`, W_LABEL);
  for (const k of bigrams(lt)) bump(`b:${k}`, W_LABEL * W_BIGRAM);
  const ct = tokenize(contextText(t)).slice(0, CTX_MAX_TOKENS);
  for (const k of ct) bump(`u:${k}`, W_CTX);
  for (const k of bigrams(ct)) bump(`b:${k}`, W_CTX * W_BIGRAM);
  return { task: t, feats, labelToks: new Set(lt), refs: new Set(extractRefs(t)), product: productOf(t), prefix: prefixOf(t.label), desig: designators(t.label) };
}

export interface SimIndex {
  docs: Map<string, Doc>;
  idf: Map<string, number>;
  df: Map<string, number>;
  refDf: Map<string, number>;
  norms: Map<string, number>;
}

/** Indexa um universo de tarefas (idf sobre ele). Barato: O(total de features). */
export function buildIndex(tasks: SimTask[]): SimIndex {
  const docs = new Map<string, Doc>();
  const df = new Map<string, number>();
  const refDf = new Map<string, number>();
  for (const t of tasks) {
    const d = buildDoc(t);
    docs.set(t.id, d);
    for (const k of d.feats.keys()) df.set(k, (df.get(k) ?? 0) + 1);
    for (const r of d.refs) refDf.set(r, (refDf.get(r) ?? 0) + 1);
  }
  const N = Math.max(1, docs.size);
  const idf = new Map<string, number>();
  for (const [k, n] of df) idf.set(k, Math.log(1 + N / (1 + n)) + 0.1);
  const norms = new Map<string, number>();
  for (const [id, d] of docs) {
    let s = 0;
    for (const [k, w] of d.feats) s += (w * idf.get(k)!) ** 2;
    norms.set(id, Math.sqrt(s));
  }
  return { docs, idf, df, refDf, norms };
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const round3 = (x: number) => Math.round(x * 1000) / 1000;

export function classify(score: number): SimKind {
  return score >= THRESHOLD_SAME ? 'same' : score >= THRESHOLD_RELATED ? 'related' : 'distinct';
}

/** Score entre duas tarefas JA indexadas. */
export function scoreIndexed(ix: SimIndex, aId: string, bId: string): SimResult {
  const a = ix.docs.get(aId)!;
  const b = ix.docs.get(bId)!;
  let dot = 0;
  const [small, big] = a.feats.size <= b.feats.size ? [a, b] : [b, a];
  for (const [k, w] of small.feats) {
    const w2 = big.feats.get(k);
    if (w2 !== undefined) dot += w * w2 * ix.idf.get(k)! ** 2;
  }
  const na = ix.norms.get(aId)!;
  const nb = ix.norms.get(bId)!;
  const cosine = na && nb ? dot / (na * nb) : 0;

  // contencao: o label curto esta (quase) inteiro dentro do outro. So alcanca a faixa 'correlata' (teto 0.75), nunca 'mesma'.
  let containment = 0;
  {
    const [lo, hi] = a.labelToks.size <= b.labelToks.size ? [a, b] : [b, a];
    if (lo.labelToks.size >= 3) {
      let shared = 0;
      let total = 0;
      for (const k of lo.labelToks) {
        const w = ix.idf.get(`u:${k}`) ?? 0;
        total += w;
        if (hi.labelToks.has(k)) shared += w;
      }
      const ratio = total ? shared / total : 0;
      containment = ratio >= 0.7 ? Math.min(0.75, 0.85 * ratio) : 0;
    }
  }

  let bonus = 0;
  if (a.prefix && a.prefix === b.prefix) bonus += 0.04;
  if (a.product && b.product && sameProduct(a.product, b.product)) bonus += 0.04;
  const shared = [...a.refs].filter((r) => b.refs.has(r) && (ix.refDf.get(r) ?? 0) <= 4);
  if (shared.length) bonus += Math.min(0.25, 0.15 + 0.05 * (shared.length - 1));

  let penalty = 0;
  if (a.product && b.product && !sameProduct(a.product, b.product)) penalty += 0.15;
  // irmas distintas: mesmo tipo de designador com valor diferente (os-01 vs os-02, B1 vs B2, v0.3 vs v0.4).
  // Pai/filha (os-01 ausente de um lado) so perde pontos; irma conflitante nunca passa de 'distinta' (teto 0.45).
  let siblingCap = 1;
  if (a.desig.size && b.desig.size) {
    const same = a.desig.size === b.desig.size && [...a.desig].every((d) => b.desig.has(d));
    if (!same) penalty += 0.2;
    const kind = (d: string) => d.replace(/[\d.]+$/, '') || `#${d.length}`;
    const ka = new Map([...a.desig].map((d) => [kind(d), d]));
    for (const d of b.desig) {
      const o = ka.get(kind(d));
      if (o !== undefined && o !== d) siblingCap = 0.45;
    }
  }
  // labels identicos (normalizados) sao sempre a mesma tarefa
  const identical = normalizeText(a.task.label).trim() === normalizeText(b.task.label).trim();
  const score = identical ? 1 : Math.min(siblingCap, clamp01(Math.max(cosine, containment) + bonus - penalty));
  return { score: round3(score), kind: classify(score), cosine: round3(cosine), bonus: round3(bonus), penalty: round3(penalty), sharedRefs: shared };
}

/** Atalho: score de um par (indexa so os dois; para varias comparacoes use buildIndex). */
export function similarity(a: SimTask, b: SimTask, universe?: SimTask[]): SimResult {
  const u = universe ?? [a, b];
  const all = u.some((t) => t.id === a.id) && u.some((t) => t.id === b.id) ? u : [...u, a, b];
  return scoreIndexed(buildIndex(all), a.id, b.id);
}

export interface SimMatch {
  taskId: string;
  label: string;
  score: number;
  kind: SimKind;
  sharedRefs: string[];
}

/** Candidatas do universo mais parecidas com `probe` (>= min), ordenadas por score desc, id asc. */
export function findSimilar(probe: SimTask, universe: SimTask[], opts: { min?: number } = {}): SimMatch[] {
  const min = opts.min ?? THRESHOLD_RELATED;
  const others = universe.filter((t) => t.id !== probe.id);
  const ix = buildIndex([...others, probe]);
  const out: SimMatch[] = [];
  for (const t of others) {
    const r = scoreIndexed(ix, probe.id, t.id);
    if (r.score >= min) out.push({ taskId: t.id, label: t.label, score: r.score, kind: r.kind, sharedRefs: r.sharedRefs });
  }
  return out.sort((x, y) => y.score - x.score || x.taskId.localeCompare(y.taskId));
}

export interface SimPair {
  a: string;
  b: string;
  score: number;
  kind: SimKind;
}

/** Todos os pares do universo com score >= min. O(n^2) sobre n pequeno (abertas). */
export function allPairs(tasks: SimTask[], opts: { min?: number } = {}): SimPair[] {
  const min = opts.min ?? THRESHOLD_RELATED;
  const ix = buildIndex(tasks);
  const out: SimPair[] = [];
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const r = scoreIndexed(ix, tasks[i]!.id, tasks[j]!.id);
      if (r.score >= min) out.push({ a: tasks[i]!.id, b: tasks[j]!.id, score: r.score, kind: r.kind });
    }
  }
  return out.sort((x, y) => y.score - x.score || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
}

const PHASE_RANK: Record<string, number> = { todo: 0, doing: 1, built: 2, deployed: 3, verified: 4 };
export const phaseRank = (t: SimTask): number => PHASE_RANK[String((t.context?.metadata as any)?.phase ?? 'todo')] ?? 0;

/** Alvo sugerido de um cluster: maior fase; empate -> o mais antigo (createdAt, resolucao de 1 s); empate -> ordem de entrada (a do banco). */
export function pickTarget<T extends SimTask>(tasks: T[]): T {
  return tasks
    .map((t, i) => ({ t, i }))
    .sort((a, b) => phaseRank(b.t) - phaseRank(a.t) || (a.t.createdAt ?? 0) - (b.t.createdAt ?? 0) || a.i - b.i)[0]!.t;
}

export interface SimCluster {
  /** tarefas do cluster (alvo sugerido primeiro) */
  members: Array<{ taskId: string; label: string }>;
  targetId: string;
  /** menor score de aresta usado para ligar o cluster */
  minEdge: number;
  maxEdge: number;
  /** origens -> alvo, ja com o comando merge exato */
  merges: Array<{ sourceId: string; targetId: string; score: number; command: string }>;
}

export const mergeCommand = (sourceId: string, targetId: string, reason?: string): string =>
  `batiste-direct manage_task '${JSON.stringify({ action: 'merge', sourceId, targetId, ...(reason ? { reason } : {}) })}'`;

/** Clusters por componente conexa (A~B, B~C -> um cluster) com arestas >= threshold. */
export function clusterSimilar(tasks: SimTask[], opts: { threshold?: number } = {}): SimCluster[] {
  const threshold = opts.threshold ?? THRESHOLD_SAME;
  const pairs = allPairs(tasks, { min: threshold });
  const parent = new Map<string, string>(tasks.map((t) => [t.id, t.id]));
  const find = (x: string): string => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  };
  for (const p of pairs) parent.set(find(p.a), find(p.b));
  const groups = new Map<string, SimTask[]>();
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const inCluster = new Set<string>();
  for (const p of pairs) {
    inCluster.add(p.a);
    inCluster.add(p.b);
  }
  for (const t of tasks) {
    if (!inCluster.has(t.id)) continue;
    const r = find(t.id);
    groups.set(r, [...(groups.get(r) ?? []), byId.get(t.id)!]);
  }
  const out: SimCluster[] = [];
  const ix = buildIndex(tasks);
  for (const members of groups.values()) {
    const target = pickTarget(members);
    const ids = new Set(members.map((m) => m.id));
    const edges = pairs.filter((p) => ids.has(p.a) && ids.has(p.b));
    const merges = members
      .filter((m) => m.id !== target.id)
      .map((m) => ({
        sourceId: m.id,
        targetId: target.id,
        score: scoreIndexed(ix, m.id, target.id).score,
        command: mergeCommand(m.id, target.id),
      }));
    out.push({
      members: [target, ...members.filter((m) => m.id !== target.id)].map((m) => ({ taskId: m.id, label: m.label })),
      targetId: target.id,
      minEdge: Math.min(...edges.map((e) => e.score)),
      maxEdge: Math.max(...edges.map((e) => e.score)),
      merges,
    });
  }
  return out.sort((a, b) => b.members.length - a.members.length || b.maxEdge - a.maxEdge || a.targetId.localeCompare(b.targetId));
}
