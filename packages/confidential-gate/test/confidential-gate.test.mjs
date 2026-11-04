// Casos do kit Hefesto (2026-10-18): senha da sala em papel impresso.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "confidential-gate.mjs");
const temPdftotext = !spawnSync("pdftotext", ["-v"]).error;
const opt = { skip: temPdftotext ? false : "pdftotext (poppler) ausente" };

/** PDF mínimo: uma página por item de `paginas` (cada item = lista de linhas). */
function pdf(paginas) {
  const objs = [];
  const n = paginas.length;
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${paginas.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${n} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  paginas.forEach((linhas, i) => {
    const stream = "BT /F1 14 Tf 40 760 Td 18 TL " + linhas.map((l) => `(${l.replace(/[()\\]/g, "")}) Tj T*`).join(" ") + " ET";
    objs[4 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
    objs[5 + i * 2] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = "%PDF-1.4\n"; const off = [];
  for (let i = 1; i < objs.length; i++) { off[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const x = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n` + off.slice(1).map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return out;
}
function caso(paginas, manifest) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "cg-"));
  const f = path.join(d, "peca.pdf");
  fs.writeFileSync(f, pdf(paginas), "latin1");
  if (manifest) fs.writeFileSync(`${f}.manifest.json`, JSON.stringify(manifest));
  const r = spawnSync("node", [CLI, f], { encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
}
const MARCA = "CONFIDENCIAL - USO INTERNO";
const MARCA_OK = "CONFIDENCIAL · USO INTERNO";

test("interno com marca d'água em todas as páginas passa", opt, () => {
  const r = caso([[MARCA_OK, "kit da reuniao"], [MARCA_OK, "pagina dois"]], { classificacao: "interna" });
  assert.equal(r.code, 0, r.out);
});
test("interno sem a marca em uma página reprova e diz qual", opt, () => {
  const r = caso([[MARCA_OK, "pagina um"], ["pagina dois sem marca"]], { classificacao: "interna" });
  assert.equal(r.code, 1); assert.match(r.out, /página\(s\) 2 de 2/);
});
test("credencial no texto sem declaração vira interno e exige a marca", opt, () => {
  const r = caso([["Senha da sala: Zq83!kx9m", "uso na reuniao"]]);
  assert.equal(r.code, 1); assert.match(r.out, /credencial: senha com valor/);
});
test("peça de cliente com credencial reprova", opt, () => {
  const r = caso([["Proposta", "Senha: Zq83!kx9m"]], { classificacao: "cliente" });
  assert.equal(r.code, 1); assert.match(r.out, /cliente com credencial/);
});
test("peça de cliente com token ?t= em URL reprova", opt, () => {
  const r = caso([["Acesse https://sala.example/s?t=abcdefghij1234567890"]], { classificacao: "cliente" });
  assert.equal(r.code, 1); assert.match(r.out, /token em URL/);
});
test("peça de cliente limpa passa; marca CONFIDENCIAL nela reprova; manifest sem campo reprova", opt, () => {
  assert.equal(caso([["Proposta comercial"]], { classificacao: "cliente" }).code, 0);
  assert.equal(caso([[MARCA_OK, "Proposta"]], { classificacao: "cliente" }).code, 1);
  assert.equal(caso([["x"]], { titulo: "sem campo" }).code, 1);
});
void execFileSync; void MARCA;
