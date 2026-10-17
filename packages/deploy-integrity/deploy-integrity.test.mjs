// Testes do guardião de deploy. O caso nº 1 reproduz o incidente de 2026-10-16 do Astrus:
// arquivos públicos prontos na árvore de trabalho e FORA do commit, produção servindo a versão anterior
// (arquivo ausente → o Pages devolve 200 text/html com a página inicial).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { diffTrees, hashTree, pre, post, status, referenciasQuebradas, tipoPlausivel } from "./deploy-integrity.mjs";

const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
const write = (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };

// stage falso com a MESMA interface do tools/pages-stage/stage.mjs (<produto> --out <dir> [--from <commit>])
const FAKE_STAGE = `
import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { execSync } from "node:child_process";
const [produto, ...r] = process.argv.slice(2);
const out = r[r.indexOf("--out") + 1]; const from = r.includes("--from") ? r[r.indexOf("--from") + 1] : null;
let src = path.resolve(produto);
if (from) { const t = fs.mkdtempSync(path.join(os.tmpdir(), "fs-")); execSync("git archive " + from + " -- " + produto + " | tar -x -C " + t); src = path.join(t, produto); }
const base = path.join(out, produto); fs.mkdirSync(path.join(base, "public"), { recursive: true });
const cp = (a, b) => { for (const e of fs.readdirSync(a, { withFileTypes: true })) {
  if ([".DS_Store", ".deploy-integrity.json", "functions", "ignorado"].includes(e.name)) continue;
  const x = path.join(a, e.name), y = path.join(b, e.name);
  if (e.isDirectory()) { fs.mkdirSync(y, { recursive: true }); cp(x, y); } else fs.copyFileSync(x, y); } };
cp(src, path.join(base, "public"));
if (fs.existsSync(path.join(src, "functions"))) { fs.mkdirSync(path.join(base, "functions"), { recursive: true }); cp(path.join(src, "functions"), path.join(base, "functions")); }
fs.writeFileSync(path.join(out, ".deploy-dir"), base + "\\n");
`;

function repoFalso() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "di-repo-"));
  git(d, "init", "-q"); git(d, "config", "user.email", "t@t"); git(d, "config", "user.name", "t");
  write(path.join(d, "stage.mjs"), FAKE_STAGE);
  write(path.join(d, "products/demo/index.html"), `<!doctype html><html><body><h1>oi</h1></body></html>`);
  git(d, "add", "-A"); git(d, "commit", "-qm", "base");
  return { d, stage: path.join(d, "stage.mjs") };
}
const commit = (d, msg = "x") => { git(d, "add", "-A"); git(d, "commit", "-qm", msg); };

test("diffTrees separa só-no-testado, só-no-commit e alterados", () => {
  const a = new Map([["a", "1"], ["b", "2"], ["c", "3"]]), b = new Map([["a", "1"], ["b", "9"], ["d", "4"]]);
  const d = diffTrees(a, b);
  assert.deepEqual(d, { soNoTestado: ["c"], soNoCommit: ["d"], diferentes: ["b"] });
});

test("INCIDENTE: arquivos públicos prontos na árvore e fora do commit BLOQUEIAM o pre", () => {
  const { d, stage } = repoFalso();
  write(path.join(d, "products/demo/vinheta.js"), "console.log('vinheta')");
  write(path.join(d, "products/demo/assets/vinheta/pt.mp4"), "video");
  const falhas = pre(d, "products/demo", stage);
  const txt = falhas.join("\n");
  assert.match(txt, /testado ≠ publicado/);
  assert.match(txt, /só na árvore \(sem commit\): public\/vinheta\.js/);
  assert.match(txt, /public\/assets\/vinheta\/pt\.mp4/);
});

test("depois do commit o pre passa", () => {
  const { d, stage } = repoFalso();
  write(path.join(d, "products/demo/vinheta.js"), "console.log('vinheta')");
  commit(d);
  assert.deepEqual(pre(d, "products/demo", stage), []);
});

test("arquivo alterado e sem commit bloqueia", () => {
  const { d, stage } = repoFalso();
  write(path.join(d, "products/demo/index.html"), "<h1>mudou</h1>");
  assert.match(pre(d, "products/demo", stage).join("\n"), /alterado e sem commit:\s+public\/index\.html/);
});

test("arquivos ignorados pelo stage (qa, ignorado/) não bloqueiam", () => {
  const { d, stage } = repoFalso();
  write(path.join(d, "products/demo/ignorado/rascunho.txt"), "x");
  assert.deepEqual(pre(d, "products/demo", stage), []);
});

test("referência quebrada no que vai ao ar bloqueia", () => {
  const { d, stage } = repoFalso();
  write(path.join(d, "products/demo/index.html"), `<link rel="stylesheet" href="/vinheta.css?v=1"><script src="/vinheta.js"></script>`);
  commit(d);
  const txt = pre(d, "products/demo", stage).join("\n");
  assert.match(txt, /referência quebrada.*index\.html → \/vinheta\.css\?v=1/);
  assert.match(txt, /\/vinheta\.js/);
});

test("referências válidas: query, /api, externas, _redirects, página sem .html, relativas", () => {
  const { d, stage } = repoFalso();
  write(path.join(d, "products/demo/index.html"),
    `<link href="/s.css?v=2"><script src="https://cdn.exemplo.com/x.js"></script><a href="/app">app</a><a href="/sobre">s</a><img src="img/a.png"><script>fetch("/api/forecast")</script>`);
  write(path.join(d, "products/demo/s.css"), `body{background:url(/img/a.png)}`);
  write(path.join(d, "products/demo/img/a.png"), "png");
  write(path.join(d, "products/demo/sobre.html"), "<h1>sobre</h1>");
  write(path.join(d, "products/demo/app/index.html"), "<h1>app</h1>");
  write(path.join(d, "products/demo/_redirects"), "/antigo /app 301\n/* /index.html 200\n");
  commit(d);
  assert.deepEqual(pre(d, "products/demo", stage), []);
});

test("código JavaScript e fragmentos de SVG dentro do HTML/CSS não viram referência", () => {
  const pub = fs.mkdtempSync(path.join(os.tmpdir(), "di-pub-"));
  write(path.join(pub, "index.html"),
    `<a href="%23n"><img src="sereno.img"><script>x.src="url"; y.href="window.location.href"; z.src="res.blob";</script><svg><use href="#icone"/></svg>`);
  write(path.join(pub, "s.css"), `a{mask:url(%23n)} b{fill:url(#grad)}`);
  assert.deepEqual(referenciasQuebradas(pub), []);
  // mas arquivo de verdade ausente continua acusado, com ou sem barra
  write(path.join(pub, "index.html"), `<img src="logo.png"><script src="/x/y.js"></script>`);
  assert.equal(referenciasQuebradas(pub).length, 2);
});

test("_redirects com /* (fallback de SPA) não mascara referência quebrada", () => {
  const pub = fs.mkdtempSync(path.join(os.tmpdir(), "di-pub-"));
  write(path.join(pub, "index.html"), `<script src="/sumiu.js"></script>`);
  write(path.join(pub, "_redirects"), "/* /index.html 200\n");
  assert.equal(referenciasQuebradas(pub).length, 1);
});

test("ignoreRefs do produto silencia referência dinâmica conhecida", () => {
  const { d, stage } = repoFalso();
  write(path.join(d, "products/demo/index.html"), `<script src="/gerado/runtime.js"></script>`);
  write(path.join(d, "products/demo/.deploy-integrity.json"), JSON.stringify({ ignoreRefs: ["/gerado/*"] }));
  commit(d);
  assert.deepEqual(pre(d, "products/demo", stage), []);
});

test("tipoPlausivel: text/html para arquivo não-HTML = não subiu", () => {
  assert.equal(tipoPlausivel("js", "text/html; charset=utf-8"), false);
  assert.equal(tipoPlausivel("mp4", "text/html"), false);
  assert.equal(tipoPlausivel("css", "text/css; charset=utf-8"), true);
  assert.equal(tipoPlausivel("js", "application/javascript"), true);
  assert.equal(tipoPlausivel("mp4", "video/mp4"), true);
  assert.equal(tipoPlausivel("html", "text/html"), true);
  assert.equal(tipoPlausivel("html", "application/json"), false);
  // extensão sem regra própria: o text/html (fallback do Pages) continua reprovando
  assert.equal(tipoPlausivel("stl", "text/html; charset=utf-8"), false);
  assert.equal(tipoPlausivel("stl", "model/stl"), true);
  assert.equal(tipoPlausivel("zip", "application/zip"), true);
});

// servidor que imita o Cloudflare Pages: arquivo ausente → 200 com a página inicial
function servidor(arquivos, { corrompe = [] } = {}) {
  const s = http.createServer((req, res) => {
    const p = new URL(req.url, "http://x").pathname;
    const k = p === "/" ? "index.html" : p.slice(1);
    if (arquivos.has(k)) {
      const tipo = k.endsWith(".js") ? "application/javascript" : k.endsWith(".css") ? "text/css" : k.endsWith(".html") ? "text/html" : "application/octet-stream";
      res.writeHead(200, { "content-type": tipo }); res.end(corrompe.includes(k) ? "ADULTERADO" : arquivos.get(k));
    } else { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(arquivos.get("index.html")); }
  });
  return new Promise((ok) => s.listen(0, "127.0.0.1", () => ok({ s, host: `http://127.0.0.1:${s.address().port}` })));
}

test("post: produção sem o arquivo (fallback 200 text/html) BLOQUEIA; com tudo, passa", async () => {
  const { d, stage } = repoFalso();
  write(path.join(d, "products/demo/vinheta.js"), "console.log('v')");
  write(path.join(d, "products/demo/s.css"), "body{}");
  commit(d);
  const todos = new Map([["index.html", fs.readFileSync(path.join(d, "products/demo/index.html"))], ["vinheta.js", "console.log('v')"], ["s.css", "body{}"]]);

  const velho = new Map([["index.html", todos.get("index.html")], ["s.css", "body{}"]]);        // produção anterior: sem vinheta.js
  let { s, host } = await servidor(velho);
  let falhas = await post(d, "products/demo", host, stage); s.close();
  assert.match(falhas.join("\n"), /\/vinheta\.js: tipo "text\/html.*não está no ar/);

  ({ s, host } = await servidor(todos));
  falhas = await post(d, "products/demo", host, stage); s.close();
  assert.deepEqual(falhas, []);

  ({ s, host } = await servidor(todos, { corrompe: ["s.css"] }));
  falhas = await post(d, "products/demo", host, stage); s.close();
  assert.match(falhas.join("\n"), /\/s\.css: conteúdo no ar diferente/);
});

test("status: pronto-e-não-publicado acima do limite BLOQUEIA; recente só avisa; limpo passa", () => {
  const { d, stage } = repoFalso();
  const prod = [{ produto: "products/demo", projeto: "demo", host: "https://demo.cachola.tech" }];
  assert.match(status(d, stage, { produtos: prod }).linhas[0], /^✓ products\/demo/);

  const f = path.join(d, "products/demo/novo.js"); write(f, "x");
  let r = status(d, stage, { maxHoras: 24, produtos: prod });
  assert.match(r.linhas[0], /^⚠ products\/demo: 1 arquivo/); assert.equal(r.bloqueios.length, 0);

  const antes = new Date(Date.now() - 48 * 3.6e6); fs.utimesSync(f, antes, antes);
  r = status(d, stage, { maxHoras: 24, produtos: prod });
  assert.match(r.linhas[0], /^✗ products\/demo/); assert.equal(r.bloqueios.length, 1);
});

test("hashTree ignora .DS_Store e lista caminhos relativos", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "di-h-")); write(path.join(d, "a/b.txt"), "1"); write(path.join(d, ".DS_Store"), "x");
  assert.deepEqual([...hashTree(d).keys()], ["a/b.txt"]);
});
