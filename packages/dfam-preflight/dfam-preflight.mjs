#!/usr/bin/env node
// @batiste-aidk/dfam-preflight — GATE de imprimibilidade. Roda em todo STL antes
// de virar pacote pro parceiro. Pega o que o Adam pegou na mão (2026-06-08): peça
// com features mergulhando abaixo do pé → fundo não-plano → exige suporte.
// Checa: fundo plano (min-Z coplanar) · overhang > limite · bounding box <= bed.
//
// uso: node dfam-preflight.mjs <arquivo.stl> [--bed 256x256x256] [--overhang 55] [--parts 1]
// Também reprova GEOMETRIA FLUTUANTE: o STL tem de ter exatamente --parts pedaços conectados (padrão 1; use 2 para
// um layout corpo+tampa lado a lado). Uma ilha solta (ex.: membrana "sacrificial" no ar, v3 do MAJU-1, 2026-10-16)
// não imprime e nenhum teste de ângulo a enxerga.
// sai !=0 (reprova) se: overhang acima do limite fora do fundo, ou não cabe no bed.
//
// NOVO (2026-10-17) · modos por camada, o que o fatiador verifica de verdade:
//   --overhang <arq.stl>... [--layer 0.2] [--max-overhang-deg 45] [--bridge-max 8] [--min-area 1] [--strict-bridge]
//              [--min-width 0.25] [--features f.json] [--dump pasta] [--json]
//        fatia em camadas, calcula a região SEM APOIO (camada menos a anterior expandida pelo avanço máximo) e a classifica em
//        PONTE (apoiada nos dois lados, vão <= bridge-max), PONTE LONGA (aviso; falha com --strict-bridge), BALANÇO e ILHA
//        (reprovam se >= min-area mm² numa camada). `--overhang 55` (com número) continua sendo o limite de ângulo do modo antigo.
//   --clash-from-closed <corpo.stl> <tampa.stl> [--min-gap 0.6] [--max-interference 0] [--features f.json] [--json]
//        corpo e tampa nas coordenadas de montagem: volume de interferência e folga vertical mínima da saia/pinos da tampa.
// Por que existe: o gate de ângulo + ilhas não sabe se um trecho tem apoio na camada de baixo (MAJU-1, caixa v3.2).
import { readFileSync } from "node:fs";

const _argv = process.argv.slice(2);
const _oi = _argv.indexOf("--overhang");
const _legacyOverhang = _oi >= 0 && /^[\d.]+$/.test(_argv[_oi + 1] ?? "");
if (_argv.includes("--clash-from-closed")) {
  const { mainClash } = await import("./clash.mjs");
  process.exit(await mainClash(_argv));
} else if (_oi >= 0 && !_legacyOverhang) {
  const { main } = await import("./overhang.mjs");
  process.exit(await main(_argv));
}
const file = process.argv[2];
const bedArg = (process.argv.includes("--bed") ? process.argv[process.argv.indexOf("--bed") + 1] : "256x256x256").split("x").map(Number);
const partsEsperadas = Number(process.argv.includes("--parts") ? process.argv[process.argv.indexOf("--parts") + 1] : 1);
const maxOverhang = Number(process.argv.includes("--overhang") ? process.argv[process.argv.indexOf("--overhang") + 1] : 55); // graus da vertical
if (!file) { console.error("uso: dfam-preflight <arquivo.stl>"); process.exit(2); }

const raw = readFileSync(file);
let minX = 1e9, minY = 1e9, minZ = 1e9, maxX = -1e9, maxY = -1e9, maxZ = -1e9;
const acc = (x, y, z) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); };
const tris = [];
const binN = raw.length >= 84 ? raw.readUInt32LE(80) : -1;
if (binN >= 0 && 84 + binN * 50 === raw.length) {
  // STL binário: 80b header + uint32 count + 50b/triângulo
  for (let i = 0; i < binN; i++) {
    const o = 84 + i * 50;
    const nx = raw.readFloatLE(o), ny = raw.readFloatLE(o + 4), nz = raw.readFloatLE(o + 8);
    const zs = [], vs = [];
    for (let k = 0; k < 3; k++) { const p = o + 12 + k * 12; const x = raw.readFloatLE(p), y = raw.readFloatLE(p + 4), z = raw.readFloatLE(p + 8); acc(x, y, z); zs.push(z); vs.push([x, y, z]); }
    const nl = Math.hypot(nx, ny, nz) || 1;
    tris.push({ nz: nz / nl, cz: (zs[0] + zs[1] + zs[2]) / 3, v: vs });
  }
} else {
  // STL ASCII (saída padrão do OpenSCAD)
  const txt = raw.toString("utf8");
  if (!/^\s*solid/.test(txt) || !/facet\s+normal/.test(txt)) { console.error("✗ não é STL válido (nem binário nem ASCII)"); process.exit(2); }
  const F = "([-\\d.eE+]+)";
  const re = new RegExp(`facet\\s+normal\\s+${F}\\s+${F}\\s+${F}[\\s\\S]*?vertex\\s+${F}\\s+${F}\\s+${F}\\s+vertex\\s+${F}\\s+${F}\\s+${F}\\s+vertex\\s+${F}\\s+${F}\\s+${F}`, "g");
  let m;
  while ((m = re.exec(txt))) {
    const nx = +m[1], ny = +m[2], nz = +m[3];
    const zs = [+m[6], +m[9], +m[12]];
    acc(+m[4], +m[5], +m[6]); acc(+m[7], +m[8], +m[9]); acc(+m[10], +m[11], +m[12]);
    const vs = [[+m[4], +m[5], +m[6]], [+m[7], +m[8], +m[9]], [+m[10], +m[11], +m[12]]];
    const nl = Math.hypot(nx, ny, nz) || 1;
    tris.push({ nz: nz / nl, cz: (zs[0] + zs[1] + zs[2]) / 3, v: vs });
  }
}
const n = tris.length;
if (!n) { console.error("✗ zero triângulos lidos"); process.exit(2); }
const eps = 0.05; // mm
const dim = [maxX - minX, maxY - minY, maxZ - minZ];

// 1) fundo plano: fração de triângulos no plano min-Z. Se a peça assenta plana,
//    muitos triângulos ficam em minZ. Se features mergulham (bug do Adam), poucos.
const atBottom = tris.filter((t) => t.cz <= minZ + eps).length;
const pctBottom = (atBottom / n) * 100;

// 2) overhang: facetas viradas pra baixo (nz<0), FORA do fundo, com ângulo da
//    vertical > limite. ângulo-da-vertical = 90 - acos(-nz). overhang se > maxOverhang.
let overhangs = 0, worst = 0;
for (const t of tris) {
  if (t.nz < -1e-3 && t.cz > minZ + 0.3) {
    const fromVertical = 90 - Math.acos(Math.min(1, -t.nz)) * 180 / Math.PI;
    if (fromVertical > maxOverhang) { overhangs++; worst = Math.max(worst, fromVertical); }
  }
}

// 3) bounding box <= bed
const fitsBed = dim[0] <= bedArg[0] && dim[1] <= bedArg[1] && dim[2] <= bedArg[2];

const fmt = (x) => x.toFixed(2);
console.log(`dfam-preflight · ${file.split("/").pop()}  (${n} triângulos)`);
console.log(`  bounding box : ${fmt(dim[0])} × ${fmt(dim[1])} × ${fmt(dim[2])} mm   (min-Z ${fmt(minZ)})`);
console.log(`  fundo no plano min-Z : ${fmt(pctBottom)}% dos triângulos`);
console.log(`  overhangs > ${maxOverhang}° (fora do fundo) : ${overhangs}${overhangs ? ` (pior ${fmt(worst)}°)` : ""}`);
console.log(`  cabe no bed ${bedArg.join("x")} : ${fitsBed ? "sim" : "NÃO"}`);

// 4) Adam-class: feature MERGULHANDO abaixo do fundo principal (gap em Z na base).
//    Foi o bug do dome: orelha/pilar em z=0 isolados do pé do corpo em z=3.
const band = 0.5;
const low = tris.filter((t) => t.cz <= minZ + band).length;
const nextBand = tris.filter((t) => t.cz > minZ + band && t.cz <= minZ + 3 * band).length;
const massAbove = tris.some((t) => t.cz > minZ + 3 * band);
const danglesBelow = low > 0 && nextBand === 0 && massAbove; // lowest facets isolados abaixo
console.log(`  gap em Z na base (feature abaixo do pé) : ${danglesBelow ? "SIM ✗" : "não"}`);

// 5) GEOMETRIA FLUTUANTE: pedaços desconectados (união de vértices, tolerância de 1 µm). Cada pedaço fora do
//    esperado é uma ilha: imprime no ar ou solta. Pega o que o teste de ângulo não vê.
const pai = new Map();
const chave = (v) => `${Math.round(v[0] * 1000)},${Math.round(v[1] * 1000)},${Math.round(v[2] * 1000)}`;
const raiz = (a) => { while (pai.get(a) !== a) { pai.set(a, pai.get(pai.get(a))); a = pai.get(a); } return a; };
for (const t of tris) {
  const ks = t.v.map(chave);
  for (const k of ks) if (!pai.has(k)) pai.set(k, k);
  for (let i = 1; i < 3; i++) pai.set(raiz(ks[i]), raiz(ks[0]));
}
const grupos = new Map();
for (const t of tris) { const r = raiz(chave(t.v[0])); (grupos.get(r) || grupos.set(r, []).get(r)).push(t); }
// volume com sinal de cada casca: sólido solto tem volume POSITIVO (normais para fora); cavidade interna fechada tem volume
// NEGATIVO (normais para dentro) e imprime normalmente, então não é ilha.
const volSinal = (ts) => ts.reduce((s, t) => { const [a, b, c] = t.v; return s + (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6; }, 0);
const todas = [...grupos.values()].sort((a, b) => b.length - a.length);
const pedacos = todas.filter((ts) => volSinal(ts) > 0);
const cavidades = todas.length - pedacos.length;
const bbox = (ts) => { const b = [1e9, -1e9, 1e9, -1e9, 1e9, -1e9]; for (const t of ts) for (const v of t.v) { b[0] = Math.min(b[0], v[0]); b[1] = Math.max(b[1], v[0]); b[2] = Math.min(b[2], v[1]); b[3] = Math.max(b[3], v[1]); b[4] = Math.min(b[4], v[2]); b[5] = Math.max(b[5], v[2]); } return b; };
console.log(`  pedaços conectados : ${pedacos.length} (esperado ${partsEsperadas})${cavidades ? ` · ${cavidades} cavidade(s) interna(s) fechada(s), ok` : ""}`);

let fail = false;
if (pedacos.length !== partsEsperadas) {
  for (const ts of pedacos.slice(partsEsperadas)) {
    const b = bbox(ts);
    console.log(`  ilha: ${ts.length} triângulos · x[${fmt(b[0])},${fmt(b[1])}] y[${fmt(b[2])},${fmt(b[3])}] z[${fmt(b[4])},${fmt(b[5])}]`);
  }
  console.log(`✗ REPROVA (geometria flutuante): ${pedacos.length} pedaços desconectados, esperado ${partsEsperadas}. Uma ilha sem ligação ao resto não imprime (fica no ar). Conecte-a à peça ou remova-a.`);
  fail = true;
}
if (danglesBelow) { console.log(`✗ REPROVA (Adam-class): há geometria mergulhando abaixo do fundo principal (gap em Z) → fundo não é plano → exige suporte. Suba os features pro nível do pé.`); fail = true; }
if (!fitsBed) { console.log("✗ REPROVA: maior que a mesa"); fail = true; }
if (overhangs > 0) console.log(`⚠ AVISO: ${overhangs} facetas viradas pra baixo > ${maxOverhang}° (pior ${fmt(worst)}°). INCLUI louvers/bridges curtas que imprimem sem suporte — o check ainda NÃO é bridge-aware; revisar visualmente. Não reprova sozinho.`);
if (pctBottom < 1) console.log("⚠ AVISO: quase nada toca o plano min-Z — confira se o fundo é realmente plano.");
if (!fail) console.log("✔ PASSA (sem gap na base, cabe no bed). Overhangs = revisão humana.");
process.exit(fail ? 1 : 0);
