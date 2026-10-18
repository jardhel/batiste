#!/usr/bin/env node
// secret-scan — gate de pre-commit contra credencial em código/release.
// Nascido do incidente 2026-10-17 (senhas de sala Thalia hardcoded como fallback:,
// DEMO_SECRET com fallback efetivo em prod, tokens ?t= inteiros em releases/).
// Promovido de cachola_tech/tools/secret-scan para pacote do Batiste em 2026-10-18.
//
// Escopo: TODOS os arquivos texto staged — inclusive *.md/*.txt/*.json de
// releases/ e obs_vault/. Exit 1 bloqueia; exceção SÓ por allowlist pinada,
// nunca "passa dessa vez".
//
// Uso (rodando DENTRO do repo alvo):
//   node secret-scan.mjs                       # staged (pre-commit)
//   node secret-scan.mjs --all                 # todos os git ls-files
//   node secret-scan.mjs <arquivo...>          # arquivos explícitos
//   node secret-scan.mjs --allowlist <json>    # allowlist do repo (senão: $SECRET_SCAN_ALLOWLIST,
//                                              #   <raiz>/.secret-scan.allowlist.json, ou a genérica do pacote)
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------- padrões (régua §b do plano 2026-10-17)
// id, descrição, regex, e escopo opcional (glob de caminho onde o padrão vale).
export const PADROES = [
  { id: 1, desc: "fallback de credencial (proibido, inclusive dev-only)",
    re: /(secretFallback|fallback)\s*:\s*["'][^"']{4,}["']/,
    soEm: (p) => /(^|\/)functions\//.test(p) || /^tools\//.test(p) },
  // p2 só dispara quando o NOME da env cheira a credencial (SECRET/TOKEN/PASS/
  // SENHA/KEY/AUTH) — env.LEAD_FROM || "..." é default inócuo; env.FORM_SECRET ||
  // "..." é exatamente a classe que produziu 8 dos 17 achados do incidente.
  { id: 2, desc: "env.<credencial> || \"literal\" — fail-open que vira credencial efetiva",
    re: /env(\.[A-Za-z_]+|\[[^\]]+\])\s*\|\|\s*["'][^"']+["']/,
    check: (linha) => {
      const m = linha.match(/env(\.[A-Za-z_]+|\[[^\]]+\])\s*\|\|\s*["'][^"']+["']/);
      return m ? /secret|token|pass|senha|key|auth/i.test(m[1]) : false;
    } },
  { id: 3, desc: "atribuição de credencial literal (PASS/SENHA/SECRET/TOKEN/API_KEY)",
    re: /(PASS|PASSWORD|SENHA|SECRET|TOKEN|API_?KEY)[A-Z_]*\s*[:=]\s*["'][^"']{6,}["']/ },
  { id: 4, desc: "senha em claro em sidecar/INDEX (md/txt)",
    re: /^\s*senha\s*[:=]?\s*\S{6,}/i,
    soEm: (p) => /\.(md|txt)$/i.test(p) },
  { id: 5, desc: "token assinado INTEIRO (Thalia/JWT) — release só carrega link truncado",
    re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{30,}|\?t=eyJ[A-Za-z0-9_-]{16,}/ },
  { id: 6, desc: "prefixo de provedor (Stripe/Anthropic/AWS/Google/GitHub/Slack)",
    re: /sk_live_[A-Za-z0-9]{8,}|rk_live_[A-Za-z0-9]{8,}|pk_live_[A-Za-z0-9]{8,}|whsec_[A-Za-z0-9]{10,}|sk-ant-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{36,}|xox[baprs]-[A-Za-z0-9-]{8,}/ },
  { id: 7, desc: "Bearer literal ou user:pass em URL",
    re: /Bearer\s+[A-Za-z0-9._=-]{20,}|:\/\/[^/\s"']+:[^@\s"']+@/ },
  { id: 8, desc: "chave privada PEM",
    re: /BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/ },
  { id: 9, desc: "entropia alta (hex ≥40 ou base64 ≥48 entre aspas)",
    re: /["'][0-9a-f]{40,}["']|["'][A-Za-z0-9+\/]{48,}={0,2}["']/ },
];

// Arquivo de segredo staged bloqueia por NOME (padrão 8b): .env/.dev.vars/.pem/id_rsa
// (só *.example passa — e o pre-commit da casa confia que example não carrega valor real,
// porque o conteúdo também passa pelos padrões acima).
export const NOME_PROIBIDO = (p) => {
  const base = p.split("/").pop();
  if (/\.example$/.test(base)) return false;
  return /^\.env($|\.)/.test(base) || /^\.dev\.vars($|\.)/.test(base) || /\.pem$/.test(base) || /^id_rsa/.test(base);
};

// ---------------------------------------------------------------------------- allowlist
const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
const globRe = (g) => new RegExp("^" + g.split("**").map((t) => t.split("*").map(esc).join("[^/]*")).join(".*") + "$");
// Glob "a/**" também casa o nível raiz do diretório; nome simples casa em qualquer nível.
function casaGlob(res, p) { return res.some((re) => re.test(p) || re.test(p.split("/").pop())); }
const shaLinha = (l) => createHash("sha256").update(l.trim()).digest("hex");

export function carregarAllowlist(root, explicita) {
  const cand = [explicita, process.env.SECRET_SCAN_ALLOWLIST, join(root, ".secret-scan.allowlist.json"), join(AQUI, "allowlist.json")].filter(Boolean);
  for (const c of cand) { const f = resolve(root, c); if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8")); if (c === explicita) throw new Error(`allowlist não encontrada: ${f}`); }
  return {};
}

function compilar(ALLOW) {
  return {
    PATH_SKIP: (ALLOW.paths || []).map(globRe),
    LINE_ALLOW: (ALLOW.lineAllow || []).map((r) => new RegExp(r)),
    PATH_PATTERN_SKIP: (ALLOW.pathPatterns || []).map((e) => ({ re: globRe(e.glob), patterns: new Set(e.patterns) })),
    VALORES: (ALLOW.values || []).map((v) => ({ match: v.match, paths: (v.paths || []).map(globRe) })),
    PINS: new Map((ALLOW.pins || []).map((p) => [`${p.path}`, new Set([].concat(p.lineSha256))])),
  };
}

function permitido(A, path, linha, padraoId) {
  for (const re of A.LINE_ALLOW) if (re.test(linha)) return true;
  for (const e of A.PATH_PATTERN_SKIP) if (e.patterns.has(padraoId) && (e.re.test(path) || e.re.test(path.split("/").pop()))) return true;
  for (const v of A.VALORES) {
    if (!linha.includes(v.match)) continue;
    if (!v.paths.length || casaGlob(v.paths, path)) return true;
  }
  const pins = A.PINS.get(path);
  if (pins && pins.has(shaLinha(linha))) return true;
  return false;
}

// ---------------------------------------------------------------------------- fontes de conteúdo
export const gitRoot = (cwd = process.cwd()) => execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" }).trim();
const stagedFiles = (root) => execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
const allFiles = (root) => execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 }).split("\n").filter(Boolean);
function conteudo(root, path, staged) {
  try {
    if (staged) return execFileSync("git", ["show", `:${path}`], { cwd: root, encoding: "buffer", maxBuffer: 1 << 28 });
    return readFileSync(join(root, path));
  } catch { return null; }
}
const BIN_EXT = /\.(png|jpe?g|gif|webp|avif|ico|svgz|woff2?|ttf|otf|pdf|mp4|webm|mp3|wav|m4a|zip|gz|tar|stl|glb|wasm|pyc|jar|bin|heic|mov|xlsx|docx|pptx|key|sketch|fig|psd|ai|eps|dat|db|sqlite|node)$/i;

// ---------------------------------------------------------------------------- scan
/** Varre e devolve os achados. modo: "staged" | "all" | "files". */
export function scan({ root = gitRoot(), modo = "staged", files, allowlist } = {}) {
  const A = compilar(allowlist ?? carregarAllowlist(root));
  const staged = modo === "staged";
  const lista = modo === "files" ? files : modo === "all" ? allFiles(root) : stagedFiles(root);
  const achados = [];
  for (const f of lista) {
    if (casaGlob(A.PATH_SKIP, f) || f.endsWith(".secret-scan.allowlist.json")) continue; // a própria allowlist guarda hashes
    if (NOME_PROIBIDO(f)) { achados.push({ f, n: 0, id: 8, linha: "(arquivo de segredo staged — só *.example passa)", desc: "arquivo de segredo" }); continue; }
    if (BIN_EXT.test(f)) continue;
    const buf = conteudo(root, f, staged);
    if (!buf) continue;
    if (buf.includes(0)) continue; // binário
    const linhas = buf.toString("utf8").split("\n");
    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];
      if (linha.length > 500) continue; // bundle minificado/base64 inline
      for (const p of PADROES) {
        if (p.soEm && !p.soEm(f)) continue;
        if (!p.re.test(linha)) continue;
        if (p.check && !p.check(linha)) continue;
        if (permitido(A, f, linha, p.id)) continue;
        achados.push({ f, n: i + 1, id: p.id, linha: linha.trim().slice(0, 160), desc: p.desc });
      }
    }
  }
  return { achados, total: lista.length, staged };
}

function main() {
  const args = process.argv.slice(2);
  const ai = args.indexOf("--allowlist");
  const allowPath = ai >= 0 ? args[ai + 1] : undefined;
  const explicitos = args.filter((a, i) => !a.startsWith("--") && !(ai >= 0 && i === ai + 1));
  const modo = args.includes("--all") ? "all" : explicitos.length ? "files" : "staged";
  const root = gitRoot();
  const { achados, total, staged } = scan({ root, modo, files: explicitos, allowlist: carregarAllowlist(root, allowPath) });
  if (achados.length) {
    console.error(`✗ secret-scan BLOQUEOU: ${achados.length} achado(s) de credencial/token em ${staged ? "arquivos staged" : "arquivos varridos"}.\n`);
    for (const a of achados) console.error(`  [p${a.id}] ${a.f}:${a.n}  ${a.desc || ""}\n        ${a.linha}`);
    console.error("\n  Credencial vai em secret (wrangler pages secret put) + .dev.vars local — NUNCA literal.");
    console.error("  Falso positivo CONHECIDO? Exceção só por allowlist pinada (--allowlist / .secret-scan.allowlist.json).");
    process.exit(1);
  }
  console.log(`✓ secret-scan: ${total} arquivo(s) ${staged ? "staged " : ""}limpos.`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
