#!/usr/bin/env node
// @batiste-aidk/tasklog-hygiene — o gate que faltava no TaskLog.
//
// Nasceu em 2026-11-04: 239 tarefas, 76 pendentes com mais de 60 dias, 15 running, 31 'proposta-*' paradas,
// e 6 tarefas cujo texto dizia "FALTA deploy" JA publicadas e nunca fechadas. Nenhum gate olhava o TaskLog;
// "sessão termina com o backlog como está" era doutrina, não gate (decisão: obs_vault/cachola_tech/04 Decision/
// 2026-11-04 — tasklog tem gate, backlog nao cresce em silencio.md).
//
// Regras (exit 1 se alguma ERRO):
//   stale          pendente/running sem update há mais de N dias (padrão 30), a menos que tenha renewedUntil
//                  VIGENTE com motivo (batiste-direct manage_task renew).
//   running-orfa   running sem update há mais de 48 h (sem heartbeat: agente morto, sessão acabou).
//   falta-publicado label/estado diz "FALTA deploy|commit" mas o deploy-integrity PROVA o produto no ar == HEAD:
//                  o estado apodreceu. Imprime o comando exato de fechamento.
//   duplicata-aberta  2+ tarefas ABERTAS com o mesmo label normalizado (trim, minusculas): imprime o comando de arquivamento
//                  das copias (mantem a mais antiga). manage_task create ja deduplica; isto pega o que entrou por outro caminho.
//   correlatas-abertas  tarefas ABERTAS parecidas (nao so mesmo nome): score de similaridade >= 0.80 = mesma tarefa, REPROVA e imprime o
//                  comando `manage_task merge` exato (alvo = maior fase, depois o mais antigo); 0.50-0.79 = correlata, so AVISA.
//                  Mesmo motor do manage_task create/triage (packages/code/src/mcp/task-similarity.ts). Label identico fica com duplicata-aberta.
//   (aviso)        completed sem prova (closed/reconciledFromCommit/links): só avisa; --strict-proof reprova
//                  as concluídas depois de --proof-since AAAA-MM-DD.
//
// uso:
//   node tasklog-hygiene.mjs [check] [--repo <raiz>] [--stale-days 30] [--running-hours 48] [--no-prod]
//                            [--tasks-file tarefas.json] [--json] [--warn-only] [--list 10]
//   node tasklog-hygiene.mjs report [--repo <raiz>] [--months 6] [--json] [--tasks-file f.json]
// Sai 0 (passa), 1 (BLOQUEIA), 2 (uso) ou 3 (TaskLog ilegível: o gate NÃO rodou, nunca finge que passou).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIA = 86400;
const hoje = (now) => new Date(now * 1000).toISOString().slice(0, 10);

export const labelPrefix = (label) => (String(label).trim().toLowerCase().split(/[\s:·—]/)[0] || "").split("-").slice(0, 2).join("-");
const meta = (t) => (t.context && t.context.metadata) || {};
const aberta = (t) => t.status === "pending" || t.status === "running";
/** Última vez que a tarefa ANDOU (status/fase/estado), não que alguém encostou: nota ou touch não zera a idade.
 *  Tarefas antigas sem metadata.progressAt caem no updatedAt (melhor informação disponível). */
export const ultimoProgresso = (t) => meta(t).progressAt ?? t.updatedAt;
const idade = (t, now) => (ultimoProgresso(t) == null ? 0 : Math.floor((now - ultimoProgresso(t)) / DIA));
const curto = (t) => `${String(t.id).slice(0, 8)} ${String(t.label).slice(0, 90)}${String(t.label).length > 90 ? "…" : ""}`;

export const RENEW_MAX_DIAS = 45, RENEW_MIN_MOTIVO = 15, RENEW_AVISO_N = 2;

/** Por que a renovação não vale (null = vale): sem data, motivo curto, expirada ou além do teto de horizonte. */
export function renovacaoInvalida(t, now) {
  const r = meta(t).renewedUntil;
  if (!r) return null;
  if (!r.until) return "sem data";
  if (String(r.reason || "").trim().length < RENEW_MIN_MOTIVO) return `motivo com menos de ${RENEW_MIN_MOTIVO} caracteres`;
  if (String(r.until) < hoje(now)) return "expirada";
  const base = r.at != null ? r.at : now;               // teto conta da renovação, não de hoje
  const teto = hoje(base + RENEW_MAX_DIAS * DIA);
  if (String(r.until) > teto) return `until ${r.until} passa do teto de ${RENEW_MAX_DIAS} dias (${teto})`;
  return null;
}

/** renewedUntil só vale vigente, COM motivo de verdade e dentro do teto. */
export function renovacaoVigente(t, now) {
  const r = meta(t).renewedUntil;
  return !!r && renovacaoInvalida(t, now) === null;
}

/** Tarefas com renovação repetida (> RENEW_AVISO_N): renovar sem andar é arquivo disfarçado. */
export function avisosDeRenovacao(tasks) {
  const rep = tasks.filter(aberta).filter((t) => (meta(t).renewedUntil?.count ?? 0) > RENEW_AVISO_N);
  return rep.map((t) => ({ regra: "renovacao-repetida", nivel: "aviso", taskId: t.id, detalhe: `${curto(t)} renovada ${meta(t).renewedUntil.count} vezes sem andar; feche ou arquive` }));
}

const ALVO = "(?:deploy\\w*|commit\\w*|publica\\w*|no\\s+ar)";
// "FALTA deploy", "deploy faltando", "falta publicar", "pendente de deploy", "deploy pendente", "falta o commit" etc., em qualquer ordem.
export const RE_FALTA = new RegExp(
  `\\bfalt(?:a|am|ando|ante|ou|ar)\\b[^.;\\n]{0,60}\\b${ALVO}\\b|\\b${ALVO}\\b[^.;\\n]{0,40}\\bfalt(?:a|am|ando|ante|ou|ar)\\b|pendente\\s+de\\s+${ALVO}|\\b${ALVO}\\s+pendente`, "i");

/** Texto que carrega estado: label + state estruturado (next/gate). */
export function textoDeEstado(t) {
  const st = meta(t).state;
  return [t.label, st && typeof st === "object" ? `${st.next || ""} ${st.gate || ""}` : st || ""].join(" ");
}

export function violacoesDeIdade(tasks, { now, staleDays = 30, runningHours = 48 }) {
  const out = [];
  for (const t of tasks.filter(aberta)) {
    if (t.updatedAt == null) continue;               // idade desconhecida: só sinaliza com evidência positiva
    const horas = (now - t.updatedAt) / 3600;
    const renovada = renovacaoVigente(t, now);
    const inv = renovada ? null : renovacaoInvalida(t, now);
    const exp = inv ? ` (renewedUntil inválido: ${inv}; expirado ou sem motivo)` : "";
    if (t.status === "running" && horas > runningHours) {
      if (renovada) continue;
      out.push({ regra: "running-orfa", nivel: "erro", taskId: t.id, label: t.label, idadeDias: idade(t, now),
        detalhe: `running sem update há ${Math.floor(horas)} h (limite ${runningHours} h)${exp}`,
        sugestao: `batiste-direct manage_task '{"action":"archive","taskId":"${t.id}","reason":"agente/sessão encerrou sem fechar"}'  # ou update/close se ainda vale` });
    } else if (idade(t, now) > staleDays) {
      if (renovada) continue;
      out.push({ regra: "stale", nivel: "erro", taskId: t.id, label: t.label, idadeDias: idade(t, now),
        detalhe: `${t.status} sem update há ${idade(t, now)} dias (limite ${staleDays})${exp}`,
        sugestao: `batiste-direct manage_task '{"action":"archive","taskId":"${t.id}","reason":"..."}'  # ou renew --until +30d com motivo, ou close com proof` });
    }
  }
  return out;
}

const baseDe = (p) => p.produto.split("/").pop().toLowerCase();
const tokens = (x) => String(x).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Vínculo explícito: tag (deploy:<produto>) ou metadata.product/produto. É o único que autoriza `close` pronto. */
export function vinculoExplicito(t, p) {
  const m = meta(t);
  const ex = [...(m.tags || []).map((x) => String(x).replace(/^deploy:/, "")), m.product, m.produto].filter(Boolean).map((x) => String(x).toLowerCase());
  return ex.includes(baseDe(p));
}

/** Produto do DEPLOYMENTS.md a que a tarefa se refere: tag/metadata explícitos primeiro, depois nome do produto como TOKEN do label
 *  (sequência de tokens inteira, não substring). */
export function produtoDaTarefa(t, produtos) {
  const lbl = tokens(t.label);
  const contem = (seq) => seq.length > 0 && lbl.some((_, i) => seq.every((x, j) => lbl[i + j] === x));
  return produtos.filter((p) => {
    if (vinculoExplicito(t, p)) return true;
    const base = tokens(baseDe(p));
    const primeiro = base[0];
    return contem(base) || (primeiro.length >= 4 && lbl[0] === primeiro);
  });
}

/**
 * Tarefas abertas cujo texto diz "FALTA deploy|commit" e cujo produto o deploy-integrity prova no ar == HEAD.
 * proveFn(produto) -> { ok, url, commit }  (injetável; o padrão chama o provaNoAr real).
 * Só vínculo explícito (tag/metadata) gera `close` pronto; casamento só por label vira "candidato, confira manualmente"
 * e, se casar com mais de um produto, só vale se TODOS estão no ar.
 * `naoVerificadas` (opcional, array) recebe as tarefas com o texto de FALTA que o gate não conseguiu julgar, com o motivo.
 */
export async function violacoesFaltaPublicado(tasks, { produtos, proveFn, now, naoVerificadas = [] }) {
  const out = [], cache = new Map();
  const prove = async (p) => { if (!cache.has(p.produto)) cache.set(p.produto, proveFn(p).catch((e) => ({ ok: false, erro: e.message }))); return cache.get(p.produto); };
  for (const t of tasks.filter(aberta)) {
    if (!RE_FALTA.test(textoDeEstado(t))) continue;
    const candidatos = produtoDaTarefa(t, produtos);
    if (!candidatos.length) { naoVerificadas.push({ taskId: t.id, label: t.label, motivo: "nenhum produto do DEPLOYMENTS.md casa com a tarefa" }); continue; }
    const explicitos = candidatos.filter((p) => vinculoExplicito(t, p));
    const alvo = explicitos.length ? explicitos : candidatos;
    const provas = [];
    for (const p of alvo) provas.push([p, await prove(p)]);
    const ruim = provas.find(([, r]) => !r.ok);
    if (ruim) { naoVerificadas.push({ taskId: t.id, label: t.label, motivo: `${ruim[0].produto}: ${ruim[1].erro || "prova-no-ar não verde"}` }); continue; }
    const [p, r] = provas[0];
    const sha = String(r.commit || "").slice(0, 8);
    const cmd = `batiste-direct manage_task '${JSON.stringify({ action: "close", taskId: t.id, proof: `prova-no-ar verde ${r.url} @ ${sha}`, links: { commit: sha, url: r.url } })}'`;
    const cand = !explicitos.length;
    out.push({ regra: "falta-publicado", nivel: "erro", taskId: t.id, label: t.label, idadeDias: idade(t, now), candidato: cand,
      detalhe: `o texto diz "FALTA deploy/commit", mas ${alvo.map((x) => x.produto).join(" + ")} está no ar == HEAD ${sha} (prova-no-ar verde em ${r.url})${cand ? " [candidato: casou só pelo label]" : ""}`,
      sugestao: cand ? `candidato, confira manualmente que a tarefa é de ${p.produto} (sem tag deploy:<produto>); se for: ${cmd}` : cmd });
  }
  return out;
}

export const normLabel = (l) => String(l).trim().toLowerCase();

/** 2+ abertas com o mesmo label normalizado. Mantem a mais antiga (createdAt) e sugere arquivar as copias. */
export function violacoesDeDuplicata(tasks) {
  const grupos = new Map();
  for (const t of tasks.filter(aberta)) { const k = normLabel(t.label); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(t); }
  const out = [];
  for (const [, g] of grupos) {
    if (g.length < 2) continue;
    g.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || String(a.id).localeCompare(String(b.id)));
    const [manter, ...copias] = g;
    for (const t of copias) {
      out.push({ regra: "duplicata-aberta", nivel: "erro", taskId: t.id, label: t.label, idadeDias: null, mantem: manter.id, copias: copias.length + 1,
        detalhe: `${g.length} tarefas abertas com o mesmo label; a mais antiga é ${String(manter.id).slice(0, 8)}`,
        sugestao: `batiste-direct manage_task '${JSON.stringify({ action: "archive", taskId: t.id, reason: `duplicata de ${manter.id}` })}'` });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------ correlatas
/** Carrega o motor de similaridade (TS 'apagavel': o Node >= 22.18 importa .ts direto). null se nao carregar. */
export async function carregarSimilaridade() {
  try { return await import(new URL("../code/src/mcp/task-similarity.ts", import.meta.url).href); }
  catch (e) { return { erro: e.message }; }
}

/**
 * Pares abertos correlatos. >= 0.80 vira ERRO (mesclar); 0.50-0.79 vira AVISO (sugerir). Label identico (mesmo normalizado)
 * fica com a regra duplicata-aberta, para nao reportar duas vezes. `sim` e o modulo de similaridade (injetavel nos testes).
 */
export function violacoesDeCorrelatas(tasks, sim) {
  if (!sim || sim.erro || typeof sim.allPairs !== "function") return { erros: [], avisos: [], semMotor: sim?.erro || "motor de similaridade indisponivel" };
  const abertas = tasks.filter(aberta);
  const byId = new Map(abertas.map((t) => [t.id, t]));
  const pares = sim.allPairs(abertas, { min: sim.THRESHOLD_RELATED }).filter((p) => normLabel(byId.get(p.a).label) !== normLabel(byId.get(p.b).label));
  const erros = [], avisos = [];
  const fortes = pares.filter((p) => p.score >= sim.THRESHOLD_SAME);
  // cluster dos fortes: A~B, B~C -> um alvo
  const clusters = sim.clusterSimilar(abertas.filter((t) => fortes.some((p) => p.a === t.id || p.b === t.id)), { threshold: sim.THRESHOLD_SAME });
  for (const cl of clusters) {
    const alvo = byId.get(cl.targetId);
    for (const m of cl.merges) {
      const o = byId.get(m.sourceId);
      if (normLabel(o.label) === normLabel(alvo.label)) continue;               // identico: duplicata-aberta cuida
      erros.push({ regra: "correlatas-abertas", nivel: "erro", taskId: o.id, label: o.label, idadeDias: null, mantem: alvo.id, score: m.score,
        detalhe: `correlata de ${curto(alvo)} (score ${m.score} >= ${sim.THRESHOLD_SAME}: mesma tarefa; mescle, nao duplique)`,
        sugestao: m.command });
    }
  }
  for (const p of pares.filter((x) => x.score < sim.THRESHOLD_SAME)) {
    const a = byId.get(p.a), b = byId.get(p.b);
    const alvo = sim.pickTarget([a, b]), o = alvo.id === a.id ? b : a;
    avisos.push({ regra: "correlatas-abertas", nivel: "aviso", taskId: o.id, label: o.label, mantem: alvo.id, score: p.score,
      detalhe: `${curto(o)} ~ ${curto(alvo)} (score ${p.score}: correlata; confira se e a mesma entrega)`,
      sugestao: sim.mergeCommand(o.id, alvo.id) });
  }
  return { erros, avisos };
}

export function avisosDeProva(tasks, { strictProof = false, proofSince } = {}) {
  const sem = tasks.filter((t) => t.status === "completed").filter((t) => {
    const m = meta(t);
    return !(m.closed || m.reconciledFromCommit || (m.links && Object.keys(m.links).length));
  });
  const alvo = strictProof && proofSince ? sem.filter((t) => t.updatedAt != null && hoje(t.updatedAt) >= proofSince) : [];
  return {
    avisos: sem.length ? [{ regra: "completed-sem-prova", nivel: "aviso", detalhe: `${sem.length} concluída(s) sem commit/prova/motivo (use close com proof)` }] : [],
    erros: alvo.map((t) => ({ regra: "completed-sem-prova", nivel: "erro", taskId: t.id, label: t.label, detalhe: "concluída sem prova depois de --proof-since", sugestao: "reabra com reopen+reason ou registre links/closed" })),
  };
}

// ------------------------------------------------------------------------------------ burn-down
const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : 0);
export function relatorio(tasks, { now, months = 6 } = {}) {
  const ym = (s) => new Date(s * 1000).toISOString().slice(0, 7);
  const mes = {}; const slot = (m) => (mes[m] ??= { criadas: 0, concluidas: 0, arquivadas: 0 });
  for (const t of tasks) {
    if (t.createdAt != null) slot(ym(t.createdAt)).criadas++;
    if (t.status === "completed" && t.updatedAt != null) slot(ym((meta(t).closed || {}).at || t.updatedAt)).concluidas++;
    if (t.status === "failed" && meta(t).obsolete && t.updatedAt != null) slot(ym(t.updatedAt)).arquivadas++;
  }
  const chaves = Object.keys(mes).sort().slice(-months);
  const abertas = tasks.filter(aberta);
  const idades = abertas.map((t) => idade(t, now)).sort((a, b) => a - b);
  const faixas = { "0-7": 0, "8-30": 0, "31-60": 0, "61+": 0 };
  for (const i of idades) faixas[i <= 7 ? "0-7" : i <= 30 ? "8-30" : i <= 60 ? "31-60" : "61+"]++;
  const pref = {}; for (const t of abertas) pref[labelPrefix(t.label)] = (pref[labelPrefix(t.label)] || 0) + 1;
  const concl = tasks.filter((t) => t.status === "completed");
  const comProva = concl.filter((t) => { const m = meta(t); return m.closed || m.reconciledFromCommit || (m.links && Object.keys(m.links).length); });
  return {
    geradoEm: new Date(now * 1000).toISOString(),
    total: tasks.length,
    porStatus: Object.fromEntries(["pending", "running", "completed", "failed"].map((s) => [s, tasks.filter((t) => t.status === s).length])),
    porMes: Object.fromEntries(chaves.map((k) => [k, { ...mes[k], saldo: mes[k].criadas - mes[k].concluidas - mes[k].arquivadas }])),
    idadeAbertasDias: { p50: pct(idades, 50), p90: pct(idades, 90), max: idades[idades.length - 1] || 0, faixas },
    topPrefixos: Object.entries(pref).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([prefixo, n]) => ({ prefixo, n })),
    duplicatasAbertas: violacoesDeDuplicata(tasks).length,
    concluidasComProvaPct: concl.length ? Math.round((comProva.length / concl.length) * 100) : 0,
  };
}

// ------------------------------------------------------------------------------------ I/O
export function carregarTarefas({ repo, tasksFile, bin = process.env.BATISTE_DIRECT || "batiste-direct", timeoutMs = 30000 } = {}) {
  if (tasksFile) {
    const j = JSON.parse(fs.readFileSync(tasksFile, "utf8"));
    return Array.isArray(j) ? j : j.tasks;
  }
  const r = spawnSync(bin, ["manage_task", JSON.stringify({ action: "list" })], {
    cwd: repo, encoding: "utf8", timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, PROJECT_ROOT: repo, DATA_DIR: process.env.DATA_DIR || path.join(repo, ".batiste") },
  });
  if (r.error || r.status !== 0) throw new Error(`não li o TaskLog (${bin} manage_task list): ${r.error?.message || r.stderr || `exit ${r.status}`}`.trim());
  return JSON.parse(r.stdout).tasks;
}

async function proveReal(repo, p) {
  // "no ar == HEAD" só fecha tarefa se o trabalho está no HEAD: árvore do produto suja = pode haver trabalho fora do commit.
  const suja = spawnSync("git", ["status", "--porcelain", "--", p.produto], { cwd: repo, encoding: "utf8" }).stdout.trim();
  if (suja) return { ok: false, erro: `árvore de ${p.produto} tem mudança fora do commit; nada a sugerir` };
  const di = await import("../deploy-integrity/deploy-integrity.mjs");
  const r = await di.provaNoAr(repo, `${p.host.replace(/\/$/, "")}/`, { produto: p.produto, stageTool: path.join(repo, "tools", "pages-stage", "stage.mjs") });
  return { ok: r.falhas.length === 0, url: `${p.host.replace(/\/$/, "")}/`, commit: r.commit };
}

export async function verificar(tasks, opts) {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const erros = violacoesDeIdade(tasks, { now, staleDays: opts.staleDays, runningHours: opts.runningHours });
  erros.push(...violacoesDeDuplicata(tasks));
  const corr = violacoesDeCorrelatas(tasks, opts.similarity === undefined ? await carregarSimilaridade() : opts.similarity);
  erros.push(...corr.erros);
  const naoVerificadas = [];
  if (opts.produtos && opts.proveFn) erros.push(...(await violacoesFaltaPublicado(tasks, { produtos: opts.produtos, proveFn: opts.proveFn, now, naoVerificadas })));
  const prova = avisosDeProva(tasks, opts);
  const avisos = [...prova.avisos, ...avisosDeRenovacao(tasks), ...corr.avisos];
  if (corr.semMotor) avisos.push({ regra: "correlatas-abertas", nivel: "aviso", detalhe: `regra NAO rodou: ${corr.semMotor} (Node >= 22.18 e packages/code/src/mcp/task-similarity.ts)` });
  erros.push(...prova.erros);
  return { erros, avisos, naoVerificadas, resumo: relatorio(tasks, { now }) };
}

function formatar(res, { lista = 10, staleDays, runningHours }) {
  const L = [];
  const porRegra = {};
  for (const v of res.erros) (porRegra[v.regra] ??= []).push(v);
  for (const [regra, vs] of Object.entries(porRegra)) {
    L.push(`✗ [${regra}] ${vs.length} tarefa(s):`);
    for (const v of vs.slice(0, lista)) L.push(`    ${curto({ id: v.taskId, label: v.label })} — ${v.detalhe}\n      → ${v.sugestao}`);
    if (vs.length > lista) L.push(`    … +${vs.length - lista} (use --list ${vs.length} ou --json)`);
    if (regra === "stale") {
      const pref = {}; for (const v of vs) pref[labelPrefix(v.label)] = (pref[labelPrefix(v.label)] || 0) + 1;
      L.push(`    por prefixo: ${Object.entries(pref).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([p, n]) => `${p}×${n}`).join(", ")}`);
      L.push(`    em lote (dry-run): batiste-direct manage_task '{"action":"triage"}'`);
    }
  }
  const corrAv = res.avisos.filter((a) => a.regra === "correlatas-abertas" && a.sugestao);
  for (const a of res.avisos.filter((x) => !corrAv.includes(x))) L.push(`⚠ [${a.regra}] ${a.detalhe}`);
  if (corrAv.length) {
    L.push(`⚠ [correlatas-abertas] ${corrAv.length} par(es) de tarefas abertas correlatas (0.50-0.79; aviso, nao reprova):`);
    for (const a of corrAv.slice(0, lista)) L.push(`    ${a.detalhe}\n      → se for a mesma entrega: ${a.sugestao}`);
    if (corrAv.length > lista) L.push(`    … +${corrAv.length - lista} (use --list ${corrAv.length} ou --json)`);
  }
  if (res.naoVerificadas?.length) {
    L.push(`? [falta-publicado] ${res.naoVerificadas.length} tarefa(s) com texto de FALTA deploy/commit NÃO verificadas (o gate não pôde julgar):`);
    for (const n of res.naoVerificadas.slice(0, lista)) L.push(`    ${curto({ id: n.taskId, label: n.label })} — ${n.motivo}`);
  }
  const r = res.resumo;
  L.push(res.erros.length
    ? `\n${res.erros.length} violação(ões) do TaskLog (limites: pendente ${staleDays} dias, running ${runningHours} h). Abertas: ${r.porStatus.pending} pending + ${r.porStatus.running} running; idade p50/p90 ${r.idadeAbertasDias.p50}/${r.idadeAbertasDias.p90} dias. A sessão não terminou.`
    : `✓ tasklog-hygiene OK (${r.total} tarefas; ${r.porStatus.pending} pending, ${r.porStatus.running} running)`);
  return L.join("\n");
}

function formatarRelatorio(r) {
  const L = [`TaskLog: ${r.total} tarefas — ${Object.entries(r.porStatus).map(([k, v]) => `${v} ${k}`).join(", ")}`, "", "mês       criadas  concluídas  arquivadas  saldo"];
  for (const [m, x] of Object.entries(r.porMes)) L.push(`${m}   ${String(x.criadas).padStart(7)}  ${String(x.concluidas).padStart(10)}  ${String(x.arquivadas).padStart(10)}  ${String(x.saldo).padStart(5)}`);
  L.push("", `idade das abertas (dias): p50 ${r.idadeAbertasDias.p50}, p90 ${r.idadeAbertasDias.p90}, max ${r.idadeAbertasDias.max}; faixas ${JSON.stringify(r.idadeAbertasDias.faixas)}`);
  L.push(`top prefixos abertos: ${r.topPrefixos.map((x) => `${x.prefixo}×${x.n}`).join(", ")}`);
  L.push(`concluídas com prova: ${r.concluidasComProvaPct}%`);
  return L.join("\n");
}

// ------------------------------------------------------------------------------------ CLI
const USO = `uso: tasklog-hygiene.mjs [check|report] [--repo <raiz>] [--stale-days 30] [--running-hours 48] [--no-prod]
                            [--tasks-file f.json] [--json] [--warn-only] [--list 10] [--strict-proof --proof-since AAAA-MM-DD]
  check   (padrão) reprova duplicata aberta (mesmo label), tarefas correlatas abertas (similaridade >= 0.80; 0.50-0.79 so avisa), pendente/running parado, renew fora do teto (${45} dias, motivo >= 15 car.), FALTA-deploy já publicado
  report  burn-down do TaskLog
  exit 0 passa, 1 bloqueia, 2 uso, 3 o gate NÃO rodou (TaskLog ilegível, ou 0 tarefas sem --repo/--tasks-file)`;

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0] && !argv[0].startsWith("--") ? argv[0] : "check";
  const o = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
  const repo = path.resolve(o("--repo", process.cwd()));
  if (argv.includes("--help") || argv.includes("-h") || cmd === "help") { console.log(USO); process.exit(0); }
  if (!["check", "report"].includes(cmd)) { console.error(USO); process.exit(2); }
  let tasks;
  try { tasks = carregarTarefas({ repo, tasksFile: o("--tasks-file") }); }
  catch (e) { console.error(`✗ tasklog-hygiene: ${e.message}\n  (o gate NÃO rodou; corrija a leitura ou passe --tasks-file)`); process.exit(3); }
  if (!tasks || tasks.length === 0) {
    if (!o("--tasks-file") && !argv.includes("--repo")) { console.error("✗ tasklog-hygiene: TaskLog com 0 tarefas e sem --repo: provavelmente rodou fora da casa; o gate NÃO rodou (passe --repo <raiz> ou --tasks-file)"); process.exit(3); }
  }
  const now = Math.floor(Date.now() / 1000);
  if (cmd === "report") {
    const r = relatorio(tasks, { now, months: Number(o("--months", 6)) });
    console.log(argv.includes("--json") ? JSON.stringify(r, null, 2) : formatarRelatorio(r));
    process.exit(0);
  }
  const staleDays = Number(o("--stale-days", 30)), runningHours = Number(o("--running-hours", 48));
  let produtos, proveFn;
  if (!argv.includes("--no-prod")) {
    try {
      const di = await import("../deploy-integrity/deploy-integrity.mjs");
      produtos = di.produtosRegistrados(repo);
      proveFn = (p) => proveReal(repo, p);
    } catch { /* sem deploy-integrity: a regra falta-publicado fica fora, e o relatório diz */ }
  }
  const res = await verificar(tasks, { now, staleDays, runningHours, produtos, proveFn, strictProof: argv.includes("--strict-proof"), proofSince: o("--proof-since") });
  if (argv.includes("--json")) console.log(JSON.stringify({ pass: res.erros.length === 0, ...res }, null, 2));
  else console.log(formatar(res, { lista: Number(o("--list", 10)), staleDays, runningHours }));
  process.exit(argv.includes("--warn-only") ? 0 : res.erros.length ? 1 : 0);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
