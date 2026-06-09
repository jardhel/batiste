// Testes do CHECK 6 (unshipped — committed ≠ shipped).
// Built-ins only: node:test + node:assert (sem vitest, sem rede). Git/gh são
// mockados pela API pura evaluateUnshipped, que recebe o estado já coletado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateUnshipped } from "./hygiene.mjs";

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
