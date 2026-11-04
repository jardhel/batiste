#!/usr/bin/env node
// @batiste-aidk/deploy-integrity — o guardião que faltava entre "testei" e "está no ar".
//
// Nasceu em 2026-10-16: a produção do Astrus ficou em versão anterior enquanto 61 arquivos
// verificados (cache de borda da previsão, média de 4 modelos, vinheta) esperavam, sem commit, na
// árvore de trabalho, e o site entrava no portal iG. O deploy-lineage já barrava deploy de árvore
// suja; ninguém barrava a ESPERA. Três portas:
//
//   status  sentinela de defasagem (rápido, local): quantos arquivos PÚBLICOS do produto mudaram na
//           árvore de trabalho e não estão no commit, e há quanto tempo. Com --live, também o que
//           está no ar versus o commit. Sai 1 se passar do limite (--max-age-hours, padrão 24).
//   status --prod  (padrão no SessionStart) para CADA produto registrado: prova a rota de prova (padrão "/", ou
//           provaPath em .deploy-integrity.json) contra o stage do HEAD e cruza o último commit de deploy do
//           DEPLOYMENTS.md com o HEAD (commits do produto sem deploy). ✓ só com produção == HEAD provado;
//           "? sem prova" quando não dá para provar (nunca ✓); ✗ quando produção ≠ HEAD ou há commits sem deploy.
//   pre     antes do deploy: o stage da árvore de trabalho TEM de ser idêntico ao stage do commit
//           (testado == publicado) e nenhum arquivo publicado pode referenciar arquivo ausente.
//   post    depois do deploy: cada arquivo do stage existe no ar, com o tipo de conteúdo certo
//           (o fallback do Pages devolve 200 text/html para arquivo que não subiu) e o mesmo sha256;
//           HTML é comparado normalizado (sem _di, beacon/e-mail-decode da Cloudflare, espaço final).
//
// uso:
//   node deploy-integrity.mjs status [--repo <raiz>] [--max-age-hours 24] [--prod [--strict] [--json] [--concurrency 4]]
//   node deploy-integrity.mjs pre  <products/x> [--repo <raiz>] [--stage-tool <stage.mjs>]
//   node deploy-integrity.mjs resolve <products/x>   # projeto<TAB>host pelo DEPLOYMENTS.md; 2 se não registrado/ambíguo
//   node deploy-integrity.mjs prova-no-ar <url> [--produto products/x] [--commit <sha>] [--work]  # imprime "NO AR" só se provado
//   node deploy-integrity.mjs post <products/x> --host https://x.cachola.tech [--repo <raiz>] [--stage-tool <stage.mjs>]
// Sai 0 (passa), 1 (BLOQUEIA) ou 2 (uso). Exceções de referência: .deploy-integrity.json do produto,
// {"ignoreRefs": ["/caminho", "/prefixo/*"]}.
// HTML (também a raiz) é conferido por sha256 do corpo normalizado; opt-out: {"htmlDynamic": ["app/", "x.html"]}.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sha = (b) => createHash("sha256").update(b).digest("hex");

// ------------------------------------------------------------------------------------ árvores
export function hashTree(dir) {
  const out = new Map();
  if (!fs.existsSync(dir)) return out;
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (e.name === ".DS_Store") continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.isFile()) out.set(r, sha(fs.readFileSync(path.join(dir, r))));
    }
  };
  walk("");
  return out;
}

/** Compara dois mapas {caminho→sha}. `a` = o que foi testado, `b` = o que vai subir. */
export function diffTrees(a, b) {
  const soNoTestado = [], soNoCommit = [], diferentes = [];
  for (const [k, v] of a) { if (!b.has(k)) soNoTestado.push(k); else if (b.get(k) !== v) diferentes.push(k); }
  for (const k of b.keys()) if (!a.has(k)) soNoCommit.push(k);
  return { soNoTestado: soNoTestado.sort(), soNoCommit: soNoCommit.sort(), diferentes: diferentes.sort() };
}
const vazio = (d) => !d.soNoTestado.length && !d.soNoCommit.length && !d.diferentes.length;

// ------------------------------------------------------------------------------------ stage
const STAGE_PADRAO = (repo) => path.join(repo, "tools", "pages-stage", "stage.mjs");

function montarStage(repo, produto, stageTool, { from } = {}) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "di-stage-"));
  fs.rmSync(out, { recursive: true, force: true });
  const args = [stageTool, produto, "--out", out];
  if (from) args.push("--from", from);
  const r = spawnSync("node", args, { cwd: repo, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`stage falhou (${args.join(" ")}):\n${r.stderr || r.stdout}`);
  const base = fs.readFileSync(path.join(out, ".deploy-dir"), "utf8").trim();
  return { out, base, pub: path.join(base, "public"), functions: path.join(base, "functions") };
}

function mapaDoStage(st) {
  const m = new Map();
  for (const [k, v] of hashTree(st.pub)) m.set(`public/${k}`, v);
  for (const [k, v] of hashTree(st.functions)) m.set(`functions/${k}`, v);
  return m;
}

// ------------------------------------------------------------------------------------ referências
const EXT_ESTATICA = "css|js|mjs|png|jpe?g|webp|gif|svg|mp4|webm|woff2?|json|ico|webmanifest|txt|xml|pdf|stl|mp3|wav|m4a|avif";
const RE_EXT_FIM = new RegExp(`\\.(?:${EXT_ESTATICA})$`, "i");
const RE_HTML = /\b(?:href|src|poster|data-src)\s*=\s*["']([^"']+)["']/gi;
const RE_CSS = /url\(\s*["']?([^)"']+?)["']?\s*\)/gi;
const RE_JS = new RegExp(`["'\`](\\/[A-Za-z0-9_@.\\-\\/]+\\.(?:${EXT_ESTATICA}))(?:\\?[^"'\`]*)?["'\`]`, "gi");

function regraRedirect(from) {
  const esc = from.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/:[A-Za-z_]+/g, "[^/]+");
  return new RegExp(`^${esc}$`);
}
function lerRedirects(pub) {
  const f = path.join(pub, "_redirects");
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split(/\s+/)[0]).filter((from) => from.startsWith("/") && from !== "/*").map(regraRedirect);
}
function ignorados(produtoDir) {
  try { return JSON.parse(fs.readFileSync(path.join(produtoDir, ".deploy-integrity.json"), "utf8")).ignoreRefs || []; } catch { return []; }
}

// Prefixos gated do produto (.deploy-integrity.json, chave gatedPrefixes): caminhos
// atrás de portão (ex.: salas Thalia) onde o 401/403 anônimo é a PROVA de que o
// gate está de pé — o hash não é conferível sem credencial, e um 200 anônimo ali
// seria o verdadeiro vazamento. Falso positivo descoberto no redeploy da Thalia
// de 2026-10-17 (incidente das senhas): o post listava todos os /salas/* como falha.
function gatedPrefixes(produtoDir) {
  try { return JSON.parse(fs.readFileSync(path.join(produtoDir, ".deploy-integrity.json"), "utf8")).gatedPrefixes || []; } catch { return []; }
}
// Opt-out por produto do confronto de HTML (.deploy-integrity.json, chave htmlDynamic):
// prefixos ("/app/*", "app/") ou arquivos ("index.html") cujo HTML é gerado em runtime.
function htmlDynamic(produtoDir) {
  try { return JSON.parse(fs.readFileSync(path.join(produtoDir, ".deploy-integrity.json"), "utf8")).htmlDynamic || []; } catch { return []; }
}
export function htmlDinamico(padroes, rel) {
  const r = rel.replace(/^\//, "");
  return padroes.some((p0) => {
    const p = String(p0).replace(/^\//, "");
    if (p.endsWith("/*")) return r.startsWith(p.slice(0, -1));
    if (p.endsWith("/")) return r.startsWith(p);
    return r === p || r.startsWith(`${p}/`);
  });
}

/** Normaliza HTML para comparar o servido com o do stage: tira injeções da Cloudflare, _di, espaço final. */
export function normalizarHtml(txt) {
  return String(txt)
    .replace(/\r\n/g, "\n")
    // Web Analytics / beacon injetado pela borda
    .replace(/<script\b[^>]*(?:static\.cloudflareinsights\.com|data-cf-beacon)[^>]*>\s*<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*>[^<]*cloudflareinsights[^<]*<\/script\s*>/gi, "")
    // script inline do bot-management/challenge (window.__CF$cv$params -> /cdn-cgi/challenge-platform)
    .replace(/<script\b[^>]*>(?:(?!<\/script)[\s\S])*__CF\$cv\$params(?:(?!<\/script)[\s\S])*<\/script\s*>/gi, "")
    // e-mail decode / challenge scripts de /cdn-cgi/
    .replace(/<script\b[^>]*\/cdn-cgi\/[^>]*>\s*<\/script\s*>/gi, "")
    // e-mail ofuscado pela borda volta a um marcador igual dos dois lados
    .replace(/<a\b[^>]*href=["']\/cdn-cgi\/l\/email-protection[^"']*["'][^>]*>[\s\S]*?<\/a\s*>/gi, "[email]")
    .replace(/<span\b[^>]*class=["']__cf_email__["'][^>]*>[\s\S]*?<\/span\s*>/gi, "[email]")
    .replace(/\/cdn-cgi\/l\/email-protection#[0-9a-f]+/gi, "[email]")
    // o lado do commit tem o e-mail em claro: mesmo marcador (âncora mailto inteira e e-mail solto)
    .replace(/<a\b[^>]*href=["']mailto:[^"']*["'][^>]*>[\s\S]*?<\/a\s*>/gi, "[email]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, "[email]")
    // cache-bust do próprio gate
    .replace(/([?&])_di=\d+&?/g, (m, c) => (m.endsWith("&") ? c : ""))
    .split("\n").map((l) => l.replace(/[ \t]+$/, "")).join("\n")
    .replace(/\s+$/, "");
}
export const hashHtml = (txt) => sha(normalizarHtml(txt));

const casa = (padrao, p) => (padrao.endsWith("/*") ? p.startsWith(padrao.slice(0, -1)) : p === padrao);

/** Referências locais (href/src/poster/url()/strings de caminho absoluto) que apontam para arquivo ausente. */
export function referenciasQuebradas(pub, { ignoreRefs = [] } = {}) {
  const redirects = lerRedirects(pub);
  const quebradas = [];
  const existe = (p) => {
    const abs = path.join(pub, p);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return true;
    if (fs.existsSync(path.join(abs, "index.html"))) return true;
    if (fs.existsSync(`${abs}.html`)) return true;
    return redirects.some((re) => re.test(p));
  };
  const arquivos = [...hashTree(pub).keys()].filter((r) => /\.(html|css|js|mjs)$/i.test(r));
  for (const rel of arquivos) {
    const txt = fs.readFileSync(path.join(pub, rel), "utf8");
    const ehHtml = /\.html$/i.test(rel), ehCss = /\.css$/i.test(rel);
    const brutas = [];
    if (ehHtml) for (const m of txt.matchAll(RE_HTML)) brutas.push(m[1]);
    if (ehHtml || ehCss) for (const m of txt.matchAll(RE_CSS)) brutas.push(m[1]);
    if (!ehCss) for (const m of txt.matchAll(RE_JS)) brutas.push(m[1]);
    for (const bruta of new Set(brutas)) {
      const ref = bruta.trim();
      if (!ref || /^(data:|https?:|\/\/|mailto:|tel:|javascript:|#|blob:)/i.test(ref)) continue;
      if (/[{}$]|\(|\)/.test(ref)) continue;                       // modelo/expressão, não é caminho
      const limpa = ref.split("#")[0].split("?")[0];
      if (!limpa || limpa.startsWith("%23")) continue;           // fragmento de SVG codificado (url(%23id))
      // só é caminho o que tem barra ou termina em extensão de arquivo conhecida; `url`, `res.blob`,
      // `window.location.href`, `sereno.img` são código JavaScript dentro do HTML, não arquivo
      if (!limpa.includes("/") && !RE_EXT_FIM.test(limpa)) continue;
      if (/^\/(api|cdn-cgi)\//.test(limpa)) continue;
      if (ignoreRefs.some((p) => casa(p, limpa))) continue;
      const alvo = limpa.startsWith("/") ? limpa : path.posix.normalize(path.posix.join(path.posix.dirname(`/${rel}`), limpa));
      if (!existe(alvo)) quebradas.push({ em: rel, ref: bruta, alvo });
    }
  }
  return quebradas;
}

// ------------------------------------------------------------------------------------ tipo de conteúdo
const CT_ESPERADO = {
  js: /javascript|ecmascript/i, mjs: /javascript|ecmascript/i, css: /^text\/css/i, json: /json/i, webmanifest: /json|manifest/i,
  png: /^image\//i, jpg: /^image\//i, jpeg: /^image\//i, webp: /^image\//i, gif: /^image\//i, svg: /^image\//i, ico: /^image\/|icon/i, avif: /^image\//i,
  mp4: /^video\//i, webm: /^video\//i, mp3: /^audio\//i, wav: /^audio\//i, m4a: /^audio\//i,
  woff: /font|octet/i, woff2: /font|octet/i, txt: /^text\//i, xml: /xml/i, pdf: /pdf/i,
};
/** true se o tipo de conteúdo servido é plausível para a extensão. text/html para qualquer não-HTML = arquivo não subiu. */
export function tipoPlausivel(ext, contentType) {
  const ct = String(contentType || "");
  if (ext === "html") return /text\/html/i.test(ct);
  if (/^text\/html/i.test(ct)) return false;
  const re = CT_ESPERADO[ext];
  return re ? re.test(ct) : true;
}
const urlDe = (rel) => (rel === "index.html" ? "/" : rel.endsWith("/index.html") ? `/${rel.slice(0, -10)}` : `/${rel}`);

// ------------------------------------------------------------------------------------ comandos
function repoDe(args) { const i = args.indexOf("--repo"); return path.resolve(i >= 0 ? args[i + 1] : process.cwd()); }
function opt(args, nome) { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : undefined; }
function git(repo, ...a) { return execFileSync("git", a, { cwd: repo, encoding: "utf8" }).trim(); }
function gitHead(repo) { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(); }

export function pre(repo, produto, stageTool) {
  const falhas = [];
  const head = gitHead(repo);
  const work = montarStage(repo, produto, stageTool);
  const commit = montarStage(repo, produto, stageTool, { from: head });
  try {
    const d = diffTrees(mapaDoStage(work), mapaDoStage(commit));
    if (!vazio(d)) {
      falhas.push(`testado ≠ publicado: o que está na árvore de trabalho NÃO é o que o commit ${head.slice(0, 8)} publica.`);
      for (const k of d.soNoTestado) falhas.push(`  só na árvore (sem commit): ${k}`);
      for (const k of d.diferentes) falhas.push(`  alterado e sem commit:     ${k}`);
      for (const k of d.soNoCommit) falhas.push(`  só no commit (apagado na árvore): ${k}`);
      falhas.push("  → commite o que passou no teste (ou descarte), e rode de novo: o commit é a unidade testada e publicada.");
    }
    const quebradas = referenciasQuebradas(commit.pub, { ignoreRefs: ignorados(path.join(repo, produto)) });
    for (const q of quebradas) falhas.push(`referência quebrada no que vai ao ar: ${q.em} → ${q.ref}  (arquivo ausente: ${q.alvo})`);
  } finally {
    fs.rmSync(work.out, { recursive: true, force: true });
    fs.rmSync(commit.out, { recursive: true, force: true });
  }
  return falhas;
}

export async function post(repo, produto, host, stageTool, { fetchFn = fetch } = {}) {
  const falhas = [];
  const head = gitHead(repo);
  const st = montarStage(repo, produto, stageTool, { from: head });
  const gated = gatedPrefixes(path.join(repo, produto));
  const dinamicos = htmlDynamic(path.join(repo, produto));
  let gatedOk = 0;
  try {
    const stamp = Date.now();
    for (const [rel, hash] of hashTree(st.pub)) {
      if (/^_(headers|redirects|routes)/.test(rel) || rel === ".assetsignore") continue;
      const url = `${host.replace(/\/$/, "")}${urlDe(rel)}${urlDe(rel).includes("?") ? "&" : "?"}_di=${stamp}`;
      let r;
      try { r = await fetchFn(url, { redirect: "follow" }); } catch (e) { falhas.push(`${urlDe(rel)}: sem resposta (${e.message})`); continue; }
      const ext = (rel.split(".").pop() || "").toLowerCase();
      const ct = r.headers.get("content-type") || "";
      const atrasDoPortao = gated.some((p) => rel.startsWith(p));
      if (atrasDoPortao) {
        // gate de pé = 401/403 pro anônimo; 200 anônimo num caminho gated é falha de portão
        if (r.status === 401 || r.status === 403) { gatedOk++; continue; }
        falhas.push(`${urlDe(rel)}: caminho gated respondeu HTTP ${r.status} pro anônimo (portão caiu?)`);
        continue;
      }
      if (r.status !== 200) { falhas.push(`${urlDe(rel)}: HTTP ${r.status}`); continue; }
      if (!tipoPlausivel(ext, ct)) { falhas.push(`${urlDe(rel)}: tipo "${ct}" para .${ext} (o arquivo não está no ar: o Pages devolveu a página inicial no lugar)`); continue; }
      if (ext !== "html") {
        const corpo = Buffer.from(await r.arrayBuffer());
        if (sha(corpo) !== hash) falhas.push(`${urlDe(rel)}: conteúdo no ar diferente do commit ${head.slice(0, 8)} (sha256 não bate)`);
      } else if (!htmlDinamico(dinamicos, rel)) {
        const noAr = hashHtml(await r.text());
        const doCommit = hashHtml(fs.readFileSync(path.join(st.pub, rel), "utf8"));
        if (noAr !== doCommit) falhas.push(`HTML no ar difere do commit ${head.slice(0, 8)}: ${urlDe(rel)}`);
      }
    }
  } finally { fs.rmSync(st.out, { recursive: true, force: true }); }
  return falhas;
}

/** Lista produtos do DEPLOYMENTS.md: [{produto:"products/x", projeto, host}]. */
export function produtosRegistrados(repo) {
  const f = path.join(repo, "DEPLOYMENTS.md");
  if (!fs.existsSync(f)) return [];
  const out = [];
  for (const l of fs.readFileSync(f, "utf8").split("\n")) {
    if (!l.startsWith("|")) continue;
    const col = l.split("|").map((c) => c.trim());
    const host = (col[1] || "").match(/^[a-z0-9.-]+\.cachola\.tech$/i);
    const projeto = (col[2] || "").match(/^`([^`]+)`$/);
    const prod = (col[3] || "").match(/products\/[A-Za-z0-9._-]+/);
    if (host && projeto && prod) out.push({ produto: prod[0], projeto: projeto[1], host: `https://${host[0]}` });
  }
  return out;
}

/**
 * Resolve projeto Pages e host de um produto pelo DEPLOYMENTS.md. NUNCA adivinha:
 * produto não registrado ou com mais de um projeto/host => lança Error com mensagem clara.
 */
export function resolverProduto(repo, produto) {
  const alvo = produto.replace(/\/$/, "");
  const todos = produtosRegistrados(repo);
  const achados = todos.filter((p) => p.produto === alvo);
  if (!achados.length) {
    throw new Error(`produto "${alvo}" NÃO está registrado no DEPLOYMENTS.md (registrados: ${[...new Set(todos.map((p) => p.produto))].join(", ") || "nenhum"}). Registre-o ou passe --project-name e --host explícitos.`);
  }
  const projetos = [...new Set(achados.map((p) => p.projeto))], hosts = [...new Set(achados.map((p) => p.host))];
  if (projetos.length > 1 || hosts.length > 1) {
    throw new Error(`produto "${alvo}" é AMBÍGUO no DEPLOYMENTS.md (projetos: ${projetos.join(", ")}; hosts: ${hosts.join(", ")}). Passe --project-name e --host explícitos.`);
  }
  return { produto: alvo, projeto: projetos[0], host: hosts[0] };
}

/** Candidatos de arquivo do stage para o caminho de uma URL. */
function candidatosDoCaminho(pathname) {
  const p = decodeURIComponent(pathname);
  if (p === "/" || p === "") return ["index.html"];
  const sem = p.replace(/^\//, "");
  if (p.endsWith("/")) return [`${sem}index.html`];
  return [sem, `${sem}.html`, `${sem}/index.html`];
}

/**
 * Prova de "no ar" para UMA url: HTTP 200 E tipo de conteúdo plausível E corpo igual ao do stage do commit
 * (HTML normalizado; demais por sha256). Devolve { falhas, commit, arquivo }.
 */
export async function provaNoAr(repo, url, { produto, commit, work = false, stageTool, fetchFn = fetch } = {}) {
  const u = new URL(url);
  const reg = produto ? resolverProduto(repo, produto) : produtosRegistrados(repo).find((p) => new URL(p.host).origin === u.origin);
  if (!reg) throw new Error(`não achei o produto de ${u.origin} no DEPLOYMENTS.md; passe --produto products/<x>`);
  const prod = reg.produto;
  const ref = commit || gitHead(repo);
  const sha8 = (work ? "árvore de trabalho" : ref.slice(0, 8));
  const falhas = [];
  const st = montarStage(repo, prod, stageTool, work ? {} : { from: ref });
  let arquivo = null;
  try {
    const mapa = hashTree(st.pub);
    arquivo = candidatosDoCaminho(u.pathname).find((c) => mapa.has(c));
    if (!arquivo) { falhas.push(`${u.pathname}: não existe no stage de ${prod} @ ${sha8} (nada a provar: rota inexistente no que foi publicado)`); return { falhas, commit: ref, arquivo }; }
    if (gatedPrefixes(path.join(repo, prod)).some((g) => arquivo.startsWith(g))) { falhas.push(`${u.pathname}: caminho gated; a prova anônima não se aplica (o portão responde 401/403). Prove com sessão.`); return { falhas, commit: ref, arquivo }; }
    const ext = (arquivo.split(".").pop() || "").toLowerCase();
    if (ext === "html" && htmlDinamico(htmlDynamic(path.join(repo, prod)), arquivo)) { falhas.push(`${u.pathname}: HTML marcado como dinâmico (htmlDynamic) em .deploy-integrity.json; o corpo não é comparável`); return { falhas, commit: ref, arquivo }; }
    const alvo = new URL(u); alvo.searchParams.set("_di", String(Date.now()));
    let r;
    try { r = await fetchFn(alvo.href, { redirect: "follow" }); } catch (e) { falhas.push(`${u.href}: sem resposta (${e.message})`); return { falhas, commit: ref, arquivo }; }
    const ct = r.headers.get("content-type") || "";
    if (r.status !== 200) falhas.push(`${u.href}: HTTP ${r.status} (esperado 200)`);
    else if (!tipoPlausivel(ext, ct)) falhas.push(`${u.href}: content-type "${ct}" para .${ext} (o arquivo não está no ar: o Pages devolveu a página inicial no lugar)`);
    else if (ext === "html") {
      if (hashHtml(await r.text()) !== hashHtml(fs.readFileSync(path.join(st.pub, arquivo), "utf8"))) falhas.push(`HTML no ar difere do commit ${sha8}: ${u.pathname}`);
    } else if (sha(Buffer.from(await r.arrayBuffer())) !== mapa.get(arquivo)) falhas.push(`${u.pathname}: conteúdo no ar diferente do commit ${sha8} (sha256 não bate)`);
  } finally { fs.rmSync(st.out, { recursive: true, force: true }); }
  return { falhas, commit: ref, arquivo };
}

function idadeHoras(repo, produto, arquivos) {
  let maisAntigo = Infinity;
  for (const a of arquivos) {
    const f = path.join(repo, produto, a.replace(/^(public|functions)\//, ""));
    for (const cand of [f, path.join(repo, produto, a)]) { try { maisAntigo = Math.min(maisAntigo, fs.statSync(cand).mtimeMs); break; } catch { /* arquivo apagado */ } }
  }
  return Number.isFinite(maisAntigo) ? (Date.now() - maisAntigo) / 3.6e6 : 0;
}

export function status(repo, stageTool, { maxHoras = 24, produtos } = {}) {
  const linhas = [], bloqueios = [];
  const head = gitHead(repo);
  for (const p of produtos || produtosRegistrados(repo)) {
    if (!fs.existsSync(path.join(repo, p.produto))) continue;
    // produto sem mudança alguma no git: nada a montar, nada a atrasar (arquivo IGNORADO pelo git não aparece aqui; o gate pre pega na hora do deploy)
    if (!git(repo, "status", "--porcelain", "--", p.produto)) { linhas.push(`✓ ${p.produto}: árvore e commit publicam o mesmo`); continue; }
    let d;
    try {
      const work = montarStage(repo, p.produto, stageTool);
      const commit = montarStage(repo, p.produto, stageTool, { from: head });
      try { d = diffTrees(mapaDoStage(work), mapaDoStage(commit)); } finally { fs.rmSync(work.out, { recursive: true, force: true }); fs.rmSync(commit.out, { recursive: true, force: true }); }
    } catch (e) { linhas.push(`? ${p.produto}: não deu para montar o stage (${String(e.message).split("\n")[0]})`); continue; }
    const n = d.soNoTestado.length + d.diferentes.length + d.soNoCommit.length;
    if (!n) { linhas.push(`✓ ${p.produto}: árvore e commit publicam o mesmo`); continue; }
    const horas = idadeHoras(repo, p.produto, [...d.soNoTestado, ...d.diferentes]);
    const msg = `${horas > maxHoras ? "✗" : "⚠"} ${p.produto}: ${n} arquivo(s) públicos prontos na árvore e FORA do commit (mais antigo há ${horas.toFixed(1)} h; limite ${maxHoras} h) → commit, teste e publique`;
    linhas.push(msg);
    if (horas > maxHoras) bloqueios.push(msg);
  }
  return { linhas, bloqueios };
}


// ------------------------------------------------------------------------------------ status --prod
/**
 * Último commit de deploy REGISTRADO no DEPLOYMENTS.md para o produto: o primeiro `commit|HEAD \`sha\`` da linha
 * (a linha lista do deploy mais novo para o mais antigo). Só vale se o sha existe no repo. null = sem registro.
 */
export function ultimoCommitDeploy(repo, produto) {
  const f = path.join(repo, "DEPLOYMENTS.md");
  if (!fs.existsSync(f)) return null;
  const alvo = produto.replace(/\/$/, "");
  for (const l of fs.readFileSync(f, "utf8").split("\n")) {
    if (!l.startsWith("|")) continue;
    const col = l.split("|").map((c) => c.trim());
    if ((col[3] || "").match(/products\/[A-Za-z0-9._-]+/)?.[0] !== alvo) continue;
    // A ordem na linha varia (astrus: mais novo primeiro; afrodite: mais antigo primeiro). Vale o commit MAIS NOVO
    // citado que exista no repo e seja ancestral do HEAD (hotfix em outro branch não conta como deploy da linha).
    const shas = [...new Set([...l.matchAll(/\b(?:commit|HEAD)\s+`([0-9a-f]{7,40})`/gi)].map((m) => m[1]))].filter((x) => {
      try { git(repo, "cat-file", "-e", `${x}^{commit}`); execFileSync("git", ["merge-base", "--is-ancestor", x, "HEAD"], { cwd: repo }); return true; } catch { return false; }
    });
    if (!shas.length) return null;
    const ancestral = (a, b) => { try { execFileSync("git", ["merge-base", "--is-ancestor", a, b], { cwd: repo }); return true; } catch { return false; } };
    const maisNovo = shas.reduce((acc, x) => (ancestral(acc, x) ? x : acc));   // todos são ancestrais do HEAD: ordem total
    return git(repo, "rev-parse", "--short", maisNovo);
  }
  return null;
}

/** Commits que tocam o produto entre o último deploy registrado e o HEAD. */
export function commitsSemDeploy(repo, produto, deployCommit) {
  if (!deployCommit) return null;
  const out = git(repo, "log", "--format=%h\t%s", `${deployCommit}..HEAD`, "--", produto);
  return out ? out.split("\n").map((l) => { const [sha, ...r] = l.split("\t"); return { sha, assunto: r.join("\t") }; }) : [];
}

function provaPathDe(produtoDir) {
  try { return JSON.parse(fs.readFileSync(path.join(produtoDir, ".deploy-integrity.json"), "utf8")).provaPath || "/"; } catch { return "/"; }
}

/** Classifica o resultado de provaNoAr: "ok" | "diverge" (produção ≠ HEAD) | "sem-prova" (não dá para provar). */
export function classificarProva(falhas) {
  if (!falhas.length) return { tipo: "ok" };
  const f = falhas[0];
  if (/^HTML no ar difere|conteúdo no ar diferente/.test(f)) return { tipo: "diverge", motivo: f };
  if (/HTTP 404/.test(f)) return { tipo: "diverge", motivo: f };
  return { tipo: "sem-prova", motivo: f };   // não existe no stage, gated, dinâmico, 403, sem resposta
}

async function emPool(itens, n, fn) {
  const out = new Array(itens.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => { while (i < itens.length) { const k = i++; out[k] = await fn(itens[k]); } }));
  return out;
}

/**
 * Status contra a PRODUÇÃO. Por produto: (1) prova da rota contra o stage do HEAD; (2) commits do produto
 * depois do último deploy registrado. Nunca imprime ✓ sem ter olhado o ar.
 */
export async function statusProd(repo, stageTool, { produtos, fetchFn = fetch, concurrency = 4, timeoutMs = 30000, provaFn = provaNoAr } = {}) {
  const lista = (produtos || produtosRegistrados(repo)).filter((p, i, a) => a.findIndex((x) => x.produto === p.produto) === i);
  const itens = await emPool(lista, concurrency, async (p) => {
    const dir = path.join(repo, p.produto);
    const item = { produto: p.produto, host: p.host, estado: "sem-prova", motivo: "", commitsSemDeploy: [], ultimoDeploy: null };
    if (!fs.existsSync(dir)) { item.motivo = "pasta do produto não existe neste repo"; return item; }
    item.ultimoDeploy = ultimoCommitDeploy(repo, p.produto);
    try { item.commitsSemDeploy = commitsSemDeploy(repo, p.produto, item.ultimoDeploy) || []; } catch { /* sha fora do histórico */ }
    const url = `${p.host.replace(/\/$/, "")}${provaPathDe(dir)}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await provaFn(repo, url, { produto: p.produto, stageTool, fetchFn: (u, o) => fetchFn(u, { ...o, signal: ctl.signal }) });
      const c = classificarProva(r.falhas);
      item.estado = c.tipo; item.motivo = c.motivo || ""; item.url = url;
    } catch (e) { item.estado = "sem-prova"; item.motivo = String(e.message).split("\n")[0]; }
    finally { clearTimeout(timer); }
    return item;
  });
  const linhas = [], bloqueios = [], semProva = [];
  for (const it of itens) {
    const n = it.commitsSemDeploy.length;
    const pend = n ? ` · ${n} commit(s) do produto depois do último deploy registrado (${it.ultimoDeploy}): ${it.commitsSemDeploy.slice(0, 3).map((c) => `${c.sha} ${c.assunto}`).join(" | ")}` : "";
    if (it.estado === "ok" && !n) linhas.push(`✓ ${it.produto}: produção == HEAD (${it.url})`);
    else if (it.estado === "ok") { const m = `⚠ ${it.produto}: produção == HEAD, mas o registro do DEPLOYMENTS.md está atrás${pend}`; linhas.push(m); }
    else if (it.estado === "diverge") { const m = `✗ ${it.produto}: PRODUÇÃO ≠ HEAD: ${it.motivo}${pend} → publique (scripts/deploy-product.sh ${it.produto} --stage) ou declare htmlDynamic`; linhas.push(m); bloqueios.push(m); }
    else { const m = `? ${it.produto}: sem prova (${it.motivo})${pend}`; linhas.push(m); semProva.push(m); if (n) bloqueios.push(m); }
  }
  return { linhas, bloqueios, semProva, itens };
}

// ------------------------------------------------------------------------------------ CLI
async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const repo = repoDe(rest);
  const stageTool = opt(rest, "--stage-tool") || STAGE_PADRAO(repo);
  const positional = rest.filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--repo", "--stage-tool", "--host", "--max-age-hours", "--commit", "--produto", "--concurrency"].includes(rest[i - 1])));
  const bloquear = (falhas, titulo) => {
    if (!falhas.length) { console.log(`✓ deploy-integrity ${titulo}: passa`); return 0; }
    console.error(`✗ deploy-integrity ${titulo} BLOQUEOU:`); for (const f of falhas) console.error(`  ${f}`); return 1;
  };
  if (cmd === "pre" && positional[0]) process.exit(bloquear(pre(repo, positional[0], stageTool), "pre"));
  if (cmd === "post" && positional[0]) {
    const host = opt(rest, "--host") || produtosRegistrados(repo).find((p) => p.produto === positional[0].replace(/\/$/, ""))?.host;
    if (!host) { console.error("✗ deploy-integrity post: sem --host e o produto não tem host no DEPLOYMENTS.md"); process.exit(2); }
    process.exit(bloquear(await post(repo, positional[0], host, stageTool), "post"));
  }
  if (cmd === "resolve" && positional[0]) {
    try { const r = resolverProduto(repo, positional[0]); console.log(`${r.projeto}\t${r.host}`); process.exit(0); }
    catch (e) { console.error(`✗ deploy-integrity resolve: ${e.message}`); process.exit(2); }
  }
  if (cmd === "prova-no-ar" && positional[0]) {
    try {
      const r = await provaNoAr(repo, positional[0], { produto: opt(rest, "--produto"), commit: opt(rest, "--commit"), work: rest.includes("--work"), stageTool });
      if (r.falhas.length) { console.error("✗ NÃO PROVADO no ar:"); for (const f of r.falhas) console.error(`  ${f}`); process.exit(1); }
      console.log(`NO AR: ${positional[0]} (200, tipo plausível, corpo == ${r.arquivo} @ ${rest.includes("--work") ? "árvore" : r.commit.slice(0, 8)})`); process.exit(0);
    } catch (e) { console.error(`✗ prova-no-ar: ${e.message}`); process.exit(2); }
  }
  if (cmd === "status" && rest.includes("--prod")) {
    const r = await statusProd(repo, stageTool, { concurrency: Number(opt(rest, "--concurrency") || 4) });
    if (rest.includes("--json")) console.log(JSON.stringify(r.itens, null, 2));
    else {
      for (const l of r.linhas) console.log(l);
      const n = r.itens.length;
      console.log(`\n${n} produto(s): ${r.itens.filter((i) => i.estado === "ok" && !i.commitsSemDeploy.length).length} provados no ar, ${r.bloqueios.length} bloqueio(s), ${r.semProva.length} sem prova (pendência explícita)`);
    }
    process.exit(r.bloqueios.length || (rest.includes("--strict") && r.semProva.length) ? 1 : 0);
  }
  if (cmd === "status") {
    const { linhas, bloqueios } = status(repo, stageTool, { maxHoras: Number(opt(rest, "--max-age-hours") || 24) });
    for (const l of linhas) console.log(l);
    process.exit(bloqueios.length ? 1 : 0);
  }
  console.error("uso: deploy-integrity.mjs status | pre <products/x> | post <products/x> --host https://… | resolve <products/x> | prova-no-ar <url> [--produto products/x] [--commit <sha>] [--work] [--repo <raiz>] [--stage-tool <stage.mjs>]");
  process.exit(2);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
