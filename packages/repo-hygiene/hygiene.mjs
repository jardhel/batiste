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
//        --allow-unshipped  rebaixa CHECK 6 (committed≠shipped) de ERRO p/ WARN.
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
//    5. stale-derived  — derivado mais velho que a fonte (.hygiene.json)  [ERRO]
//    6. unshipped      — commit local não-pushado e sem PR aberto         [ERRO]
//                        (committed ≠ shipped; --allow-unshipped → WARN)
// =============================================================================
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, basename, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Roda o gate só quando invocado como CLI; sob `import` (testes), só expõe as
// funções puras — sem escanear, sem process.exit.
const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const target = resolve(args.find((a) => !a.startsWith("--")) || ".");
const STRICT = flags.has("--strict");
const WARN_ONLY = flags.has("--warn-only");
const JSON_OUT = flags.has("--json");
const NO_GIT_CLEAN = flags.has("--no-git-clean"); // pre-commit: staged != sujo
const ALLOW_UNSHIPPED = flags.has("--allow-unshipped"); // CHECK 6 vira WARN

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

// --- CHECK 6 decision (pura, testável — git/gh injetados, sem rede) ----------
// Recebe o estado já coletado e devolve { level, msg } ou null (= shipped/limpo).
//   branch        nome do branch atual (ou "HEAD" se detached)
//   aheadOrigin   commits em HEAD que não estão em origin/main (Number)
//   hasUpstream   tem upstream configurado? (boolean)
//   aheadUpstream commits à frente do upstream (Number; só se hasUpstream)
//   prState       estado do PR via `gh pr view --json state` → "OPEN" | null
//                 (null = sem PR, gh indisponível, ou erro — best-effort)
//   subjects      [] de assuntos dos commits stranded (pra mensagem)
//   allowUnshipped rebaixa ERRO → WARN
// Bases de resolução de um asset declarado em brand.yaml: relativa ao dir do
// yaml, ao dir PAI do yaml (cwd da ferramenta que consome, ex. tools/docgen/
// com brands/x.brand.yaml declarando "brands/x.svg"), e à raiz do repo.
export function brandAssetCandidates(root, yamlRelPath, ref) {
  const dir = join(root, dirname(yamlRelPath));
  return [join(dir, ref), join(dirname(dir), ref), join(root, ref)];
}

export function evaluateUnshipped({
  branch = "HEAD",
  aheadOrigin = 0,
  hasUpstream = false,
  aheadUpstream = 0,
  prState = null,
  subjects = [],
  allowUnshipped = false,
} = {}) {
  // "Stranded" = há commit local que origin não tem (não-pushado), OU
  // está à frente do próprio upstream — em ambos os casos, ainda não embarcou.
  const ahead = Math.max(Number(aheadOrigin) || 0, hasUpstream ? Number(aheadUpstream) || 0 : 0);
  if (ahead <= 0) return null;                 // nada além do origin → shipped
  if (prState === "OPEN") return null;         // commit local mas com PR aberto → em trânsito, ok

  const where = hasUpstream
    ? `${aheadUpstream} à frente do upstream, ${aheadOrigin} além de origin/main`
    : `sem upstream, ${aheadOrigin} além de origin/main`;
  const list = subjects.length
    ? "\n    " + subjects.slice(0, 12).map((s) => `· ${s}`).join("\n    ") +
      (subjects.length > 12 ? `\n    … +${subjects.length - 12}` : "")
    : "";
  const level = allowUnshipped ? "warn" : "error";
  return {
    level,
    msg: `${ahead} commit(s) commitado(s) mas não pushado(s) e sem PR aberto — committed ≠ shipped ` +
      `(branch '${branch}': ${where})${list}`,
  };
}

if (IS_MAIN) {
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
    let txt = ""; try { txt = readFileSync(join(root, p), "utf8"); } catch { continue; }
    const refs = [...txt.matchAll(/[:\s"']([\w./-]+\.(?:svg|png|pdf|jpg|jpeg|webp))\b/gi)].map((m) => m[1]);
    for (const r of [...new Set(refs)]) {
      if (/^https?:/.test(r)) continue;
      if (!brandAssetCandidates(root, p, r).some(existsSync))
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

  // CHECK 6 — unshipped (committed ≠ shipped): commit local sem push e sem PR
  try {
    const branch = (() => { try { return git("rev-parse --abbrev-ref HEAD", root); } catch { return "HEAD"; } })();

    // upstream? ahead/behind via @{u}...HEAD (left=behind, right=ahead)
    let hasUpstream = false, aheadUpstream = 0;
    try {
      git("rev-parse --abbrev-ref --symbolic-full-name @{u}", root); // lança se não há upstream
      hasUpstream = true;
      const [, right] = git("rev-list --left-right --count @{u}...HEAD", root).split(/\s+/);
      aheadUpstream = Number(right) || 0;
    } catch { /* sem upstream */ }

    // commits além de origin/main (a referência de "embarcado" do projeto)
    let aheadOrigin = 0, subjects = [];
    try {
      aheadOrigin = Number(git("rev-list --count origin/main..HEAD", root)) || 0;
      if (aheadOrigin > 0)
        subjects = git(`log --format=%s -n 12 origin/main..HEAD`, root).split("\n").filter(Boolean);
    } catch { /* origin/main pode não existir; aheadOrigin fica 0 */ }

    // PR aberto? best-effort via gh; gh ausente/erro → prState=null (cai no threshold)
    let prState = null;
    if (aheadUpstream > 0 || aheadOrigin > 0) {
      try {
        const out = git ? execSync(`gh pr view ${JSON.stringify(branch)} --json state`,
          { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim() : "";
        prState = (JSON.parse(out || "{}").state || null);
      } catch { prState = null; }
    }

    const r = evaluateUnshipped({ branch, aheadOrigin, hasUpstream, aheadUpstream, prState, subjects, allowUnshipped: ALLOW_UNSHIPPED });
    if (r) add("unshipped", r.level, r.msg);
  } catch (e) { add("unshipped", "warn", `checagem de unshipped falhou: ${e.message}`); }
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
} // fim IS_MAIN
