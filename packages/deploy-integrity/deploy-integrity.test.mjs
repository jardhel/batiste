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
import { resolverProduto, provaNoAr, diffTrees, hashTree, pre, post, status, normalizarHtml, htmlDinamico, referenciasQuebradas, tipoPlausivel, ultimoCommitDeploy, commitsSemDeploy, statusProd, classificarProva, semBlocoGerenciado, fetchComRetry } from "./deploy-integrity.mjs";

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

// ---- post confere o HTML servido (lacuna de 2026-10-17: batiste.cachola.tech com rodapé velho passou verde)
const HTML_NOVO = `<!doctype html><html><body><footer>Designed by Brazilian engineering</footer></body></html>\n`;
const HTML_VELHO = HTML_NOVO.replace("Designed by Brazilian engineering", "Made in Eindhoven");
function repoHtml(extra = {}) {
  const { d, stage } = repoFalso();
  write(path.join(d, "products/demo/index.html"), HTML_NOVO);
  write(path.join(d, "products/demo/sobre.html"), "<h1>sobre</h1>");
  for (const [k, v] of Object.entries(extra)) write(path.join(d, "products/demo", k), v);
  commit(d);
  return { d, stage };
}
const rodar = async (d, stage, arquivos) => { const { s, host } = await servidor(new Map(Object.entries(arquivos))); try { return await post(d, "products/demo", host, stage); } finally { s.close(); } };

test("post HTML: igual passa; defasado BARRA com mensagem clara (prova-que-reprova)", async () => {
  const { d, stage } = repoHtml();
  assert.deepEqual(await rodar(d, stage, { "index.html": HTML_NOVO, "sobre.html": "<h1>sobre</h1>" }), []);
  const f = await rodar(d, stage, { "index.html": HTML_VELHO, "sobre.html": "<h1>sobre</h1>" });
  assert.equal(f.length, 1);
  assert.match(f[0], /^HTML no ar difere do commit [0-9a-f]{8}: \/$/);
  const g = await rodar(d, stage, { "index.html": HTML_NOVO, "sobre.html": "<h1>sobre velho</h1>" });
  assert.match(g[0], /HTML no ar difere do commit [0-9a-f]{8}: \/sobre\.html/);
});

test("post HTML: injeções da Cloudflare, _di e espaço final são normalizados", async () => {
  const { d, stage } = repoHtml();
  const injetado = HTML_NOVO.replace("</body>",
    `<script defer src="https://static.cloudflareinsights.com/beacon.min.js/vabc" data-cf-beacon='{"token":"x"}'></script>` +
    `<script data-cfasync="false" src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"></script></body>`)+ "   \n\n";
  assert.deepEqual(await rodar(d, stage, { "index.html": injetado, "sobre.html": "<h1>sobre</h1>" }), []);
  assert.equal(normalizarHtml('<a href="/x?_di=123">a</a><a href="/y?v=1&_di=9&z=2">b</a>'), '<a href="/x">a</a><a href="/y?v=1&z=2">b</a>');
  // bot-challenge inline e e-mail ofuscado pela borda (achados em prod 2026-10-17)
  assert.equal(normalizarHtml(`<p>oi</p><script>(function(){window.__CF$cv$params={r:'a',t:'b'};var a=document.createElement('script');a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';})();</script>`), "<p>oi</p>");
  assert.equal(normalizarHtml('<b><a href="mailto:help@cachola.tech">help@cachola.tech</a></b>'),
    normalizarHtml('<b><a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="ab">[email&#160;protected]</a></b>'));
  assert.equal(normalizarHtml("a \r\nb\t\n\n"), "a\nb");
  assert.notEqual(normalizarHtml(HTML_VELHO), normalizarHtml(HTML_NOVO));
});

test("post HTML: rota gated não entra; htmlDynamic é opt-out por prefixo/arquivo", async () => {
  const { d, stage } = repoHtml({ "salas/a/index.html": "<h1>sala</h1>", "app/index.html": "<h1>app</h1>" });
  write(path.join(d, "products/demo/.deploy-integrity.json"), JSON.stringify({ gatedPrefixes: ["salas/"], htmlDynamic: ["app/"] })); commit(d, "cfg");
  const base = { "index.html": HTML_NOVO, "sobre.html": "<h1>sobre</h1>", "app/index.html": "<h1>app RUNTIME</h1>" };
  const f = await rodar(d, stage, { ...base, "salas/a/index.html": "<h1>sala</h1>" });
  assert.equal(f.length, 1); assert.match(f[0], /gated respondeu HTTP 200/);
  write(path.join(d, "products/demo/.deploy-integrity.json"), JSON.stringify({ gatedPrefixes: ["salas/"] })); commit(d, "cfg2");
  const g = await rodar(d, stage, { ...base, "salas/a/index.html": "<h1>sala</h1>" });
  assert.ok(g.some((x) => /HTML no ar difere.*\/app/.test(x)));
  assert.equal(htmlDinamico(["app/"], "app/x/index.html"), true);
  assert.equal(htmlDinamico(["/app/*"], "app/index.html"), true);
  assert.equal(htmlDinamico(["index.html"], "index.html"), true);
  assert.equal(htmlDinamico(["app/"], "apple/index.html"), false);
});

// ------------------------------------------------------------------------------------ resolve + prova-no-ar
const LINHA = (host, proj, prod) => `| ${host} | \`${proj}\` | \`${prod}/\` | nenhum | - | - |\n`;
const CAB = "| Domínio | Projeto Pages | Fonte git | Build | Bindings | Prova |\n|---|---|---|---|---|---|\n";
function comRegistro(linhas) {
  const r = repoFalso();
  write(path.join(r.d, "DEPLOYMENTS.md"), CAB + linhas);
  commit(r.d, "deployments");
  return r;
}

test("resolverProduto: registrado resolve projeto e host; sem flags não adivinha", () => {
  const { d } = comRegistro(LINHA("demo.cachola.tech", "demo-pages", "products/demo"));
  assert.deepEqual(resolverProduto(d, "products/demo/"), { produto: "products/demo", projeto: "demo-pages", host: "https://demo.cachola.tech" });
});
test("resolverProduto: produto inexistente FALHA ALTO listando os registrados", () => {
  const { d } = comRegistro(LINHA("demo.cachola.tech", "demo-pages", "products/demo"));
  assert.throws(() => resolverProduto(d, "products/nao-existe"), /NÃO está registrado.*products\/demo/s);
});
test("resolverProduto: dois projetos ou dois hosts para o mesmo produto = ambíguo, falha alto", () => {
  const { d } = comRegistro(LINHA("a.cachola.tech", "proj-a", "products/demo") + LINHA("b.cachola.tech", "proj-b", "products/demo"));
  assert.throws(() => resolverProduto(d, "products/demo"), /AMBÍGUO.*proj-a.*proj-b/s);
  const r2 = comRegistro(LINHA("a.cachola.tech", "proj-a", "products/demo") + LINHA("b.cachola.tech", "proj-a", "products/demo"));
  assert.throws(() => resolverProduto(r2.d, "products/demo"), /AMBÍGUO/);
});

test("prova-no-ar: 200 + tipo + corpo igual ao commit passa; defasado, 404 e fallback 200 text/html reprovam", async () => {
  const { d, stage } = repoHtml({ "app.js": "console.log(1)" });
  write(path.join(d, "DEPLOYMENTS.md"), CAB + LINHA("demo.cachola.tech", "demo-pages", "products/demo")); commit(d, "reg");
  const bom = new Map([["index.html", HTML_NOVO], ["sobre.html", "<h1>sobre</h1>"], ["app.js", "console.log(1)"]]);
  let { s, host } = await servidor(bom);
  try {
    assert.deepEqual((await provaNoAr(d, `${host}/`, { produto: "products/demo", stageTool: stage })).falhas, []);
    assert.deepEqual((await provaNoAr(d, `${host}/sobre.html`, { produto: "products/demo", stageTool: stage })).falhas, []);
    assert.deepEqual((await provaNoAr(d, `${host}/app.js`, { produto: "products/demo", stageTool: stage })).falhas, []);
  } finally { s.close(); }

  ({ s, host } = await servidor(new Map([["index.html", HTML_VELHO], ["sobre.html", "<h1>sobre</h1>"]])));   // produção defasada e sem app.js
  try {
    assert.match((await provaNoAr(d, `${host}/`, { produto: "products/demo", stageTool: stage })).falhas[0], /^HTML no ar difere do commit [0-9a-f]{8}/);
    assert.match((await provaNoAr(d, `${host}/app.js`, { produto: "products/demo", stageTool: stage })).falhas[0], /text\/html.*não está no ar/);
    assert.match((await provaNoAr(d, `${host}/nao-existe`, { produto: "products/demo", stageTool: stage })).falhas[0], /não existe no stage/);
  } finally { s.close(); }

  ({ s, host } = await servidor(bom, { corrompe: ["app.js"] }));
  try { assert.match((await provaNoAr(d, `${host}/app.js`, { produto: "products/demo", stageTool: stage })).falhas[0], /sha256 não bate/); } finally { s.close(); }
});
test("prova-no-ar: status diferente de 200 reprova", async () => {
  const { d, stage } = repoHtml();
  write(path.join(d, "DEPLOYMENTS.md"), CAB + LINHA("demo.cachola.tech", "demo-pages", "products/demo")); commit(d, "reg");
  const s = http.createServer((q, r) => { r.writeHead(503, { "content-type": "text/html" }); r.end("x"); });
  await new Promise((ok) => s.listen(0, "127.0.0.1", ok));
  try { assert.match((await provaNoAr(d, `http://127.0.0.1:${s.address().port}/`, { produto: "products/demo", stageTool: stage })).falhas[0], /HTTP 503/); } finally { s.close(); }
});

// ------------------------------------------------------------------------------------ status --prod (buraco de 26/10)
const comDeploy = (extra = "") => {
  const r = repoFalso();
  const base = git(r.d, "rev-parse", "--short", "HEAD");
  write(path.join(r.d, "DEPLOYMENTS.md"), CAB + `| demo.cachola.tech | \`demo-pages\` | \`products/demo/\` | nenhum | - | Deploy 01/11: commit \`${base}\` ${extra}|\n`);
  commit(r.d, "deployments");
  return { ...r, base };
};

test("ultimoCommitDeploy: lê o primeiro commit da linha do produto; sha inexistente ou sem registro = null", () => {
  const { d, base } = comDeploy();
  assert.equal(ultimoCommitDeploy(d, "products/demo"), base);
  assert.equal(ultimoCommitDeploy(d, "products/outro"), null);
  write(path.join(d, "DEPLOYMENTS.md"), CAB + "| demo.cachola.tech | `demo-pages` | `products/demo/` | nenhum | - | commit `deadbeef` |\n");
  assert.equal(ultimoCommitDeploy(d, "products/demo"), null);
});

test("commitsSemDeploy: só commits que tocam o produto depois do deploy registrado", () => {
  const { d, base } = comDeploy();
  assert.deepEqual(commitsSemDeploy(d, "products/demo", base), []);
  write(path.join(d, "products/demo/novo.js"), "1"); commit(d, "feat demo novo");
  write(path.join(d, "outra-coisa.txt"), "1"); commit(d, "nao toca o produto");
  const r = commitsSemDeploy(d, "products/demo", base);
  assert.equal(r.length, 1); assert.match(r[0].assunto, /feat demo novo/);
  assert.equal(commitsSemDeploy(d, "products/demo", null), null);
});

test("classificarProva: diverge x sem-prova x ok", () => {
  assert.equal(classificarProva([]).tipo, "ok");
  assert.equal(classificarProva(["HTML no ar difere do commit abc: /"]).tipo, "diverge");
  assert.equal(classificarProva(["https://x/: HTTP 403 (esperado 200)"]).tipo, "sem-prova");
  assert.equal(classificarProva(["/: não existe no stage de products/x @ abc (nada a provar)"]).tipo, "sem-prova");
});

test("statusProd: ✓ só com prova; divergência BLOQUEIA; sem prova é pendência explícita, nunca ✓", async () => {
  const { d, stage } = comDeploy();
  const prod = [{ produto: "products/demo", projeto: "demo-pages", host: "https://demo.cachola.tech" }];
  const mk = (falhas) => async () => ({ falhas });
  let r = await statusProd(d, stage, { produtos: prod, provaFn: mk([]) });
  assert.match(r.linhas[0], /^✓ products\/demo: produção == HEAD/); assert.equal(r.bloqueios.length, 0);

  r = await statusProd(d, stage, { produtos: prod, provaFn: mk(["HTML no ar difere do commit abc: /"]) });
  assert.match(r.linhas[0], /^✗ products\/demo: PRODUÇÃO ≠ HEAD/); assert.equal(r.bloqueios.length, 1);

  r = await statusProd(d, stage, { produtos: prod, provaFn: mk(["https://demo.cachola.tech/: HTTP 403 (esperado 200)"]) });
  assert.match(r.linhas[0], /^\? products\/demo: sem prova/); assert.equal(r.bloqueios.length, 0); assert.equal(r.semProva.length, 1);

  r = await statusProd(d, stage, { produtos: prod, provaFn: async () => { throw new Error("rede caiu"); } });
  assert.match(r.linhas[0], /^\? .*rede caiu/);
});

test("statusProd: produção == HEAD mas commits do produto depois do deploy registrado = aviso; sem prova + commits = BLOQUEIA", async () => {
  const { d, stage } = comDeploy();
  write(path.join(d, "products/demo/novo.js"), "1"); commit(d, "feat demo novo");
  const prod = [{ produto: "products/demo", projeto: "demo-pages", host: "https://demo.cachola.tech" }];
  let r = await statusProd(d, stage, { produtos: prod, provaFn: async () => ({ falhas: [] }) });
  assert.match(r.linhas[0], /^⚠ .*registro do DEPLOYMENTS.md está atrás.*feat demo novo/);
  r = await statusProd(d, stage, { produtos: prod, provaFn: async () => ({ falhas: ["x: HTTP 403 (esperado 200)"] }) });
  assert.equal(r.bloqueios.length, 1);
});

test("statusProd: provaPath do produto (.deploy-integrity.json) define a rota provada", async () => {
  const { d, stage } = comDeploy();
  write(path.join(d, "products/demo/.deploy-integrity.json"), JSON.stringify({ provaPath: "/health.json" })); commit(d, "cfg");
  const prod = [{ produto: "products/demo", projeto: "demo-pages", host: "https://demo.cachola.tech" }];
  let visto;
  await statusProd(d, stage, { produtos: prod, provaFn: async (_r, url) => { visto = url; return { falhas: [] }; } });
  assert.equal(visto, "https://demo.cachola.tech/health.json");
});

test("ultimoCommitDeploy: vale o commit mais novo citado, qualquer que seja a ordem na linha (astrus novo-primeiro, afrodite antigo-primeiro)", () => {
  const { d, base } = comDeploy();
  write(path.join(d, "products/demo/a.js"), "1"); commit(d, "a");
  const novo = git(d, "rev-parse", "--short", "HEAD");
  write(path.join(d, "DEPLOYMENTS.md"), CAB + `| demo.cachola.tech | \`demo-pages\` | \`products/demo/\` | nenhum | - | Deploy 2: commit \`${novo}\` · Deploy 1: commit \`${base}\` |\n`);
  assert.equal(ultimoCommitDeploy(d, "products/demo"), novo);
  write(path.join(d, "DEPLOYMENTS.md"), CAB + `| demo.cachola.tech | \`demo-pages\` | \`products/demo/\` | nenhum | - | Deploy 1: commit \`${base}\` · Deploy 2: commit \`${novo}\` |\n`);
  assert.equal(ultimoCommitDeploy(d, "products/demo"), novo);
});

test("fetchComRetry: erro de rede passageiro e repetido; resposta HTTP nunca; esgotadas as tentativas, o erro sobe", async () => {
  let n = 0;
  const flaky = async () => { n++; if (n < 3) throw new Error("fetch failed"); return { status: 200 }; };
  assert.equal((await fetchComRetry(flaky, "x", {}, { esperaMs: 1 })).status, 200);
  assert.equal(n, 3);
  let m = 0;
  const http404 = async () => { m++; return { status: 404 }; };
  assert.equal((await fetchComRetry(http404, "x", {}, { esperaMs: 1 })).status, 404);
  assert.equal(m, 1, "404 e resposta, nao erro de rede: uma tentativa so");
  await assert.rejects(fetchComRetry(async () => { throw new Error("fetch failed"); }, "x", {}, { esperaMs: 1 }), /fetch failed/);
});

test("robots.txt: o bloco 'Cloudflare Managed content' (prefacio de licenca + BEGIN..END) sai antes de comparar; o trecho nosso segue conferido", () => {
  const nosso = "User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: https://x.test/sitemap.xml\n";
  const gerenciado = "# As a condition of accessing this website, you agree to abide by the following\n# content signals:\n\n\n# BEGIN Cloudflare Managed content\n\nUser-agent: *\nContent-Signal: search=yes,ai-train=no\nAllow: /\n\n# END Cloudflare Managed Content\n\n";
  assert.equal(semBlocoGerenciado(Buffer.from(gerenciado + nosso), "robots.txt").toString(), nosso);
  assert.equal(semBlocoGerenciado(Buffer.from(nosso), "robots.txt").toString(), nosso, "sem bloco: intacto");
  assert.notEqual(semBlocoGerenciado(Buffer.from(gerenciado + nosso.replace("/api/", "/")), "robots.txt").toString(), nosso, "nosso trecho adulterado continua detectavel");
  const outro = Buffer.from(gerenciado + nosso);
  assert.equal(semBlocoGerenciado(outro, "app.js"), outro, "so vale para robots.txt");
});

test("resolverProduto: o dominio RAIZ cachola.tech (landing da casa) tambem e registravel, nao so subdominios", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "di-apex-"));
  fs.writeFileSync(path.join(d, "DEPLOYMENTS.md"), "| host | projeto | produto |\n|---|---|---|\n| cachola.tech | `cacholatech` | `products/cacholatech/` (landing) |\n| astrus.cachola.tech | `astrus` | `products/astrus-front/` |\n");
  const r = resolverProduto(d, "products/cacholatech");
  assert.equal(r.projeto, "cacholatech");
  assert.equal(r.host, "https://cachola.tech");
  assert.equal(resolverProduto(d, "products/astrus-front").host, "https://astrus.cachola.tech");
});
