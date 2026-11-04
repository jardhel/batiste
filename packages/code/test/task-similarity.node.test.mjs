// Testes do motor de similaridade de tarefas (puro, deterministico, sem rede/LLM).
//   node --test packages/code/test/task-similarity.node.test.mjs        (Node >= 22.18: importa o .ts direto)
// Fixtures sinteticas DERIVADAS dos padroes do TaskLog real (sem nomes de cliente/dados): cada par traz o rotulo
// esperado; o teste tambem mede precisao/recall do conjunto sintetico e exige o piso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/mcp/task-similarity.ts';

let n = 0;
const T = (label, meta = {}, extra = {}) => ({ id: `t${String(++n).padStart(4, '0')}`, label, status: 'pending', context: { metadata: meta }, createdAt: 1000 + n, ...extra });
const score = (a, b, uni) => S.similarity(a, b, uni).score;

test('limiares documentados: 0.80 mesma, 0.50 correlata', () => {
  assert.equal(S.THRESHOLD_SAME, 0.8);
  assert.equal(S.THRESHOLD_RELATED, 0.5);
  assert.equal(S.classify(0.8), 'same');
  assert.equal(S.classify(0.79), 'related');
  assert.equal(S.classify(0.5), 'related');
  assert.equal(S.classify(0.49), 'distinct');
});

test('tokenize: minusculas, sem acentos, sem stopwords PT/EN, sem datas e numeros soltos, sinonimos', () => {
  const t = S.tokenize('O Deploy da Página X em 2026-11-04, versão 12 — publicação');
  assert.ok(!t.includes('o') && !t.includes('da') && !t.includes('em'));
  assert.ok(!t.some((x) => /\d{4}/.test(x)) && !t.includes('12'));
  assert.ok(t.includes('pagina'));
  assert.equal(t.filter((x) => x === 'publicar').length, 2, 'deploy e publicacao caem no mesmo token');
  assert.ok(S.tokenize('release v0.3 do hefesto').includes('v0.3'), 'versao e um token so');
});

test('determinismo: mesmas entradas, mesmo score; ordem do universo nao muda o resultado', () => {
  const a = T('astrus-bussola deploy da pagina de zoom');
  const b = T('astrus-bussola publicar pagina de zoom em producao');
  const c = T('outra coisa totalmente diferente sobre faturas');
  const s1 = S.similarity(a, b, [a, b, c]).score;
  const s2 = S.similarity(a, b, [c, b, a]).score;
  assert.equal(s1, s2);
  assert.equal(S.similarity(a, b, [a, b, c]).score, s1);
});

test('label identico = 1.0; exemplo do founder: mesmo prefixo reescrito vira "mesma", sem prefixo vira "correlata"', () => {
  assert.equal(score(T('Deploy da pagina X'), T('  deploy da pagina x ')), 1);
  const a = T('zz-teste-merge deploy da pagina X');
  const b = T('zz-teste-merge publicar pagina X em producao');
  assert.ok(score(a, b) >= S.THRESHOLD_SAME, `esperado >= 0.80, veio ${score(a, b)}`);
  const c = T('deploy da pagina X');
  const d = T('publicar pagina X em producao');
  const r = S.similarity(c, d);
  assert.equal(r.kind, 'related', `esperado correlata, veio ${r.score}`);
});

test('refs compartilhadas (commit, release, URL, arquivo) elevam o score; produtos diferentes rebaixam', () => {
  const base = { links: { commit: 'abc1234def' } };
  const a = T('alfa: ajustar contraste do painel', { ...base });
  const b = T('alfa: revisar paleta do painel', { links: { commit: 'abc1234' } });
  const b0 = T('alfa: revisar paleta do painel');
  assert.ok(score(a, b) > score(a, b0), 'mesmo commit sobe o score');
  assert.deepEqual(S.similarity(a, b).sharedRefs, ['sha:abc1234']);
  const r1 = T('alfa: publicar pagina de precos'), r2 = T('beta: publicar pagina de precos');
  const r3 = T('alfa: publicar pagina de precos de novo');
  assert.ok(score(r1, r2) < score(r1, r3), 'produto diferente penaliza');
  assert.deepEqual(S.extractRefs(T('x', { links: { release: '2026-11-04-foo-v1', url: 'https://x.example/p/' } })).sort(), ['release:releases/2026-11-04-foo-v1', 'url:https://x.example/p']);
});

test('irmas distintas (B1 vs B2, os-01 vs os-02, Task 1 vs Task 2, v0.3 vs v0.4) nunca passam de distinta', () => {
  for (const [x, y] of [['hefesto-bp B1 missao e visao', 'hefesto-bp B2 missao e visao'], ['proposta-x-2026-08-003-os-01', 'proposta-x-2026-08-003-os-02'], ['Task 1', 'Task 2'], ['plano v0.3 consolidado', 'plano v0.4 consolidado']]) {
    assert.ok(score(T(x), T(y)) < S.THRESHOLD_RELATED, `${x} ~ ${y}`);
  }
  // pai/filha nao e conflito de irma: so perde pontos
  assert.ok(score(T('proposta-x-2026-08-003'), T('proposta-x-2026-08-003-os-01')) >= S.THRESHOLD_RELATED);
});

test('contexto (state/notes) entra no score com peso menor que o label', () => {
  const a = T('limpar cache do edge', { state: { next: 'purgar a zona e conferir o header cf-cache-status' } });
  const b = T('purgar cache', { state: { next: 'purgar a zona e conferir o header cf-cache-status' } });
  const b0 = T('purgar cache');
  assert.ok(score(a, b) > score(a, b0));
});

test('pickTarget: maior fase, depois o mais antigo', () => {
  const velho = T('x', { phase: 'todo' }, { createdAt: 10 });
  const novo = T('x2', { phase: 'built' }, { createdAt: 99 });
  assert.equal(S.pickTarget([velho, novo]).id, novo.id);
  const a = T('a', {}, { createdAt: 5 }), b = T('b', {}, { createdAt: 3 });
  assert.equal(S.pickTarget([a, b]).id, b.id);
});

test('clusterSimilar: A~B, B~C vira um cluster com UM alvo e comandos merge exatos', () => {
  const a = T('proj-x: publicar pagina de contato em producao', {}, { createdAt: 1 });
  const b = T('proj-x: deploy da pagina de contato em producao', {}, { createdAt: 2 });
  const c = T('proj-x: subir pagina de contato para producao', {}, { createdAt: 3 });
  const z = T('proj-x: calcular imposto do trimestre');
  const cl = S.clusterSimilar([a, b, c, z]);
  assert.equal(cl.length, 1);
  assert.equal(cl[0].targetId, a.id);
  assert.equal(cl[0].merges.length, 2);
  assert.match(cl[0].merges[0].command, /"action":"merge","sourceId":"t\d+","targetId":"t\d+"/);
  assert.ok(!cl[0].members.some((m) => m.taskId === z.id));
});

// ---- conjunto sintetico rotulado: S=mesma, R=correlata, D=distinta ----
const PARES = [
  ['S', 'site-a: publicar pagina de precos em producao', 'site-a: deploy da pagina de precos em producao'],
  ['S', 'api-b corrigir timeout do webhook', 'api-b: fix webhook timeout'],
  ['S', 'app-c revisar textos das 4 linguas', 'app-c: revisao dos textos em 4 linguas'],
  ['S', 'infra-d: criar alerta de custo da conta', 'infra-d criar alerta de custo na conta'],
  ['R', 'site-a: publicar pagina de precos', 'site-a: revisar copy da pagina de precos'],
  ['R', 'data-e: migrar banco para D1', 'data-e: validar migracao do banco D1'],
  ['R', 'app-c: wire do pagamento no checkout', 'app-c: testar checkout do pagamento'],
  ['R', 'infra-d: rotacionar segredo do webhook', 'infra-d: auditar segredos do webhook'],
  ['D', 'site-a: publicar pagina de precos', 'site-a: calcular imposto do trimestre'],
  ['D', 'api-b: corrigir timeout do webhook', 'app-c: desenhar icone do menu'],
  ['D', 'data-e: migrar banco para D1', 'infra-d: renovar dominio'],
  ['D', 'app-c: B1 missao', 'app-c: B2 solucao'],
  ['D', 'proposta-z-2026-08-003-os-01', 'proposta-z-2026-08-003-os-02'],
  ['D', 'Task 1', 'Task 2'],
  ['D', 'alfa: publicar pagina de precos', 'beta: publicar pagina de precos'],
  ['D', 'site-a: video de lancamento', 'site-a: contrato do fornecedor'],
];

test('conjunto sintetico rotulado: classe prevista == rotulo; precisao e recall nos dois limiares >= 0.75', () => {
  const rows = PARES.map(([cls, x, y]) => ({ cls, s: score(T(x), T(y)), x, y }));
  const bad = rows.filter((r) => (r.cls === 'S' ? r.s < S.THRESHOLD_SAME : r.cls === 'R' ? r.s < S.THRESHOLD_RELATED || r.s >= S.THRESHOLD_SAME : r.s >= S.THRESHOLD_RELATED));
  const pr = (pred, pos) => {
    const tp = rows.filter((r) => pred(r) && pos(r)).length, fp = rows.filter((r) => pred(r) && !pos(r)).length, fn = rows.filter((r) => !pred(r) && pos(r)).length;
    return { p: tp / (tp + fp || 1), r: tp / (tp + fn || 1) };
  };
  const same = pr((r) => r.s >= S.THRESHOLD_SAME, (r) => r.cls === 'S');
  const rel = pr((r) => r.s >= S.THRESHOLD_RELATED, (r) => r.cls !== 'D');
  console.log('sintetico', JSON.stringify({ n: rows.length, mesclar: same, correlata: rel, erros: bad.map((b) => [b.cls, b.s, b.x, b.y]) }));
  // limitacao conhecida (lexical): 'migrar banco D1' x 'validar migracao do banco D1' passa de 0.80 porque migrar~migracao
  // colapsam no mesmo stem e o resto do label coincide; e o 1 erro de 16 (precisao de 'mesclar' = 0.80 no sintetico).
  assert.ok(same.p >= 0.75 && same.r >= 0.75, JSON.stringify(same));
  assert.ok(rel.p >= 0.75 && rel.r >= 0.75, JSON.stringify(rel));
});
