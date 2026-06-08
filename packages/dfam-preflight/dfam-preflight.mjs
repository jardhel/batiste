#!/usr/bin/env node
// @batiste-aidk/dfam-preflight — GATE de imprimibilidade. Roda em todo STL antes
// de virar pacote pro parceiro. Pega o que o Adam pegou na mão (2026-06-08): peça
// com features mergulhando abaixo do pé → fundo não-plano → exige suporte.
// Checa: fundo plano (min-Z coplanar) · overhang > limite · bounding box <= bed.
//
// uso: node dfam-preflight.mjs <arquivo.stl> [--bed 256x256x256] [--overhang 55]
// sai !=0 (reprova) se: overhang acima do limite fora do fundo, ou não cabe no bed.
import { readFileSync } from "node:fs";

const file = process.argv[2];
const bedArg = (process.argv.includes("--bed") ? process.argv[process.argv.indexOf("--bed") + 1] : "256x256x256").split("x").map(Number);
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
    const zs = [];
    for (let k = 0; k < 3; k++) { const p = o + 12 + k * 12; const x = raw.readFloatLE(p), y = raw.readFloatLE(p + 4), z = raw.readFloatLE(p + 8); acc(x, y, z); zs.push(z); }
    const nl = Math.hypot(nx, ny, nz) || 1;
    tris.push({ nz: nz / nl, cz: (zs[0] + zs[1] + zs[2]) / 3 });
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
    const nl = Math.hypot(nx, ny, nz) || 1;
    tris.push({ nz: nz / nl, cz: (zs[0] + zs[1] + zs[2]) / 3 });
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

let fail = false;
if (danglesBelow) { console.log(`✗ REPROVA (Adam-class): há geometria mergulhando abaixo do fundo principal (gap em Z) → fundo não é plano → exige suporte. Suba os features pro nível do pé.`); fail = true; }
if (!fitsBed) { console.log("✗ REPROVA: maior que a mesa"); fail = true; }
if (overhangs > 0) console.log(`⚠ AVISO: ${overhangs} facetas viradas pra baixo > ${maxOverhang}° (pior ${fmt(worst)}°). INCLUI louvers/bridges curtas que imprimem sem suporte — o check ainda NÃO é bridge-aware; revisar visualmente. Não reprova sozinho.`);
if (pctBottom < 1) console.log("⚠ AVISO: quase nada toca o plano min-Z — confira se o fundo é realmente plano.");
if (!fail) console.log("✔ PASSA (sem gap na base, cabe no bed). Overhangs = revisão humana.");
process.exit(fail ? 1 : 0);
