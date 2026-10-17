// node --test packages/dfam-preflight/  — malhas sintéticas (pilhas de caixas) com resposta conhecida.
import test from "node:test";
import assert from "node:assert/strict";
import { analyzeTris } from "./overhang.mjs";
import { analyzeClash } from "./clash.mjs";

// caixa fechada (12 triângulos) -> array plano de floats
function box(x0, y0, z0, x1, y1, z1) {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const f = [[0, 3, 2], [0, 2, 1], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [2, 3, 7], [2, 7, 6], [1, 2, 6], [1, 6, 5], [3, 0, 4], [3, 4, 7]];
  return f.flatMap((t) => t.flatMap((i) => v[i]));
}
const mesh = (...boxes) => Float32Array.from(boxes.flat());
const L = 0.2;
// pilha de caixas, uma por camada: slab(i) devolve lista de [x0,y0,x1,y1] para a camada i
function stack(n, slab) {
  const out = [];
  for (let i = 0; i < n; i++) for (const r of slab(i)) out.push(box(r[0], r[1], i * L, r[2], r[3], (i + 1) * L));
  return mesh(...out);
}
const run = (t, o = {}) => analyzeTris(t, { layer: L, px: 0.1, ...o });

test("bloco maciço na mesa passa, sem regiões sem apoio", () => {
  const r = run(mesh(box(0, 0, 0, 20, 20, 10)));
  assert.equal(r.pass, true);
  assert.equal(r.clusters.filter((c) => c.kind !== "FINO").length, 0);
});

test("prateleira em balanço de 6 mm reprova (um lado só)", () => {
  const r = run(mesh(box(0, 0, 0, 10, 20, 12), box(10, 0, 6, 16, 20, 7)));
  assert.equal(r.pass, false);
  const f = r.clusters.find((c) => c.kind === "BALANÇO");
  assert.ok(f && f.fails && f.areaMm2 >= 100, JSON.stringify(f));
  assert.ok(Math.abs(f.z - 6.1) < 0.3);
});

test("retângulo preso por UM lado e no ar do outro (o 'sacrificial' da v3.1) reprova, mesmo conectado", () => {
  // bloco com um furo vazado; uma lâmina de 9 x 3,6 mm colada só na parede de trás, a 8 mm do chão da peça
  const parede = [box(0, 0, 0, 30, 4, 20), box(0, 4, 0, 4, 20, 20), box(26, 4, 0, 30, 20, 20), box(0, 16, 0, 30, 20, 20)];
  const lamina = box(10, 4, 8, 19, 7.6, 8.8);
  const r = run(mesh(...parede, lamina));
  assert.equal(r.pass, false);
  assert.ok(r.clusters.some((c) => c.fails && c.kind === "BALANÇO" && c.z > 7.9 && c.z < 8.9));
});

test("ilha solta no ar é ILHA e reprova", () => {
  const r = run(mesh(box(0, 0, 0, 20, 20, 10), box(5, 5, 14, 10, 10, 15)));
  assert.equal(r.pass, false);
  assert.ok(r.clusters.some((c) => c.kind === "ILHA" && c.fails));
});

test("ponte curta apoiada nos dois lados passa; ponte longa vira aviso e reprova só com strictBridge", () => {
  const ponte = (vao) => mesh(box(0, 0, 0, 6, 10, 10), box(6 + vao, 0, 0, 12 + vao, 10, 10), box(0, 0, 10, 12 + vao, 10, 10.6));
  const curta = run(ponte(5));
  assert.equal(curta.pass, true);
  assert.ok(curta.clusters.some((c) => c.kind === "PONTE" && Math.abs(c.spanMm - 5) < 0.6), JSON.stringify(curta.clusters));
  const longa = run(ponte(20));
  assert.equal(longa.pass, true);
  assert.ok(longa.clusters.some((c) => c.kind === "PONTE LONGA"));
  assert.equal(run(ponte(20), { strictBridge: true }).pass, false);
});

test("parede alargando 0,2 mm por camada (45°) passa; 0,45 mm por camada (~66° da vertical) reprova", () => {
  const cone = (adv) => stack(40, (i) => [[0, 0, 20 + i * adv, 20]]);
  assert.equal(run(cone(0.2)).pass, true);
  assert.equal(run(cone(0.45)).pass, false);
});

test("furo horizontal: círculo de 12,5 mm falha nas camadas de fecho; gota com ponta a 45° passa", () => {
  const r0 = 6.25, cz = 15, nL = 150;
  const parede = (halfAt) => stack(nL, (i) => {
    const z = (i + 0.5) * L, h = halfAt(z);
    if (h <= 0) return [[0, 0, 40, 10]];
    return [[0, 0, 20 - h, 10], [20 + h, 0, 40, 10]];
  });
  const circulo = (z) => { const d = z - cz; return Math.abs(d) < r0 ? Math.sqrt(r0 * r0 - d * d) : 0; };
  // gota: círculo + ponta a 45° até 1,25 r
  const gota = (z) => { const d = z - cz; const c = circulo(z); if (d <= 0) return c; const t = r0 * Math.SQRT2 - d; return d < 1.25 * r0 ? Math.max(c, t) : 0; };
  const rc = run(parede(circulo), { noisePx: 4 });
  const rg = run(parede(gota), { noisePx: 4 });
  assert.equal(rc.pass, false, "círculo deve reprovar: " + JSON.stringify(rc.clusters));
  assert.ok(rg.pass, "gota deve passar: " + JSON.stringify(rg.clusters.filter((c) => c.fails)));
});

test("interferência e folga vertical: pilar de 4x4 entrando 3 mm na saia, e saia 0,8 mm abaixo do corpo", () => {
  const corpo = mesh(box(0, 0, 3, 40, 40, 20), box(10, 10, 3, 14, 14, 18)); // placa de corpo + pilar
  const tampa = mesh(box(0, 0, 0, 40, 40, 3), box(12, 12, 3, 20, 20, 6)); // placa + saia que entra no pilar
  const r = analyzeClash(corpo, tampa, { layer: L, px: 0.1 });
  assert.ok(r.interferenceMm3 > 0, JSON.stringify(r));
  // sem sobreposição: saia a 0,8 mm do corpo
  const corpo2 = mesh(box(0, 0, 6.8, 40, 40, 20));
  const tampa2 = mesh(box(0, 0, 0, 40, 40, 3), box(12, 12, 3, 20, 20, 6));
  const r2 = analyzeClash(corpo2, tampa2, { layer: L, px: 0.1 });
  assert.equal(r2.interferenceMm3, 0);
  assert.ok(Math.abs(r2.minVerticalGapMm - 0.8) < 0.21, JSON.stringify(r2));
});
