// Testes do gate do TaskLog. Built-ins only (node:test). Prova-que-reprova para cada regra.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { violacoesDeIdade, violacoesFaltaPublicado, produtoDaTarefa, renovacaoVigente, renovacaoInvalida, avisosDeRenovacao, vinculoExplicito, relatorio, verificar, labelPrefix, avisosDeProva, carregarTarefas, RE_FALTA, violacoesDeDuplicata, violacoesDeCorrelatas, carregarSimilaridade } from "./tasklog-hygiene.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const NOW = Math.floor(Date.parse("2026-11-04T12:00:00Z") / 1000);
const DIA = 86400;
let n = 0;
const T = (label, status, idadeDias, metadata = {}, extra = {}) => ({
  id: `id${String(++n).padStart(6, "0")}-aaaa-bbbb-cccc-dddddddddddd`, label, status,
  context: { toolOutputs: {}, metadata }, createdAt: NOW - idadeDias * DIA, updatedAt: NOW - idadeDias * DIA, ...extra,
});

test("stale: pendente acima do limite reprova; dentro do limite passa; padrão 30 dias", () => {
  const v = violacoesDeIdade([T("velha", "pending", 31), T("nova", "pending", 29), T("feita", "completed", 400)], { now: NOW });
  assert.deepEqual(v.map((x) => x.label), ["velha"]);
  assert.equal(v[0].regra, "stale");
  assert.match(v[0].sugestao, /"action":"archive","taskId":"id000001/);
  assert.equal(violacoesDeIdade([T("x", "pending", 31)], { now: NOW, staleDays: 60 }).length, 0);
});

test("renewedUntil vigente COM motivo isenta; expirado ou sem motivo reprova", () => {
  const ok = T("renovada", "pending", 90, { renewedUntil: { until: "2026-12-01", reason: "aguardando cliente" } });
  const expirada = T("expirada", "pending", 90, { renewedUntil: { until: "2026-10-01", reason: "x" } });
  const semMotivo = T("sem-motivo", "pending", 90, { renewedUntil: { until: "2026-12-01", reason: " " } });
  assert.equal(renovacaoVigente(ok, NOW), true);
  const v = violacoesDeIdade([ok, expirada, semMotivo], { now: NOW });
  assert.deepEqual(v.map((x) => x.label).sort(), ["expirada", "sem-motivo"]);
  assert.match(v.find((x) => x.label === "expirada").detalhe, /expirado ou sem motivo/);
});

test("running sem update em 48 h reprova (regra running-orfa); com 47 h passa; running não duplica stale", () => {
  const velho = { ...T("agente-morto", "running", 0), updatedAt: NOW - 49 * 3600 };
  const ok = { ...T("agente-vivo", "running", 0), updatedAt: NOW - 47 * 3600 };
  const antigo = T("running-antigo", "running", 90);
  const v = violacoesDeIdade([velho, ok, antigo], { now: NOW });
  assert.deepEqual(v.map((x) => `${x.regra}:${x.label}`).sort(), ["running-orfa:agente-morto", "running-orfa:running-antigo"]);
});

test("running com renewedUntil vigente é isento", () => {
  const t = { ...T("longa", "running", 0, { renewedUntil: { until: "2026-11-10", reason: "build de 3 dias" } }), updatedAt: NOW - 72 * 3600 };
  assert.equal(violacoesDeIdade([t], { now: NOW }).length, 0);
});

test("RE_FALTA pega as formas reais do TaskLog e ignora prosa", () => {
  for (const s of ["IMPLEMENTADO e testado local; FALTA deploy + env", "FALTA commit + deploy", "pendente de deploy", "falta o deploy"]) assert.match(s, RE_FALTA, s);
  assert.doesNotMatch("falta de tempo para o relatório", RE_FALTA);
  assert.doesNotMatch("deploy feito e verificado", RE_FALTA);
});

test("produtoDaTarefa: nome do produto no label, prefixo de produto e tag explícita", () => {
  const produtos = [{ produto: "products/astrus-front" }, { produto: "products/thalia" }, { produto: "products/hefesto" }];
  assert.deepEqual(produtoDaTarefa(T("astrus-paginas-home: FALTA deploy", "pending", 1), produtos).map((p) => p.produto), ["products/astrus-front"]);
  assert.deepEqual(produtoDaTarefa(T("sala-nova: FALTA deploy", "pending", 1, { tags: ["deploy:thalia"] }), produtos).map((p) => p.produto), ["products/thalia"]);
  assert.deepEqual(produtoDaTarefa(T("batiste-algo", "pending", 1), produtos), []);
});

test("falta-publicado: texto diz FALTA deploy e a prova-no-ar está verde => reprova com o comando de fechamento exato", async () => {
  const produtos = [{ produto: "products/astrus-front", host: "https://astrus.cachola.tech" }];
  const t = T("astrus-integracao: IMPLEMENTADO; FALTA deploy + env", "pending", 2, { tags: ["deploy:astrus-front"] });
  const feita = T("astrus-integracao-2: FALTA deploy", "completed", 2);
  const chamadas = [];
  const proveFn = async (p) => { chamadas.push(p.produto); return { ok: true, url: "https://astrus.cachola.tech/", commit: "e36e6ef9aaaa" }; };
  const v = await violacoesFaltaPublicado([t, feita, T("astrus-b: FALTA commit", "pending", 1)], { produtos, proveFn, now: NOW });
  assert.equal(v.length, 2);
  assert.equal(chamadas.length, 1, "uma prova por produto (cache)");
  assert.equal(v[0].candidato, false);
  assert.equal(v[1].candidato, true);
  assert.match(v[1].sugestao, /^candidato, confira manualmente/);
  const cmd = v[0].sugestao;
  assert.match(cmd, /^batiste-direct manage_task '/);
  const json = JSON.parse(cmd.slice(cmd.indexOf("'") + 1, cmd.lastIndexOf("'")));
  assert.deepEqual(json, { action: "close", taskId: t.id, proof: "prova-no-ar verde https://astrus.cachola.tech/ @ e36e6ef9", links: { commit: "e36e6ef9", url: "https://astrus.cachola.tech/" } });
});

test("falta-publicado: prova não verde (ou erro) NÃO reprova a tarefa", async () => {
  const produtos = [{ produto: "products/astrus-front", host: "https://astrus.cachola.tech" }];
  const t = T("astrus-x: FALTA deploy", "pending", 2);
  assert.equal((await violacoesFaltaPublicado([t], { produtos, proveFn: async () => ({ ok: false }), now: NOW })).length, 0);
  assert.equal((await violacoesFaltaPublicado([t], { produtos, proveFn: async () => { throw new Error("rede"); }, now: NOW })).length, 0);
});

test("renew não burla o gate: horizonte além de 45 dias, motivo curto e data distante reprovam", () => {
  const mk = (r) => T("burla", "pending", 200, { renewedUntil: { at: NOW, ...r } });
  assert.equal(violacoesDeIdade([mk({ until: "2099-01-01", reason: "x" })], { now: NOW }).length, 1);
  const longe = violacoesDeIdade([mk({ until: "2099-01-01", reason: "motivo suficientemente longo" })], { now: NOW });
  assert.equal(longe.length, 1);
  assert.match(longe[0].detalhe, /passa do teto de 45 dias/);
  assert.equal(violacoesDeIdade([mk({ until: "2026-11-20", reason: "curto demais" })], { now: NOW }).length, 1);
  assert.equal(violacoesDeIdade([mk({ until: "2026-12-18", reason: "aguardando resposta do cliente" })], { now: NOW }).length, 0);
  assert.equal(violacoesDeIdade([mk({ until: "2026-12-20", reason: "aguardando resposta do cliente" })], { now: NOW }).length, 1);
  assert.equal(renovacaoInvalida(T("sem", "pending", 1), NOW), null);
});

test("renovação repetida (> 2) gera aviso", () => {
  const r = (count) => T(`r${count}`, "pending", 1, { renewedUntil: { until: "2026-11-20", reason: "aguardando resposta do cliente", at: NOW, count } });
  assert.deepEqual(avisosDeRenovacao([r(2), r(3)]).map((a) => a.regra), ["renovacao-repetida"]);
});

test("idade conta o último progresso, não o último toque (nota/touch não zera)", () => {
  const t = T("tocada", "pending", 100, { progressAt: NOW - 100 * DIA });
  t.updatedAt = NOW - 1 * DIA;                       // alguém só adicionou uma nota ontem
  assert.equal(violacoesDeIdade([t], { now: NOW }).length, 1);
  const legado = T("legado", "pending", 3);          // sem progressAt: cai no updatedAt
  assert.equal(violacoesDeIdade([legado], { now: NOW }).length, 0);
});

test("RE_FALTA: variações de ordem e flexão", () => {
  for (const s of ["hefesto deploy faltando", "falta publicar", "deploy pendente", "falta publicação da v2", "o deploy falta", "faltam commit e deploy"]) assert.match(s, RE_FALTA, s);
  for (const s of ["falta de público", "deploy ok, nada pendente", "faltou tempo"]) assert.doesNotMatch(s, RE_FALTA, s);
});

test("produtoDaTarefa: casa por token, não por substring; hefesto-thalia casa os dois e exige ambos no ar", async () => {
  const produtos = [{ produto: "products/thalia", host: "h1" }, { produto: "products/hefesto", host: "h2" }, { produto: "products/astrus-front" }];
  const t = T("hefesto-thalia: FALTA deploy", "pending", 1);
  assert.deepEqual(produtoDaTarefa(t, produtos).map((p) => p.produto).sort(), ["products/hefesto", "products/thalia"]);
  assert.deepEqual(produtoDaTarefa(T("athalian-x", "pending", 1), produtos), []);
  assert.equal(vinculoExplicito(t, produtos[0]), false);
  const nv = [];
  const so1 = async (p) => (p.produto.endsWith("thalia") ? { ok: true, url: "u", commit: "abc12345" } : { ok: false, erro: "suja" });
  assert.equal((await violacoesFaltaPublicado([t], { produtos, proveFn: so1, now: NOW, naoVerificadas: nv })).length, 0);
  assert.match(nv[0].motivo, /hefesto: suja/);
});

test("falta-publicado: sem produto casado ou prova falha vai para naoVerificadas", async () => {
  const produtos = [{ produto: "products/thalia", host: "h" }];
  const nv = [];
  await violacoesFaltaPublicado([T("outra-coisa: FALTA deploy", "pending", 1), T("thalia deploy faltando", "pending", 1)], { produtos, proveFn: async () => ({ ok: false, erro: "rede" }), now: NOW, naoVerificadas: nv });
  assert.equal(nv.length, 2);
  assert.match(nv[0].motivo, /nenhum produto/);
  assert.match(nv[1].motivo, /rede/);
});

test("completed sem prova: aviso por padrão; --strict-proof reprova só as posteriores a --proof-since", () => {
  const velha = T("velha", "completed", 100);
  const nova = T("nova", "completed", 1);
  const boa = T("boa", "completed", 1, { closed: { proof: "p", at: NOW } });
  assert.equal(avisosDeProva([velha, nova, boa]).avisos.length, 1);
  assert.equal(avisosDeProva([velha, nova, boa]).erros.length, 0);
  const s = avisosDeProva([velha, nova, boa], { strictProof: true, proofSince: "2026-11-01" });
  assert.deepEqual(s.erros.map((e) => e.label), ["nova"]);
});

test("relatório de burn-down: criadas x concluídas por mês, idade, faixas, prefixos, % com prova", () => {
  const tasks = [
    T("proposta-gerada-a", "pending", 70), T("proposta-gerada-b", "pending", 5), T("hefesto-bp-1", "running", 40),
    T("feita", "completed", 10, { closed: { proof: "p", at: NOW - 10 * DIA } }), T("feita2", "completed", 10),
  ];
  const r = relatorio(tasks, { now: NOW });
  assert.equal(r.total, 5);
  assert.equal(r.porStatus.pending, 2);
  assert.equal(r.idadeAbertasDias.faixas["61+"], 1);
  assert.equal(r.idadeAbertasDias.max, 70);
  assert.equal(r.topPrefixos[0].prefixo, "proposta-gerada");
  assert.equal(r.concluidasComProvaPct, 50);
  assert.equal(r.porMes["2026-10"].concluidas, 2);
  assert.ok(r.porMes["2026-08"].criadas >= 1);
  assert.equal(labelPrefix("hefesto-bp-x1 foo"), "hefesto-bp");
});

test("verificar: TaskLog limpo passa; sujo reprova", async () => {
  assert.equal((await verificar([T("ok", "pending", 3)], { now: NOW })).erros.length, 0);
  assert.equal((await verificar([T("velha", "pending", 90)], { now: NOW })).erros.length, 1);
});

// ------------------------------------------------------------------ CLI
const CLI = path.join(AQUI, "tasklog-hygiene.mjs");
const arquivo = (tasks) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tl-")), "t.json"); fs.writeFileSync(f, JSON.stringify({ tasks })); return f; };
const rodar = (...a) => spawnSync(process.execPath, [CLI, ...a], { encoding: "utf8" });
const agora = Math.floor(Date.now() / 1000);
const real = (label, status, dias) => ({ id: `r${label}-0000-0000-0000-000000000000`, label, status, context: { metadata: {} }, createdAt: agora - dias * DIA, updatedAt: agora - dias * DIA });

test("CLI: exit 1 com tarefa parada; exit 0 limpo; --warn-only nunca derruba; --json estruturado", () => {
  const sujo = arquivo([real("velha", "pending", 90)]);
  const r = rodar("check", "--tasks-file", sujo, "--no-prod");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /\[stale\] 1 tarefa/);
  assert.match(r.stdout, /A sessão não terminou/);
  assert.equal(rodar("check", "--tasks-file", sujo, "--no-prod", "--warn-only").status, 0);
  const j = JSON.parse(rodar("check", "--tasks-file", sujo, "--no-prod", "--json").stdout);
  assert.equal(j.pass, false); assert.equal(j.erros[0].regra, "stale");
  assert.equal(rodar("check", "--tasks-file", arquivo([real("nova", "pending", 2)]), "--no-prod").status, 0);
});

test("CLI: TaskLog ilegível => exit 3 (o gate não finge que passou)", () => {
  const r = spawnSync(process.execPath, [CLI, "check", "--repo", os.tmpdir()], { encoding: "utf8", env: { ...process.env, BATISTE_DIRECT: "/nao/existe/batiste-direct" } });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /não li o TaskLog/);
  assert.throws(() => carregarTarefas({ repo: os.tmpdir(), bin: "/nao/existe" }), /não li o TaskLog/);
});

test("CLI: --help imprime uso (exit 0); 0 tarefas sem --repo => exit 3; com --repo ou --tasks-file passa", () => {
  const h = rodar("--help");
  assert.equal(h.status, 0);
  assert.match(h.stdout, /^uso: tasklog-hygiene/);
  const vazio = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tl-e-")), "bin");
  fs.writeFileSync(vazio, "#!/bin/sh\necho '{\"tasks\":[]}'\n", { mode: 0o755 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tl-c-"));
  const envv = { ...process.env, BATISTE_DIRECT: vazio };
  const r = spawnSync(process.execPath, [CLI, "check", "--no-prod"], { encoding: "utf8", cwd: dir, env: envv });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /0 tarefas/);
  assert.equal(spawnSync(process.execPath, [CLI, "check", "--no-prod", "--repo", dir], { encoding: "utf8", env: envv }).status, 0);
  assert.equal(rodar("check", "--no-prod", "--tasks-file", arquivo([])).status, 0);
});

test("CLI report --json: burn-down", () => {
  const j = JSON.parse(rodar("report", "--tasks-file", arquivo([real("a", "pending", 3), real("b", "completed", 1)]), "--json").stdout);
  assert.equal(j.total, 2);
  assert.ok(j.porMes && j.idadeAbertasDias && j.topPrefixos);
});

test("duplicata-aberta: 2+ abertas com o mesmo label normalizado reprovam, mantem a mais antiga e sugere archive das copias", () => {
  const velha = T("Proposta-Gerada-CT-X", "pending", 5);
  const c1 = T(" proposta-gerada-ct-x", "pending", 3);
  const c2 = T("proposta-gerada-ct-x ", "running", 1);
  const fechada = T("proposta-gerada-ct-x", "completed", 2);
  const unica = T("outra", "pending", 1);
  const v = violacoesDeDuplicata([c1, velha, c2, fechada, unica]);
  assert.deepEqual(v.map((x) => x.taskId).sort(), [c1.id, c2.id].sort());
  assert.ok(v.every((x) => x.regra === "duplicata-aberta" && x.mantem === velha.id));
  assert.match(v[0].sugestao, /"action":"archive","taskId":"id/);
  assert.match(v[0].sugestao, new RegExp(`duplicata de ${velha.id}`));
  assert.equal(violacoesDeDuplicata([velha, fechada, unica]).length, 0);
});

test("duplicata-aberta: entra em verificar() e no --json com exit 1", () => {
  const a = T("dup-x", "pending", 1), b = T("dup-x", "pending", 1);
  return verificar([a, b], { now: NOW }).then((r) => {
    assert.equal(r.erros.filter((e) => e.regra === "duplicata-aberta").length, 1);
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tlh-")), "t.json");
    fs.writeFileSync(f, JSON.stringify([a, b]));
    const p = spawnSync("node", [path.join(AQUI, "tasklog-hygiene.mjs"), "check", "--tasks-file", f, "--no-prod", "--json"], { encoding: "utf8" });
    assert.equal(p.status, 1);
    const j = JSON.parse(p.stdout);
    assert.equal(j.pass, false);
    assert.ok(j.erros.some((e) => e.regra === "duplicata-aberta" && /archive/.test(e.sugestao)));
  });
});

test("correlatas-abertas: >= 0.80 reprova com o comando merge exato (alvo = mais antigo); 0.50-0.79 so avisa; label identico fica com duplicata-aberta", async () => {
  const sim = await carregarSimilaridade();
  assert.ok(!sim.erro, sim.erro);
  const velha = T("site-a: publicar pagina de precos em producao", "pending", 5);
  const nova = T("site-a: deploy da pagina de precos em producao", "pending", 2);
  const corr = T("site-a: conferir cache da pagina de precos em producao", "pending", 1);
  const outra = T("site-a: calcular imposto do trimestre", "pending", 1);
  const fechada = T("site-a: publicar pagina de precos em producao", "completed", 3);
  const r = violacoesDeCorrelatas([velha, nova, corr, outra, fechada], sim);
  assert.equal(r.erros.length, 1, JSON.stringify(r.erros));
  assert.equal(r.erros[0].regra, "correlatas-abertas");
  assert.equal(r.erros[0].taskId, nova.id);
  assert.equal(r.erros[0].mantem, velha.id);
  assert.equal(r.erros[0].sugestao, `batiste-direct manage_task '${JSON.stringify({ action: "merge", sourceId: nova.id, targetId: velha.id })}'`);
  assert.ok(r.avisos.length >= 1 && r.avisos.every((a) => a.nivel === "aviso" && a.score >= 0.5 && a.score < 0.8 && /"action":"merge"/.test(a.sugestao)));
  const iguais = violacoesDeCorrelatas([T("mesmo nome", "pending", 3), T("mesmo nome", "pending", 2)], sim);
  assert.equal(iguais.erros.length, 0, "identico e da regra duplicata-aberta");
  assert.equal(violacoesDeDuplicata([T("mesmo nome", "pending", 3), T("mesmo nome", "pending", 2)]).length, 1);
});

test("correlatas-abertas: entra em verificar() e no --json; cluster A~B~C gera um alvo; sem motor so avisa que nao rodou", async () => {
  const a = T("proj-x: publicar pagina de contato em producao", "pending", 9);
  const b = T("proj-x: deploy da pagina de contato em producao", "pending", 8);
  const c = T("proj-x: subir pagina de contato para producao", "pending", 7);
  const res = await verificar([a, b, c], { now: NOW });
  const erros = res.erros.filter((e) => e.regra === "correlatas-abertas");
  assert.equal(erros.length, 2);
  assert.ok(erros.every((e) => e.mantem === a.id));
  const sem = await verificar([a, b], { now: NOW, similarity: null });
  assert.equal(sem.erros.filter((e) => e.regra === "correlatas-abertas").length, 0);
  assert.ok(sem.avisos.some((x) => x.regra === "correlatas-abertas" && /NAO rodou/.test(x.detalhe)));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tlh-corr-"));
  const f = path.join(dir, "t.json");
  fs.writeFileSync(f, JSON.stringify({ tasks: [{ ...a, createdAt: Math.floor(Date.now() / 1000) - 9, updatedAt: Math.floor(Date.now() / 1000) - 9 }, { ...b, createdAt: Math.floor(Date.now() / 1000) - 8, updatedAt: Math.floor(Date.now() / 1000) - 8 }] }));
  const r = spawnSync(process.execPath, [path.join(AQUI, "tasklog-hygiene.mjs"), "--tasks-file", f, "--no-prod", "--json"], { encoding: "utf8" });
  assert.equal(r.status, 1, r.stderr + r.stdout);
  const j = JSON.parse(r.stdout);
  assert.equal(j.pass, false);
  assert.ok(j.erros.some((e) => e.regra === "correlatas-abertas" && /"action":"merge"/.test(e.sugestao)));
  const txt = spawnSync(process.execPath, [path.join(AQUI, "tasklog-hygiene.mjs"), "--tasks-file", f, "--no-prod"], { encoding: "utf8" });
  assert.match(txt.stdout, /\[correlatas-abertas\] 1 tarefa/);
});
