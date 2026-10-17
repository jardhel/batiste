// dfam-preflight --overhang: verificação de imprimibilidade POR CAMADA, a que o fatiador faz.
// Para cada camada (padrão 0,2 mm) calcula a região SEM APOIO = camada atual menos a camada anterior expandida pelo
// avanço máximo (layer*tan(ângulo); 45° => 0,2 mm). Cada região é PONTE (apoiada em dois lados opostos, vão <= bridge-max)
// ou BALANÇO (um lado só, vão maior, ou ilha no ar). BALANÇO >= min-area mm² reprova.
// Por que existe: o gate de ângulo/ilhas (facetas viradas pra baixo, peças conectadas) não sabe se um trecho tem apoio
// na camada de baixo. Uma lâmina "sacrificial" presa por um lado passa nele e fica no ar na impressão (MAJU-1, 2026-10-17).
import { loadStl, bounds } from "./stl.mjs";
import { makeSlicer, dilate, components } from "./layers.mjs";
import { writePng } from "./png.mjs";
import { mkdirSync } from "node:fs";

const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

export function analyzeTris(tris, opts = {}) {
  const o = {
    layer: 0.2, px: 0.1, maxOverhangDeg: 45, tol: 0.05, bridgeMax: 8, minArea: 1.0,
    noisePx: 8, minWidth: 0.25, strictBridge: false, features: [], ...opts,
  };
  const t0 = Date.now();
  const sl = makeSlicer(tris, { layer: o.layer, px: o.px });
  const { W, H } = sl.grid;
  const g = sl.grid;
  const adv = o.layer * Math.tan((o.maxOverhangDeg * Math.PI) / 180); // mm por camada
  const R = (adv + o.tol) / o.px;
  const pxArea = o.px * o.px;

  const uf = []; // union-find de clusters 3D
  const find = (a) => { while (uf[a] !== a) { uf[a] = uf[uf[a]]; a = uf[a]; } return a; };
  const clusters = []; // por id inicial: { regions: [...] }
  let prevM = null, prevLab = new Int32Array(W * H).fill(-1);
  const sevRank = { FINO: -1, PONTE: 0, "PONTE LONGA": 1, BALANÇO: 2, ILHA: 3 };

  for (let i = 0; i < sl.nLayers; i++) {
    const M = sl.slice(i);
    const lab = new Int32Array(W * H).fill(-1);
    if (i > 0 && prevM) {
      const S = dilate(prevM, W, H, R);
      const U = new Uint8Array(W * H);
      for (let p = 0; p < W * H; p++) U[p] = M[p] && !S[p] ? 1 : 0;
      for (const idx of components(U, W, H)) {
        if (idx.length < o.noisePx) continue;
        const reg = classify(idx, S, M, g, W, H, o, pxArea);
        reg.z = sl.zOf(i); reg.layerIdx = i; 
        // liga a clusters da camada anterior (sobreposição com janela de 3 px)
        let cid = -1;
        const touching = new Set();
        for (const p of idx) {
          const r = (p / W) | 0, c = p - r * W;
          for (let dr = -3; dr <= 3; dr += 1) {
            const rr = r + dr; if (rr < 0 || rr >= H) continue;
            for (let dc = -3; dc <= 3; dc += 1) {
              const cc = c + dc; if (cc < 0 || cc >= W) continue;
              const l = prevLab[rr * W + cc]; if (l >= 0) touching.add(find(l));
            }
          }
        }
        if (touching.size) { const arr = [...touching]; cid = arr[0]; for (const a of arr) uf[find(a)] = find(cid); }
        else { cid = clusters.length; uf.push(cid); clusters.push({ regions: [] }); }
        cid = find(cid);
        clusters[cid].regions.push(reg);
        // marca (o id guardado pode ser fundido depois; find resolve)
        for (const p of idx) lab[p] = cid;
      }
    }
    prevM = M; prevLab = lab;
  }

  // agrega regiões por cluster raiz
  const groups = new Map();
  clusters.forEach((cl, id) => {
    const r = find(id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(...cl.regions);
  });
  const found = [];
  for (const regs of groups.values()) {
    let kind = "FINO"; let total = 0, maxA = 0, big = regs[0], span = 0, maxDepth = 0;
    let zlo = Infinity, zhi = -Infinity;
    for (const r of regs) {
      if (sevRank[r.kind] > sevRank[kind]) kind = r.kind;
      total += r.area; if (r.area > maxA) { maxA = r.area; big = r; }
      span = Math.max(span, r.span); maxDepth = Math.max(maxDepth, r.depth);
      zlo = Math.min(zlo, r.z); zhi = Math.max(zhi, r.z);
    }
    const f = { kind, zMin: +(zlo - o.layer / 2).toFixed(2), zMax: +(zhi + o.layer / 2).toFixed(2), layers: regs.length,
      x: +big.cx.toFixed(2), y: +big.cy.toFixed(2), z: +big.z.toFixed(2),
      areaMm2: +maxA.toFixed(2), totalMm2: +total.toFixed(2), spanMm: +span.toFixed(1), depthMm: +maxDepth.toFixed(2) };
    f.layerIdx = big.layerIdx;
    f.feature = nameFeature(f, o.features);
    f.fails = (kind === "BALANÇO" || kind === "ILHA" || (kind === "PONTE LONGA" && o.strictBridge)) && maxA >= o.minArea;
    found.push(f);
  }
  found.sort((a, b) => a.zMin - b.zMin);
  if (o.dumpDir) dumpMaps(sl, found, o, R);
  const fails = found.filter((f) => f.fails);
  const b = bounds(tris);
  return {
    params: { layer: o.layer, px: o.px, maxOverhangDeg: o.maxOverhangDeg, tolMm: o.tol, advanceMm: +adv.toFixed(3), bridgeMaxMm: o.bridgeMax, minAreaMm2: o.minArea, minWidthMm: o.minWidth },
    bbox: b.map((v) => +v.toFixed(2)), layers: sl.nLayers, seconds: +((Date.now() - t0) / 1000).toFixed(1),
    clusters: found, failing: fails.length,
    counts: { FINO: found.filter((f) => f.kind === "FINO").length, ILHA: found.filter((f) => f.kind === "ILHA").length, BALANÇO: found.filter((f) => f.kind === "BALANÇO").length,
      "PONTE LONGA": found.filter((f) => f.kind === "PONTE LONGA").length, PONTE: found.filter((f) => f.kind === "PONTE").length },
    pass: fails.length === 0,
  };
}

// Mapa PNG por falha: cinza = material da camada, azul = camada de baixo que não chega aqui, vermelho = sem apoio.
function dumpMaps(sl, found, o, R) {
  mkdirSync(o.dumpDir, { recursive: true });
  const { W, H } = sl.grid, g = sl.grid, half = 14, sc = 8;
  let n = 0;
  for (const f of found) {
    if (f.kind === "PONTE" || f.kind === "FINO" || f.layerIdx < 1 || n >= 60) continue;
    n++;
    const M = sl.slice(f.layerIdx), P = sl.slice(f.layerIdx - 1), S = dilate(P, W, H, R);
    const size = Math.round((2 * half) / o.px), c0 = Math.round((f.x - half - g.x0) / o.px), r0 = Math.round((f.y - half - g.y0) / o.px);
    const w = size * (sc / 10 | 0 || 1), step = Math.max(1, Math.round(sc * o.px));
    const out = Buffer.alloc(size * step * size * step * 3, 255);
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      const rr = r0 + r, cc = c0 + c; if (rr < 0 || cc < 0 || rr >= H || cc >= W) continue;
      const p = rr * W + cc;
      let col = [250, 250, 250];
      if (P[p] && !M[p]) col = [150, 190, 235];
      if (M[p]) col = S[p] ? [110, 110, 110] : [220, 40, 40];
      for (let a = 0; a < step; a++) for (let b = 0; b < step; b++) {
        const yy = (size - 1 - r) * step + a, xx = c * step + b; // y para cima
        out.set(col, (yy * size * step + xx) * 3);
      }
    }
    const name = `${String(n).padStart(2, "0")}_${f.kind.replace(/\s/g, "")}_z${f.z}_x${f.x}_y${f.y}.png`;
    writePng(`${o.dumpDir}/${name}`, size * step, size * step, out);
    f.map = name;
  }
}

function nameFeature(f, feats) {
  for (const ft of feats) {
    if (ft.z && (f.zMax < ft.z[0] || f.zMin > ft.z[1])) continue;
    if (ft.box && (f.x < ft.box[0] || f.x > ft.box[2] || f.y < ft.box[1] || f.y > ft.box[3])) continue;
    return ft.name;
  }
  return "";
}

function classify(idx, S, M, g, W, H, o, pxArea) {
  const inReg = new Uint8Array(W * H);
  let sx = 0, sy = 0;
  for (const p of idx) { inReg[p] = 1; const r = (p / W) | 0; sy += r; sx += p - r * W; }
  const cx = g.cx(sx / idx.length), cy = g.cy(sy / idx.length);
  // contato com apoio: vizinhos (8) fora da região que pertencem a S
  let touchS = 0, edge = 0;
  for (const p of idx) {
    const r = (p / W) | 0, c = p - r * W;
    let border = false, s = false;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= H || cc >= W) continue;
      const q = rr * W + cc; if (!inReg[q]) { border = true; if (S[q] && M[q]) s = true; }
    }
    if (border) { edge++; if (s) touchS++; }
  }
  const area = idx.length * pxArea;
  const widthEff = (2 * area) / Math.max(edge * o.px, o.px);
  const base = { area, cx, cy, span: 0, depth: 0, widthEff };
  if (touchS === 0) return { ...base, kind: "ILHA" };
  if (widthEff < o.minWidth) return { ...base, span: widthEff, depth: widthEff, kind: "FINO" }; // borda fina: excesso < 1 largura de extrusão, ruído de arredondamento do fatiamento
  // melhor direção de ponte: fração da área em corridas com apoio nas DUAS pontas
  let best = { frac: 0, span: 0, len: Infinity };
  let maxRunAny = 0;
  for (const [dx, dy] of DIRS) {
    const step = Math.hypot(dx, dy) * o.px;
    let bridged = 0, spanB = 0;
    for (const p of idx) {
      const r = (p / W) | 0, c = p - r * W;
      const pr = r - dy, pc = c - dx;
      if (pr >= 0 && pc >= 0 && pr < H && pc < W && inReg[pr * W + pc]) continue; // não é começo de corrida
      let n = 0, rr = r, cc = c;
      while (rr >= 0 && cc >= 0 && rr < H && cc < W && inReg[rr * W + cc]) { n++; rr += dy; cc += dx; }
      const endIn = rr >= 0 && cc >= 0 && rr < H && cc < W && S[rr * W + cc] && M[rr * W + cc];
      const stIn = pr >= 0 && pc >= 0 && pr < H && pc < W && S[pr * W + pc] && M[pr * W + pc];
      maxRunAny = Math.max(maxRunAny, n * step);
      if (endIn && stIn) { bridged += n; spanB = Math.max(spanB, n * step); }
    }
    const frac = bridged / idx.length;
    if (frac > best.frac + 1e-9 || (Math.abs(frac - best.frac) < 1e-9 && spanB < best.span)) best = { frac, span: spanB };
  }
  if (best.frac >= 0.9) {
    return { ...base, span: best.span, depth: best.span / 2, kind: best.span <= o.bridgeMax ? "PONTE" : "PONTE LONGA" };
  }
  // BALANÇO: profundidade = maior corrida (largura do trecho em ar)
  const width = (2 * area) / Math.max(edge * o.px, o.px);
  return { ...base, span: width, depth: width, kind: "BALANÇO" };
}

export function formatReport(file, r) {
  const L = [];
  L.push(`dfam-preflight --overhang · ${file.split("/").pop()}`);
  L.push(`  fatias de ${r.params.layer} mm (${r.layers} camadas) · avanço máx ${r.params.advanceMm} mm/camada (${r.params.maxOverhangDeg}° + tol ${r.params.tolMm} mm) · pixel ${r.params.px} mm · ${r.seconds}s`);
  L.push(`  regiões sem apoio: ${r.counts.ILHA} ilha · ${r.counts.BALANÇO} balanço · ${r.counts["PONTE LONGA"]} ponte longa · ${r.counts.PONTE} ponte(s) aceita(s) (vão ≤ ${r.params.bridgeMaxMm} mm) · ${r.counts.FINO} borda(s) fina(s) < ${r.params.minWidthMm} mm (ruído de arredondamento, ignoradas)`);
  for (const f of r.clusters) {
    if (f.kind === "PONTE" || f.kind === "FINO") continue;
    L.push(`  ${f.fails ? "✗" : f.kind === "PONTE LONGA" ? "⚠" : "·"} ${f.kind.padEnd(8)} z ${f.zMin}–${f.zMax} (${f.layers} cam.) em (${f.x}, ${f.y}) · área ${f.areaMm2} mm² (total ${f.totalMm2}) · vão/prof ${f.spanMm} mm${f.feature ? " · " + f.feature : ""}`);
  }
  for (const f of r.clusters) if (f.kind === "PONTE") L.push(`  ✓ PONTE    z ${f.zMin}–${f.zMax} em (${f.x}, ${f.y}) · área ${f.areaMm2} mm² · vão ${f.spanMm} mm${f.feature ? " · " + f.feature : ""}`);
  const longas = r.clusters.filter((f) => f.kind === "PONTE LONGA" && !f.fails);
  const aviso = longas.length ? ` AVISO: ${longas.length} ponte(s) longa(s) (maior vão ${Math.max(...longas.map((f) => f.spanMm))} mm > ${r.params.bridgeMaxMm} mm) dependem do fatiador/ventilador; --strict-bridge reprova por elas.` : "";
  L.push(r.pass ? `✔ PASSA: 0 balanços ≥ ${r.params.minAreaMm2} mm² por camada, 0 ilhas.${aviso}` : `✗ REPROVA: ${r.failing} balanço(s)/ilha(s) com ≥ ${r.params.minAreaMm2} mm² numa camada, sem apoio na camada de baixo (o fatiador vai imprimir no ar).`);
  return L.join("\n");
}

export function parseArgs(argv, flag = "--overhang") {
  const get = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const file = argv.find((a, i) => !a.startsWith("--") && (i === 0 || !argv[i - 1].startsWith("--") || ["--json"].includes(argv[i - 1])));
  let features = [];
  const fj = get("--features", null);
  return { file, fj, opts: {
    layer: +get("--layer", 0.2), px: +get("--px", 0.1), maxOverhangDeg: +get("--max-overhang-deg", 45),
    tol: +get("--tol", 0.05), bridgeMax: +get("--bridge-max", 8), minArea: +get("--min-area", 1.0), features, dumpDir: get("--dump", null), strictBridge: argv.includes("--strict-bridge"), minWidth: +get("--min-width", 0.25),
  }, json: argv.includes("--json") };
}

export async function main(argv) {
  const { readFileSync } = await import("node:fs");
  const files = argv.filter((a, i) => /\.stl$/i.test(a));
  if (!files.length) { console.error("uso: dfam-preflight --overhang <arquivo.stl>... [--layer 0.2] [--max-overhang-deg 45] [--bridge-max 8] [--min-area 1] [--features f.json] [--json]"); return 2; }
  const p = parseArgs(argv);
  if (p.fj) { const j = JSON.parse(readFileSync(p.fj, "utf8")); p.opts.features = Array.isArray(j) ? j : j.overhang ?? []; }
  let code = 0; const all = {};
  for (const f of files) {
    const r = analyzeTris(loadStl(f), p.opts);
    all[f] = r;
    if (!p.json) console.log(formatReport(f, r) + "\n");
    if (!r.pass) code = 1;
  }
  if (p.json) console.log(JSON.stringify(files.length === 1 ? all[files[0]] : all, null, 2));
  return code;
}
