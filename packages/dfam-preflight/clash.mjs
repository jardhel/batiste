// dfam-preflight --clash-from-closed <corpo.stl> <tampa.stl>: encaixe na montagem FECHADA. As duas peças já vêm nas
// coordenadas de montagem (como o maju.scad as gera). Fatia as duas em camadas de 0,2 mm sobre a mesma grade e mede:
//  - volume de INTERFERÊNCIA (material dos dois no mesmo lugar) e onde (regiões xy);
//  - FOLGA VERTICAL por coluna onde a tampa tem algo acima da placa (saia, pinos, standoffs): do topo até o corpo acima;
//  - a folga vertical mínima por região de interferência/contato próximo.
// Exit 1 se interferência > --max-interference mm³ (padrão 0) ou folga vertical mínima < --min-gap mm (padrão 0,6).
import { loadStl, bounds } from "./stl.mjs";
import { makeSlicer, Grid, components } from "./layers.mjs";

export function analyzeClash(bodyTris, lidTris, opts = {}) {
  const o = { layer: 0.2, px: 0.1, minGap: 0.6, maxInterference: 0, features: [], ...opts };
  const bb = bounds(bodyTris), bl = bounds(lidTris);
  const ub = [Math.min(bb[0], bl[0]), Math.min(bb[1], bl[1]), Math.min(bb[2], bl[2]), Math.max(bb[3], bl[3]), Math.max(bb[4], bl[4]), Math.max(bb[5], bl[5])];
  const grid = new Grid(ub, o.px);
  const z0 = ub[2], zmax = ub[5];
  const sb = makeSlicer(bodyTris, { layer: o.layer, px: o.px, zmin: z0, zmax, grid });
  const sl = makeSlicer(lidTris, { layer: o.layer, px: o.px, zmin: z0, zmax, grid });
  const { W, H } = grid, N = W * H, n = sb.nLayers;
  const pxA = o.px * o.px;
  const inter = new Uint8Array(N); // colunas com interferência
  const interZ = new Float32Array(N).fill(Infinity);
  let vol = 0;
  const lidTop = new Int16Array(N).fill(-1);
  const bodyLayers = [], lidLayers = []; // máscaras (para a 2ª passada)
  for (let i = 0; i < n; i++) {
    const mb = sb.slice(i), ml = sl.slice(i);
    bodyLayers.push(mb); lidLayers.push(ml);
    for (let p = 0; p < N; p++) {
      if (ml[p]) lidTop[p] = i;
      if (mb[p] && ml[p]) { vol += pxA * o.layer; inter[p] = 1; if (interZ[p] > i) interZ[p] = i; }
    }
  }
  // folga vertical: por coluna com tampa, primeira camada de corpo ACIMA do topo da tampa
  // topo da placa = valor mais comum de lidTop (a face plana da tampa). Só contam colunas em que a tampa tem algo MAIS ALTO que a placa
  // (saia, pinos, standoffs): são essas que precisam de folga vertical até o corpo.
  const hist = new Map();
  for (let p = 0; p < N; p++) if (lidTop[p] >= 0) hist.set(lidTop[p], (hist.get(lidTop[p]) || 0) + 1);
  const plateTop = [...hist].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1;
  const gap = new Float32Array(N).fill(Infinity);
  for (let p = 0; p < N; p++) {
    const t = lidTop[p]; if (t <= plateTop || inter[p]) continue;
    for (let i = t + 1; i < n; i++) if (bodyLayers[i][p]) { gap[p] = (i - t - 1) * o.layer; break; }
  }
  const regions = [];
  for (const idx of components(inter, W, H)) {
    let sx = 0, sy = 0, zlo = Infinity;
    for (const p of idx) { const r = (p / W) | 0; sx += p - r * W; sy += r; zlo = Math.min(zlo, interZ[p]); }
    // volume da região
    regions.push({ x: +grid.cx(sx / idx.length).toFixed(2), y: +grid.cy(sy / idx.length).toFixed(2), areaMm2: +(idx.length * pxA).toFixed(2), zFrom: +(sb.zOf(zlo) - o.layer / 2).toFixed(2), px: idx });
  }
  // volume por região (reamostra: refaz contagem por camada só nos pixels da região)
  for (const r of regions) r.volMm3 = 0;
  const regOf = new Int32Array(N).fill(-1);
  regions.forEach((r, k) => { for (const p of r.px) regOf[p] = k; });
  const zrange = regions.map(() => [Infinity, -Infinity]);
  for (let i = 0; i < n; i++) {
    const ml = lidLayers[i], mb = bodyLayers[i];
    for (let p = 0; p < N; p++) if (regOf[p] >= 0 && mb[p] && ml[p]) {
      const k = regOf[p]; regions[k].volMm3 += pxA * o.layer;
      zrange[k][0] = Math.min(zrange[k][0], i); zrange[k][1] = Math.max(zrange[k][1], i);
    }
  }
  regions.forEach((r, k) => { r.volMm3 = +r.volMm3.toFixed(2); r.zMin = +(sb.zOf(zrange[k][0]) - o.layer / 2).toFixed(2); r.zMax = +(sb.zOf(zrange[k][1]) + o.layer / 2).toFixed(2); delete r.px; delete r.zFrom; r.feature = nameFeature(r, o.features); });
  regions.sort((a, b) => b.volMm3 - a.volMm3);
  // folga mínima > 0 (contato = 0 é encosto previsto) e onde
  let minGap = Infinity, gx = 0, gy = 0, contactPx = 0;
  for (let p = 0; p < N; p++) {
    if (gap[p] === Infinity) continue;
    if (gap[p] === 0) { contactPx++; continue; }
    if (gap[p] < minGap) { minGap = gap[p]; const r = (p / W) | 0; gx = grid.cx(p - r * W); gy = grid.cy(r); }
  }
  const out = {
    params: { layer: o.layer, px: o.px, minGapMm: o.minGap },
    interferenceMm3: +vol.toFixed(2), interferenceRegions: regions,
    minVerticalGapMm: minGap === Infinity ? null : +minGap.toFixed(2), minGapAt: minGap === Infinity ? null : [+gx.toFixed(2), +gy.toFixed(2)],
    contactAreaMm2: +(contactPx * pxA).toFixed(1),
  };
  out.pass = out.interferenceMm3 <= o.maxInterference && (out.minVerticalGapMm === null || out.minVerticalGapMm >= o.minGap);
  return out;
}

function nameFeature(f, feats) {
  for (const ft of feats) {
    if (ft.z && (f.zMax < ft.z[0] || f.zMin > ft.z[1])) continue;
    if (ft.box && (f.x < ft.box[0] || f.x > ft.box[2] || f.y < ft.box[1] || f.y > ft.box[3])) continue;
    return ft.name;
  }
  return "";
}

export function formatClash(bf, lf, r) {
  const L = [`dfam-preflight --clash-from-closed · corpo ${bf.split("/").pop()} + tampa ${lf.split("/").pop()}`];
  L.push(`  interferência corpo × tampa : ${r.interferenceMm3} mm³ em ${r.interferenceRegions.length} região(ões)`);
  for (const g of r.interferenceRegions.slice(0, 12)) L.push(`    ✗ ${g.volMm3} mm³ · área xy ${g.areaMm2} mm² · z ${g.zMin}–${g.zMax} · em (${g.x}, ${g.y})${g.feature ? " · " + g.feature : ""}`);
  L.push(`  folga vertical mínima (topo da saia/pinos/standoffs da tampa → corpo acima) : ${r.minVerticalGapMm === null ? "n/a" : r.minVerticalGapMm + " mm em (" + r.minGapAt.join(", ") + ")"} (exigido ≥ ${r.params.minGapMm} mm; encosto previsto de ${r.contactAreaMm2} mm² fora da conta)`);
  L.push(r.pass ? "✔ PASSA: interferência 0 e folga vertical suficiente." : "✗ REPROVA: a tampa não fecha (interferência > 0 ou folga vertical abaixo do mínimo).");
  return L.join("\n");
}

export async function mainClash(argv) {
  const { readFileSync } = await import("node:fs");
  const get = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const files = argv.filter((a) => /\.stl$/i.test(a));
  if (files.length !== 2) { console.error("uso: dfam-preflight --clash-from-closed <corpo.stl> <tampa.stl> [--min-gap 0.6] [--max-interference 0] [--features f.json] [--json]"); return 2; }
  const fj = get("--features", null);
  const feats = fj ? JSON.parse(readFileSync(fj, "utf8")).clash ?? [] : [];
  const r = analyzeClash(loadStl(files[0]), loadStl(files[1]), { minGap: +get("--min-gap", 0.6), maxInterference: +get("--max-interference", 0), features: feats });
  console.log(argv.includes("--json") ? JSON.stringify(r, null, 2) : formatClash(files[0], files[1], r));
  return r.pass ? 0 : 1;
}
