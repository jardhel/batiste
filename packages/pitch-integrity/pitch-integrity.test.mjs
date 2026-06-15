// Testes do gate pitch-integrity — built-ins only (node:test + node:assert),
// sem rede, sem filesystem nos testes de núcleo. As heurísticas de conteúdo
// (scanSource) e de seleção de arquivo (isPitchArtifact/isScannable) e de
// extração de alvos (extractTargets) são puras e testadas aqui.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scanSource,
  isPitchArtifact,
  isScannable,
  extractTargets,
} from "./pitch-integrity.mjs";

const has = (findings, check) => findings.some((f) => f.check === check);

// --- seleção de artefato ----------------------------------------------------

test("isPitchArtifact: pega examples/ e demos/, ignora node_modules e engine", () => {
  assert.equal(isPitchArtifact("examples/investor-demo/run.ts"), true);
  assert.equal(isPitchArtifact("demos/foo/show.js"), true);
  assert.equal(isPitchArtifact("docs/investor-pitch.md"), true);
  assert.equal(isPitchArtifact("docs/architecture.md"), false); // doc não marcado
  assert.equal(isPitchArtifact("packages/marketplace/src/index.ts"), false);
  assert.equal(isPitchArtifact("examples/x/node_modules/dep/index.js"), false);
});

test("isScannable: só texto/código", () => {
  assert.equal(isScannable("examples/run.ts"), true);
  assert.equal(isScannable("examples/run.md"), true);
  assert.equal(isScannable("examples/logo.png"), false);
});

// --- 1. theater-success -----------------------------------------------------

test("theater-success: result literal constante FALHA", () => {
  const f = scanSource(`ledger.append({ result: 'success', durationMs: x });`);
  assert.ok(has(f, "theater-success"));
  assert.equal(f.find((x) => x.check === "theater-success").level, "error");
});

test("theater-success: result computado NÃO falha", () => {
  const f = scanSource(`const result = ok ? 'success' : 'fail'; out.result = result;`);
  assert.equal(has(f, "theater-success"), false);
});

// --- 2. fake-work-sleep -----------------------------------------------------

test("fake-work-sleep: sleep com 'simulate real work' FALHA", () => {
  const f = scanSource(`await sleep(latency + 20); // simulate real work`);
  assert.ok(has(f, "fake-work-sleep"));
});

test("fake-work-sleep: sleep honesto (sem comentário de simulação) NÃO falha", () => {
  const f = scanSource(`await sleep(400); // boot animation pacing`);
  assert.equal(has(f, "fake-work-sleep"), false);
});

// --- 3. random-metric -------------------------------------------------------

test("random-metric: latência de Math.random FALHA", () => {
  const f = scanSource(`const latency = 30 + Math.floor(Math.random() * 18); // ms`);
  assert.ok(has(f, "random-metric"));
});

test("random-metric: jitter() como fonte de latência FALHA", () => {
  const f = scanSource(`const latency = jitter(38, 18);`);
  assert.ok(has(f, "random-metric"));
});

test("random-metric: Math.random não-métrico (ex. id/jitter de retry) NÃO falha", () => {
  const f = scanSource(`const backoff = Math.random() * 100; // retry spread`);
  assert.equal(has(f, "random-metric"), false);
});

// --- 4. multiplier-metric ---------------------------------------------------

test("multiplier-metric: p95/p99 por multiplicador fixo FALHA", () => {
  const f1 = scanSource(`const p95 = Math.round(n.latencyMs * 1.4);`);
  const f2 = scanSource(`const p99 = Math.round(latencyMs * 1.9);`);
  assert.ok(has(f1, "multiplier-metric"));
  assert.ok(has(f2, "multiplier-metric"));
});

test("multiplier-metric: percentil medido de array NÃO falha", () => {
  const f = scanSource(`const p95 = percentile(samples, 0.95);`);
  assert.equal(has(f, "multiplier-metric"), false);
});

// --- 5. production-ready ----------------------------------------------------

test("production-ready: claim sem proveniência FALHA", () => {
  const f = scanSource(`println('Batiste is production-ready');`);
  assert.ok(has(f, "production-ready"));
});

test("production-ready: claim COM proveniência (link/teste/medição) NÃO falha", () => {
  const withLink = scanSource(`// production-ready — see https://ci.example/run/123`);
  const withTest = scanSource(`production-ready: validated by marketplace.test.ts (42 passing)`);
  const withNext = scanSource(`production-ready\nbenchmarked: 9.8k req/s measured on 2026-06`);
  assert.equal(has(withLink, "production-ready"), false);
  assert.equal(has(withTest, "production-ready"), false);
  assert.equal(has(withNext, "production-ready"), false);
});

// --- 6. extractTargets (input do ghost-target no CLI) -----------------------

test("extractTargets: pega arquivos-alvo de linhas de trabalho", () => {
  const text = [
    `{ capability: 'ast_analysis', label: 'Analyse src/auth/middleware.ts' },`,
    `{ capability: 'pdf_parse', label: 'Extract clauses from NDA.pdf' },`,
    `{ capability: 'csv_query', label: 'Query customer_data.csv' },`,
  ].join("\n");
  const refs = extractTargets(text).map((t) => t.ref);
  assert.ok(refs.includes("src/auth/middleware.ts"));
  assert.ok(refs.includes("NDA.pdf"));
  assert.ok(refs.includes("customer_data.csv"));
});

test("extractTargets: ignora linha sem verbo de trabalho e ignora URL/glob", () => {
  const text = [
    `const banner = 'welcome.txt';`,            // sem verbo de trabalho → ignora
    `// load https://cdn.example/data.csv`,     // URL → ignora
    `process all "logs/*.json"`,                // glob → ignora
  ].join("\n");
  assert.equal(extractTargets(text).length, 0);
});

// --- regressão: o run.ts do investor-demo (estado teatral) deve acender vários

test("regressão: bloco teatral típico do investor-demo acende múltiplos checks", () => {
  const theatrical = [
    `function jitter(base, range = 10) { return base + Math.floor(Math.random() * range); }`,
    `const latency = jitter(38, 18); // latency ms`,
    `await sleep(latency + 20); // simulate real work`,
    `ledger.append({ result: 'success', durationMs: latency });`,
    `const p95 = Math.round(n.latencyMs * 1.4);`,
    `println('Batiste is production-ready');`,
  ].join("\n");
  const f = scanSource(theatrical, { file: "examples/investor-demo/run.ts" });
  for (const c of ["random-metric", "fake-work-sleep", "theater-success", "multiplier-metric", "production-ready"]) {
    assert.ok(has(f, c), `esperava check ${c}`);
  }
});

// --- limpo: demo honesto não acende nada ------------------------------------

test("demo honesto (trabalho real + métrica medida) passa limpo", () => {
  const honest = [
    `const t0 = performance.now();`,
    `const out = await runRealTask(fixturePath); // fixturePath é versionado`,
    `const durationMs = performance.now() - t0;`,
    `ledger.append({ result: out.ok ? 'success' : 'fail', durationMs });`,
    `const p95 = percentile(samples, 0.95);`,
  ].join("\n");
  const f = scanSource(honest);
  assert.equal(f.length, 0, JSON.stringify(f));
});
