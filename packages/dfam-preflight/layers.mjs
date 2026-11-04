// Fatiamento em raster, como o fatiador faz: uma máscara binária por camada (pixel = px mm), preenchimento por
// número de enrolamento (nonzero), então cascas sobrepostas ou furos aninhados saem certos.
import { bounds } from "./stl.mjs";

export class Grid {
  constructor(b, px, margin = 2) {
    this.px = px;
    this.x0 = b[0] - margin; this.y0 = b[1] - margin;
    this.W = Math.ceil((b[3] - b[0] + 2 * margin) / px) + 1;
    this.H = Math.ceil((b[4] - b[1] + 2 * margin) / px) + 1;
  }
  cx(c) { return this.x0 + (c + 0.5) * this.px; }
  cy(r) { return this.y0 + (r + 0.5) * this.px; }
}

// Prepara os triângulos por camada. zmin = plano da mesa; a camada i é cortada em zmin + (i+0.5)*layer.
export function makeSlicer(tris, { layer = 0.2, px = 0.1, zmin = null, zmax = null, grid = null } = {}) {
  const b = bounds(tris);
  const z0 = zmin ?? b[2];
  const nLayers = Math.max(1, Math.ceil(((zmax ?? b[5]) - z0) / layer - 1e-9));
  const g = grid ?? new Grid(b, px);
  const nTri = tris.length / 9;
  const buckets = Array.from({ length: nLayers }, () => []);
  for (let t = 0; t < nTri; t++) {
    const o = t * 9;
    const za = tris[o + 2], zb = tris[o + 5], zc = tris[o + 8];
    const lo = Math.min(za, zb, zc), hi = Math.max(za, zb, zc);
    if (hi === lo) continue;
    let i0 = Math.ceil((lo - z0) / layer - 0.5), i1 = Math.floor((hi - z0) / layer - 0.5);
    if (i0 < 0) i0 = 0; if (i1 >= nLayers) i1 = nLayers - 1;
    for (let i = i0; i <= i1; i++) buckets[i].push(t);
  }
  const zOf = (i) => z0 + (i + 0.5) * layer;

  function slice(i) {
    const { W, H, px: p } = g;
    if (i < 0 || i >= nLayers) return new Uint8Array(W * H);
    const z = zOf(i) + 1e-5;
    const rows = new Array(H);
    for (const t of buckets[i]) {
      const o = t * 9;
      const P = [[tris[o], tris[o + 1], tris[o + 2]], [tris[o + 3], tris[o + 4], tris[o + 5]], [tris[o + 6], tris[o + 7], tris[o + 8]]];
      const pts = [];
      for (let e = 0; e < 3; e++) {
        const a = P[e], c = P[(e + 1) % 3];
        if ((a[2] < z) !== (c[2] < z)) {
          const u = (z - a[2]) / (c[2] - a[2]);
          pts.push([a[0] + u * (c[0] - a[0]), a[1] + u * (c[1] - a[1])]);
        }
      }
      if (pts.length !== 2) continue;
      // normal 2D do triângulo (x,y da normal) dá o sentido da fronteira
      const ux = P[1][0] - P[0][0], uy = P[1][1] - P[0][1], uz = P[1][2] - P[0][2];
      const vx = P[2][0] - P[0][0], vy = P[2][1] - P[0][1], vz = P[2][2] - P[0][2];
      const nx = uy * vz - uz * vy;
      if (nx === 0) continue;
      const sgn = nx < 0 ? 1 : -1; // normal para -x => entra no sólido ao andar +x
      let [xa, ya] = pts[0], [xb, yb] = pts[1];
      if (ya === yb) continue;
      if (ya > yb) { [xa, xb] = [xb, xa]; [ya, yb] = [yb, ya]; }
      let r0 = Math.ceil((ya - g.y0) / p - 0.5), r1 = Math.ceil((yb - g.y0) / p - 0.5) - 1;
      if (r0 < 0) r0 = 0; if (r1 >= H) r1 = H - 1;
      for (let r = r0; r <= r1; r++) {
        const yc = g.cy(r);
        const x = xa + ((yc - ya) / (yb - ya)) * (xb - xa);
        (rows[r] || (rows[r] = [])).push([x, sgn]);
      }
    }
    const m = new Uint8Array(W * H);
    for (let r = 0; r < H; r++) {
      const cr = rows[r];
      if (!cr) continue;
      cr.sort((a, b2) => a[0] - b2[0]);
      let w = 0;
      for (let k = 0; k < cr.length - 1; k++) {
        w += cr[k][1];
        if (w !== 0) {
          let c0 = Math.ceil((cr[k][0] - g.x0) / p - 0.5), c1 = Math.ceil((cr[k + 1][0] - g.x0) / p - 0.5) - 1;
          if (c0 < 0) c0 = 0; if (c1 >= W) c1 = W - 1;
          for (let c = c0; c <= c1; c++) m[r * W + c] = 1;
        }
      }
    }
    return m;
  }
  return { grid: g, nLayers, z0, layer, zOf, slice };
}

// Dilatação por disco de raio R (em pixels, real), exata por decomposição em linhas.
export function dilate(m, W, H, R) {
  const Ri = Math.floor(R);
  const hw = []; for (let dy = 0; dy <= Ri; dy++) hw[dy] = Math.floor(Math.sqrt(R * R - dy * dy) + 1e-9);
  const wset = [...new Set(hw)];
  const hd = new Map();
  for (const w of wset) {
    const out = new Uint8Array(W * H);
    for (let r = 0; r < H; r++) {
      const base = r * W;
      // soma de prefixo
      const pre = new Int32Array(W + 1);
      for (let c = 0; c < W; c++) pre[c + 1] = pre[c] + m[base + c];
      if (pre[W] === 0) continue;
      for (let c = 0; c < W; c++) {
        const a = c - w < 0 ? 0 : c - w, b = c + w + 1 > W ? W : c + w + 1;
        if (pre[b] - pre[a] > 0) out[base + c] = 1;
      }
    }
    hd.set(w, out);
  }
  const out = new Uint8Array(W * H);
  for (let dy = -Ri; dy <= Ri; dy++) {
    const src = hd.get(hw[Math.abs(dy)]);
    for (let r = 0; r < H; r++) {
      const rs = r + dy;
      if (rs < 0 || rs >= H) continue;
      const bo = r * W, bs = rs * W;
      for (let c = 0; c < W; c++) if (src[bs + c]) out[bo + c] = 1;
    }
  }
  return out;
}

// Componentes conexos (8-vizinhos) de uma máscara. Devolve [{px:[idx...], area, ...}]
export function components(m, W, H) {
  const seen = new Uint8Array(W * H);
  const comps = [];
  const stack = [];
  for (let s = 0; s < W * H; s++) {
    if (!m[s] || seen[s]) continue;
    const idx = [];
    stack.push(s); seen[s] = 1;
    while (stack.length) {
      const p = stack.pop(); idx.push(p);
      const r = (p / W) | 0, c = p - r * W;
      for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr; if (rr < 0 || rr >= H) continue;
        for (let dc = -1; dc <= 1; dc++) {
          const cc = c + dc; if (cc < 0 || cc >= W) continue;
          const q = rr * W + cc;
          if (m[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
        }
      }
    }
    comps.push(idx);
  }
  return comps;
}
