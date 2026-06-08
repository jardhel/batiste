#!/usr/bin/env node
// =============================================================================
//  Batiste · repo-hygiene gate — "padrão da casa" como GATE, não como memória.
//  Falha o "done" da sessão quando o vibe coding deixou bagunça.
//
//  uso:  node hygiene.mjs [path] [--strict] [--warn-only] [--json]
//        path        dir-alvo (default: cwd). Escaneia arquivos git-tracked sob ele.
//        --strict    WARN também derruba (exit 1).
//        --warn-only nada derruba (exit 0); só reporta.
//        --json      saída JSON (pra CI/Batiste).
//
//  Config opcional por repo: .hygiene.json na raiz do git
//    { "allowDuplicateBasenames": ["favicon.svg"],
//      "draftPatterns": ["_final_[a-z]"], "ignore": ["node_modules/"] }
//
//  Os 4 checks (decisão 2026-06-08, postmortem maju-1/astrus):
//    1. git-clean      — é repo git e sem mudança não-commitada no alvo   [ERRO]
//    2. no-duplicate   — nenhum arquivo idêntico por hash em >1 pasta     [WARN]
//    3. drafts-scoped  — rascunho/variante só dentro de _scratch/         [ERRO]
//    4. canonical      — asset declarado em *.brand.yaml existe no disco  [WARN]
// =============================================================================
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, basename, relative, resolve } from "node:path";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const target = resolve(args.find((a) => !a.startsWith("--")) || ".");
const STRICT = flags.has("--strict");
const WARN_ONLY = flags.has("--warn-only");
const JSON_OUT = flags.has("--json");
const NO_GIT_CLEAN = flags.has("--no-git-clean"); // pre-commit: staged != sujo

const findings = [];
const add = (check, level, msg) => findings.push({ check, level, msg });
const git = (cmd, cwd) =>
  execSync(`git ${cmd}`, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
// glob simples → regex (suporta ** e *) p/ o check de derivado-stale
const globToRe = (g) => new RegExp("^" +
  g.replace(/[.+^${}()|[\]\\]/g, "\\$&")
   .replace(/\*\*\//g, "§§").replace(/\*\*/g, "§").replace(/\*/g, "[^/]*")
   .replace(/§§/g, "(?:.*/)?").replace(/§/g, ".*") + "$");
const mm = (p, g) => globToRe(g).test(p);

let root = null;
try { root = git("rev-parse --show-toplevel", target); } catch { /* not a repo */ }
let tracked = [];

if (!root) {
  add("git-clean", "error",
    `'${target}' não está em repositório git (sem rede de segurança; faxina seria irreversível). Rode: git init`);
} else {
  let cfg = { allowDuplicateBasenames: ["favicon.svg", "og-image.png", ".gitignore"], draftPatterns: [], ignore: [] };
  const cfgPath = join(root, ".hygiene.json");
  if (existsSync(cfgPath)) {
    try { cfg = { ...cfg, ...JSON.parse(readFileSync(cfgPath, "utf8")) }; }
    catch (e) { add("config", "warn", `.hygiene.json inválido: ${e.message}`); }
  }

  const relTarget = relative(root, target) || ".";
  const underTarget = (p) => relTarget === "." || p === relTarget || p.startsWith(relTarget + "/");
  try {
    tracked = git("ls-files", root).split("\n").filter(Boolean)
      .filter(underTarget).filter((p) => !cfg.ignore.some((ig) => p.includes(ig)));
  } catch { /* */ }

  // CHECK 1 — git-clean (pulado em pre-commit via --no-git-clean)
  if (!NO_GIT_CLEAN) try {
    const dirty = git(`status --porcelain -- "${relTarget}"`, root).split("\n").filter(Boolean)
      .filter((l) => !cfg.ignore.some((ig) => l.includes(ig)));
    if (dirty.length)
      add("git-clean", "error", `${dirty.length} mudança(s) não-commitada(s):\n    ` +
        dirty.slice(0, 12).join("\n    ") + (dirty.length > 12 ? `\n    … +${dirty.length - 12}` : ""));
  } catch (e) { add("git-clean", "warn", `git status falhou: ${e.message}`); }

  // CHECK 2 — no-duplicate (hash)
  const byHash = new Map();
  for (const p of tracked) {
    const abs = join(root, p);
    try {
      if (!statSync(abs).isFile()) continue;
      const h = createHash("sha256").update(readFileSync(abs)).digest("hex");
      if (!byHash.has(h)) byHash.set(h, []);
      byHash.get(h).push(p);
    } catch { /* */ }
  }
  for (const [h, paths] of byHash) {
    if (paths.length < 2) continue;
    if (new Set(paths.map(dirname)).size < 2) continue;        // mesmo dir: ok
    if (cfg.allowDuplicateBasenames.includes(basename(paths[0]))) continue;
    add("no-duplicate", "warn",
      `conteúdo idêntico (multi-source) em ${paths.length} pastas: ${paths.join("  ·  ")}  [${h.slice(0, 8)}]`);
  }

  // CHECK 3 — drafts-scoped
  const DRAFT_RX = [
    /(^|\/)concepts?(\/|$)/i, /_final_[a-z0-9](\.|_|\/|$)/i, /_draft(\.|_|\/|$)/i,
    /_old(\.|_|\/|$)/i, /_bak(\.|_|\/|$)/i, /[ _-]copy(\.|_|\/|$)/i, /_v\d+(\.|_|\/|$)/i,
    /(^|\/)untitled/i, /(^|\/)[a-c]\.html$/i, ...cfg.draftPatterns.map((s) => new RegExp(s, "i")),
  ];
  for (const p of tracked) {
    if (p.includes("_scratch/")) continue;
    if (DRAFT_RX.some((rx) => rx.test(p))) add("drafts-scoped", "error", `rascunho fora de _scratch/: ${p}`);
  }

  // CHECK 4 — canonical assets (brand.yaml)
  for (const p of tracked.filter((p) => /\.brand\.ya?ml$|(^|\/)brand\.ya?ml$/i.test(p))) {
    const dir = join(root, dirname(p));
    let txt = ""; try { txt = readFileSync(join(root, p), "utf8"); } catch { continue; }
    const refs = [...txt.matchAll(/[:\s"']([\w./-]+\.(?:svg|png|pdf|jpg|jpeg|webp))\b/gi)].map((m) => m[1]);
    for (const r of [...new Set(refs)]) {
      if (/^https?:/.test(r)) continue;
      if (![join(dir, r), join(root, r)].some(existsSync))
        add("canonical", "warn", `${p} declara asset ausente: ${r}`);
    }
  }

  // CHECK 5 — derivado stale (config: .hygiene.json staleCheck[{derived, source}])
  for (const rule of (cfg.staleCheck || [])) {
    const mt = (p) => { try { return statSync(join(root, p)).mtimeMs; } catch { return 0; } };
    const srcs = tracked.filter((p) => mm(p, rule.source));
    const drvs = tracked.filter((p) => mm(p, rule.derived));
    if (!srcs.length || !drvs.length) continue;
    const newestSrc = Math.max(...srcs.map(mt));
    const stale = drvs.filter((p) => mt(p) < newestSrc);
    if (stale.length)
      add("stale-derived", "error", `derivado mais velho que a fonte (${rule.source}): ` +
        stale.slice(0, 8).join(", ") + (stale.length > 8 ? ` … +${stale.length - 8}` : ""));
  }
}

// relatório + exit
const errors = findings.filter((f) => f.level === "error");
const warns = findings.filter((f) => f.level === "warn");
if (JSON_OUT) {
  console.log(JSON.stringify({ target, root, pass: errors.length === 0 && (!STRICT || warns.length === 0), errors, warns }, null, 2));
} else {
  const icon = { error: "✗", warn: "⚠" };
  if (!findings.length) console.log(`✓ repo-hygiene OK (${tracked.length} arquivos tracked)`);
  for (const f of findings) console.log(`${icon[f.level]} [${f.check}] ${f.msg}`);
  if (findings.length) console.log(`\n${errors.length} erro(s), ${warns.length} aviso(s).`);
}
try {
  const audit = await import("@batiste-aidk/audit");
  if (audit?.smoke) audit.smoke("repo-hygiene", { errors: errors.length, warns: warns.length });
} catch { /* opcional */ }
process.exit(WARN_ONLY ? 0 : (errors.length || (STRICT && warns.length)) ? 1 : 0);
