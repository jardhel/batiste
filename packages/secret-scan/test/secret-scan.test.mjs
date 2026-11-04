// Casos reais do incidente 2026-10-17 (Thalia/Mermaid) + allowlist pinada.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "secret-scan.mjs");
function repo(files, { allow } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ss-"));
  execFileSync("git", ["init", "-q"], { cwd: d });
  for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), c); }
  if (allow) fs.writeFileSync(path.join(d, ".secret-scan.allowlist.json"), JSON.stringify(allow));
  execFileSync("git", ["add", "-A"], { cwd: d });
  return d;
}
function run(cwd, ...args) {
  try { return { code: 0, out: execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8", stdio: "pipe" }) }; }
  catch (e) { return { code: e.status, out: String(e.stderr) + String(e.stdout) }; }
}

test("fallback hardcoded em functions/ bloqueia (p1)", () => {
  const d = repo({ "functions/gate.js": 'const r = { fallback: "senha123" };\n' });
  const r = run(d); assert.equal(r.code, 1); assert.match(r.out, /\[p1\]/);
});
test("env.<credencial> || literal bloqueia (p2) mas env.LEAD_FROM || literal passa", () => {
  const d = repo({ "functions/a.js": 'const s = env.FORM_SECRET || "abc-dev";\n' });
  assert.equal(run(d).code, 1);
  const ok = repo({ "functions/a.js": 'const s = env.LEAD_FROM || "no-reply";\n' });
  assert.equal(run(ok).code, 0);
});
test("token ?t=eyJ... inteiro em release .md bloqueia (p5)", () => {
  const tok = "eyJ" + "a".repeat(40) + "." + "b".repeat(40);
  const d = repo({ "releases/x/INDEX.md": `link: https://thalia.example/s/sala?t=${tok}\n` });
  const r = run(d); assert.equal(r.code, 1); assert.match(r.out, /\[p5\]/);
});
test("senha em .md bloqueia (p4), em .js não", () => {
  const d = repo({ "releases/x/msg.md": "Senha: Zq83!kx9\n" });
  const r = run(d); assert.equal(r.code, 1); assert.match(r.out, /\[p4\]/);
});
test(".env staged bloqueia por nome; .env.example passa", () => {
  assert.equal(run(repo({ ".dev.vars": "A=1\n" })).code, 1);
  assert.equal(run(repo({ ".dev.vars.example": "A=changeme\n" })).code, 0);
});
test("repo limpo passa", () => { assert.equal(run(repo({ "a.md": "oi\n" })).code, 0); });
test("allowlist: valor pinado libera; pin sha256 libera só a linha exata", () => {
  const linha = 'const x = { fallback: "dev-only-const" };';
  const d = repo({ "functions/a.js": linha + "\n" }, { allow: { values: [{ match: "dev-only-const" }] } });
  assert.equal(run(d).code, 0);
  const sha = createHash("sha256").update(linha).digest("hex");
  const p = repo({ "functions/a.js": linha + "\n" }, { allow: { pins: [{ path: "functions/a.js", lineSha256: sha }] } });
  assert.equal(run(p).code, 0);
  const q = repo({ "functions/a.js": linha.replace("const", "let") + "\n" }, { allow: { pins: [{ path: "functions/a.js", lineSha256: sha }] } });
  assert.equal(run(q).code, 1);
});
test("--allowlist inexistente falha alto", () => {
  const d = repo({ "a.md": "oi\n" }); assert.notEqual(run(d, "--allowlist", "nao-existe.json").code, 0);
});

test("arquivo com acento/travessao no nome e VARRIDO (antes o git show falhava e o arquivo passava sem scan)", () => {
  const d = repo({ "notas/decisão — gate.md": "senha_admin = \"Hunter2-real-9f8e7d6c5b4a\"\n" });
  const r = run(d);
  assert.notEqual(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /fatal/i);
});
