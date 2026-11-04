// Leitor de STL (binário ou ASCII) -> Float32Array com 9 floats por triângulo (x,y,z ×3).
import { readFileSync } from "node:fs";

export function loadStl(file) {
  const raw = readFileSync(file);
  const binN = raw.length >= 84 ? raw.readUInt32LE(80) : -1;
  if (binN >= 0 && 84 + binN * 50 === raw.length) {
    const out = new Float32Array(binN * 9);
    for (let i = 0; i < binN; i++) {
      const o = 84 + i * 50 + 12;
      for (let k = 0; k < 9; k++) out[i * 9 + k] = raw.readFloatLE(o + k * 4);
    }
    return out;
  }
  const txt = raw.toString("utf8");
  if (!/^\s*solid/.test(txt) || !/facet\s+normal/.test(txt)) throw new Error(`não é STL válido: ${file}`);
  const vals = [];
  const re = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
  let m;
  while ((m = re.exec(txt))) vals.push(+m[1], +m[2], +m[3]);
  if (vals.length % 9) throw new Error(`STL ASCII truncado: ${file}`);
  return Float32Array.from(vals);
}

export function bounds(tris) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) {
    for (let a = 0; a < 3; a++) { const v = tris[i + a]; if (v < b[a]) b[a] = v; if (v > b[a + 3]) b[a + 3] = v; }
  }
  return b; // [minX,minY,minZ,maxX,maxY,maxZ]
}
