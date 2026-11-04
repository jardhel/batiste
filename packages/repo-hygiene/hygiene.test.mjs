// Testes do CHECK 6 (unshipped — committed ≠ shipped).
// Built-ins only: node:test + node:assert (sem vitest, sem rede). Git/gh são
// mockados pela API pura evaluateUnshipped, que recebe o estado já coletado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawnSync } from "node:child_process";
import { evaluateUnshipped, evaluateUnshippedRegistro, tasklogFindings } from "./hygiene.mjs";

// --- cenários do gate -------------------------------------------------------

test("ahead>0 + sem PR → FAIL (error)", () => {
  const r = evaluateUnshipped({
    branch: "feat/metis",
    hasUpstream: true,
    aheadUpstream: 20,
    aheadOrigin: 20,
    prState: null,
    subjects: ["feat: a", "feat: b"],
  });
  assert.ok(r, "deve retornar finding");
  assert.equal(r.level, "error");
  assert.match(r.msg, /committed ≠ shipped/);
  assert.match(r.msg, /20 commit/);
  assert.match(r.msg, /feat: a/);
});

test("ahead>0 + PR aberto → PASS (null)", () => {
  const r = evaluateUnshipped({
    branch: "feat/metis",
    hasUpstream: true,
    aheadUpstream: 20,
    aheadOrigin: 20,
    prState: "OPEN",
    subjects: ["feat: a"],
  });
  assert.equal(r, null);
});

test("ahead=0 → PASS (null)", () => {
  const r = evaluateUnshipped({
    branch: "main",
    hasUpstream: true,
    aheadUpstream: 0,
    aheadOrigin: 0,
    prState: null,
  });
  assert.equal(r, null);
});

test("sem upstream + ahead de origin/main → FAIL (error)", () => {
  const r = evaluateUnshipped({
    branch: "feat/local-only",
    hasUpstream: false,
    aheadUpstream: 0,
    aheadOrigin: 7,
    prState: null,
    subjects: ["wip"],
  });
  assert.ok(r);
  assert.equal(r.level, "error");
  assert.match(r.msg, /sem upstream/);
  assert.match(r.msg, /7 commit/);
});

test("--allow-unshipped rebaixa ERRO → WARN", () => {
  const r = evaluateUnshipped({
    branch: "feat/metis",
    hasUpstream: true,
    aheadUpstream: 3,
    aheadOrigin: 3,
    prState: null,
    allowUnshipped: true,
  });
  assert.ok(r);
  assert.equal(r.level, "warn");
});

test("gh indisponível (prState=null) com ahead>0 → FAIL no threshold", () => {
  // best-effort: gh ausente/erro vira prState=null → não mascara o stranded.
  const r = evaluateUnshipped({
    branch: "feat/metis",
    hasUpstream: true,
    aheadUpstream: 5,
    aheadOrigin: 5,
    prState: null,
  });
  assert.ok(r);
  assert.equal(r.level, "error");
});

test("PR não-OPEN (ex.: MERGED/CLOSED) ainda conta como stranded se ahead>0", () => {
  const r = evaluateUnshipped({
    branch: "feat/metis",
    hasUpstream: true,
    aheadUpstream: 2,
    aheadOrigin: 2,
    prState: "MERGED",
  });
  assert.ok(r, "PR merged mas commits novos não-pushados ainda é stranded");
  assert.equal(r.level, "error");
});

// --- CHECK 4: resolução de asset declarado em brand.yaml ---------------------
import { brandAssetCandidates } from "./hygiene.mjs";

test("brandAssetCandidates inclui dir do yaml, dir pai (cwd da ferramenta) e raiz", () => {
  const c = brandAssetCandidates("/repo", "tools/docgen/brands/cachola.brand.yaml", "brands/cachola-symbol.svg");
  assert.deepEqual(c, [
    "/repo/tools/docgen/brands/brands/cachola-symbol.svg",
    "/repo/tools/docgen/brands/cachola-symbol.svg",
    "/repo/brands/cachola-symbol.svg",
  ]);
});

// --- CHECK 6 sem remote: registro de deploy -----------------------------------
test("registro de deploy: commits do produto depois do último deploy => ERRO (WARN com --allow-unshipped)", () => {
  const itens = [{ produto: "products/x", ultimoDeploy: "abc1234", commits: [{ sha: "d1", assunto: "feat: a" }, { sha: "d2", assunto: "fix: b" }] },
                 { produto: "products/y", ultimoDeploy: "fff0000", commits: [] }];
  const r = evaluateUnshippedRegistro({ itens });
  assert.equal(r.length, 1);
  assert.equal(r[0].level, "error");
  assert.match(r[0].msg, /products\/x: 2 commit\(s\) depois do último deploy registrado \(abc1234\)/);
  assert.match(r[0].msg, /sem origin\/main/);
  assert.match(r[0].msg, /deploy-product\.sh products\/x --stage/);
  assert.equal(evaluateUnshippedRegistro({ itens, allowUnshipped: true })[0].level, "warn");
  assert.deepEqual(evaluateUnshippedRegistro({ itens: [itens[1]] }), []);
});

// --- CHECK 7 TaskLog -----------------------------------------------------------
test("tasklogFindings: agrupa por regra, erro por padrão, warn-only rebaixa, falha de leitura é WARN visível", () => {
  const res = { erros: [
    { regra: "stale", taskId: "aaaaaaaa-1", label: "velha", detalhe: "pending sem update há 90 dias", sugestao: "archive" },
    { regra: "stale", taskId: "bbbbbbbb-2", label: "velha2", detalhe: "x", sugestao: "archive" },
    { regra: "running-orfa", taskId: "cccccccc-3", label: "zumbi", detalhe: "running", sugestao: "archive" }],
    avisos: [{ regra: "completed-sem-prova", detalhe: "89 concluídas" }] };
  const f = tasklogFindings(res);
  assert.deepEqual(f.map((x) => x.level), ["error", "error", "warn"]);
  assert.match(f[0].msg, /\[stale\] 2 tarefa/);
  assert.equal(tasklogFindings(res, { warnOnly: true })[0].level, "warn");
  const ill = tasklogFindings({ falhaLeitura: "batiste-direct não achado" });
  assert.equal(ill[0].level, "warn");
  assert.match(ill[0].msg, /NÃO rodou/);
  assert.deepEqual(tasklogFindings(null), []);
});

test("CLI: CHECK 7 derruba o fim de sessão (exit 1) com TaskLog parado; --no-tasklog e TaskLog limpo passam", () => {
  const dir = mkdtempSync(join(tmpdir(), "hy-"));
  const stubDir = mkdtempSync(join(tmpdir(), "hy-stub-"));
  const sh = (c) => execSync(c, { cwd: dir, stdio: "pipe" });
  sh("git init -q && git config user.email t@t && git config user.name t");
  writeFileSync(join(dir, "a.txt"), "x");
  writeFileSync(join(dir, ".hygiene.json"), JSON.stringify({ tasklog: { enabled: true, prove: false } }));
  sh("git add -A && git commit -qm base");
  const now = Math.floor(Date.now() / 1000);
  const stub = (tasks) => {
    const f = join(stubDir, "bd.mjs"); // fora do repo: senao vira "??" e o CHECK 1 (git-clean) reprova no Linux
    writeFileSync(f, `#!/usr/bin/env node\nconsole.log(JSON.stringify({tasks:${JSON.stringify(tasks)}}))\n`);
    chmodSync(f, 0o755);
    return f;
  };
  const gate = join(dirname(fileURLToPath(import.meta.url)), "hygiene.mjs");
  const run = (bd, ...a) => spawnSync(process.execPath, [gate, dir, ...a], { encoding: "utf8", env: { ...process.env, BATISTE_DIRECT: bd } });
  const velha = [{ id: "t1-aaaa", label: "parada", status: "pending", context: {}, createdAt: now - 90 * 86400, updatedAt: now - 90 * 86400 }];
  const r = run(stub(velha));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /\[tasklog\] \[stale\] 1 tarefa/);
  assert.equal(run(stub(velha), "--no-tasklog").status, 0);
  const limpa = [{ id: "t2-aaaa", label: "nova", status: "pending", context: {}, createdAt: now - 3600, updatedAt: now - 3600 }];
  assert.equal(run(stub(limpa)).status, 0);
  const sem = run("/nao/existe/batiste-direct");
  assert.match(sem.stdout, /TaskLog ilegível/);
});
