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
//        --no-tasklog       pula CHECK 7 (TaskLog); o pre-commit usa, o fim de sessão NÃO.
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
//                        Sem origin/main (repo local-only) o check NÃO fica mudo: usa o registro de
//                        deploy do DEPLOYMENTS.md (commits do produto depois do último deploy).
//    7. tasklog        — TaskLog parado/orfão/estado apodrecido (packages/tasklog-hygiene) [ERRO]
//                        ligado por "tasklog": {"enabled": true, ...} no .hygiene.json; fim de sessão.
// =============================================================================
import { execFileSync, spawnSync } from "node:child_process";
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
const NO_TASKLOG = flags.has("--no-tasklog"); // CHECK 7 só no fim de sessão

const findings = [];
const add = (check, level, msg) => findings.push({ check, level, msg });
// argv direto (sem shell): `cmd` string é dividida em espaços (só literais fixos);
// entrada dinâmica (caminhos, branch) SEMPRE vai como array.
const git = (cmd, cwd) =>
  execFileSync("git", Array.isArray(cmd) ? cmd : cmd.split(/\s+/).filter(Boolean),
    { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
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

// --- CHECK 6 sem remote: registro de deploy (puro; o git é injetado pelo chamador) -----------
// itens: [{ produto, ultimoDeploy, commits: [{sha, assunto}] }] — commits do produto DEPOIS do
// último deploy registrado no DEPLOYMENTS.md. Devolve findings; vazio = tudo publicado.
export function evaluateUnshippedRegistro({ itens = [], allowUnshipped = false } = {}) {
  const level = allowUnshipped ? "warn" : "error";
  return itens.filter((i) => i.commits && i.commits.length).map((i) => ({
    check: "unshipped", level,
    msg: `${i.produto}: ${i.commits.length} commit(s) depois do último deploy registrado (${i.ultimoDeploy}) — committed ≠ shipped ` +
      `(CHECK 6 em modo registro de deploy: sem origin/main)\n    ` + i.commits.slice(0, 5).map((c) => `· ${c.sha} ${c.assunto}`).join("\n    ") +
      (i.commits.length > 5 ? `\n    … +${i.commits.length - 5}` : "") +
      `\n    → scripts/deploy-product.sh ${i.produto} --stage`,
  }));
}

// --- CHECK 7: TaskLog (puro: recebe o JSON do tasklog-hygiene) --------------------------------
// res: { pass, erros:[{regra,taskId,label,detalhe,sugestao}], avisos:[{regra,detalhe}] } ou { falhaLeitura }
export function tasklogFindings(res, { warnOnly = false } = {}) {
  if (!res) return [];
  if (res.falhaLeitura) return [{ check: "tasklog", level: "warn", msg: `TaskLog ilegível — o gate NÃO rodou: ${res.falhaLeitura}` }];
  const out = [];
  const porRegra = {};
  for (const v of res.erros || []) (porRegra[v.regra] ??= []).push(v);
  for (const [regra, vs] of Object.entries(porRegra)) {
    const ex = vs.slice(0, 5).map((v) => `${String(v.taskId).slice(0, 8)} ${String(v.label).slice(0, 70)} — ${v.detalhe}`);
    out.push({ check: "tasklog", level: warnOnly ? "warn" : "error",
      msg: `[${regra}] ${vs.length} tarefa(s)\n    ${ex.join("\n    ")}${vs.length > 5 ? `\n    … +${vs.length - 5}` : ""}\n    → ${vs[0].sugestao}` });
  }
  for (const a of res.avisos || []) out.push({ check: "tasklog", level: "warn", msg: `[${a.regra}] ${a.detalhe}` });
  return out;
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
    const dirty = git(["status", "--porcelain", "--", relTarget], root).split("\n").filter(Boolean)
      .filter((l) => !cfg.ignore.some((ig) => l.includes(ig)));
    if (dirty.length)
      add("git-clean", "error", `${dirty.length} mudança(s) não-commitada(s):\n    ` +
        dirty.slice(0, 12).join("\n    ") + (dirty.length > 12 ? `\n    … +${dirty.length - 12}` : ""));
  } catch (e) { add("git-clean", "warn", `git status falhou: ${e.message}`); }

  // CHECK 2 — no-duplicate (hash)
  const byHash = new Map();
  // Só lê o que pode ser duplicata. Conteúdo idêntico implica tamanho idêntico, então arquivo com
  // tamanho único está descartado sem abrir. Importa porque statSync é metadado e readFileSync é
  // conteúdo: num repo sincronizado por iCloud o stat custa microssegundos e a leitura de arquivo
  // evicted custa centenas de milissegundos, cada. Neste monorepo o filtro dispensa 61% dos
  // arquivos e derruba o volume lido de 6 GB pra 210 MB — a diferença entre o gate rodar em
  // segundos e não terminar.
  const porTamanho = new Map();
  for (const p of tracked) {
    try {
      const st = statSync(join(root, p));
      if (!st.isFile()) continue;
      // arquivo vazio não é duplicata: __init__.py, .gitkeep e placeholders compartilham o hash
      // do vazio e agrupavam dezenas de caminhos sem relação nenhuma.
      if (st.size === 0) continue;
      if (!porTamanho.has(st.size)) porTamanho.set(st.size, []);
      porTamanho.get(st.size).push(p);
    } catch { /* */ }
  }
  for (const candidatos of porTamanho.values()) {
    if (candidatos.length < 2) continue;
    for (const p of candidatos) {
      try {
        const h = createHash("sha256").update(readFileSync(join(root, p))).digest("hex");
        if (!byHash.has(h)) byHash.set(h, []);
        byHash.get(h).push(p);
      } catch { /* */ }
    }
  }
  for (const [h, paths] of byHash) {
    if (paths.length < 2) continue;
    if (new Set(paths.map(dirname)).size < 2) continue;        // mesmo dir: ok
    // allowlist aceita nome exato OU padrão de sufixo ("*.woff2"): duplicata estrutural existe
    // por regra (fonte self-host POR projeto Pages, template imutável de release), e afogar o
    // gate em aviso estrutural esconde a duplicata que é entropia de verdade.
    const bn = basename(paths[0]);
    if (cfg.allowDuplicateBasenames.some((a) => (a.startsWith("*") ? bn.endsWith(a.slice(1)) : a === bn))) continue;
    // duplicata contida INTEIRAMENTE num escopo imutável (releases são snapshots: reusam asset e
    // template por definição) não é entropia. Se um único caminho do grupo estiver fora do escopo,
    // o aviso continua: aí é arquivo de produto repetido, que é o que o gate existe pra pegar.
    if ((cfg.duplicateScopeIgnore || []).some((sc) => paths.every((f) => f.startsWith(sc)))) continue;
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
    let aheadOrigin = 0, subjects = [], semOrigin = false;
    try { git("rev-parse --verify origin/main", root); } catch { semOrigin = true; }
    try {
      aheadOrigin = Number(git("rev-list --count origin/main..HEAD", root)) || 0;
      if (aheadOrigin > 0)
        subjects = git(`log --format=%s -n 12 origin/main..HEAD`, root).split("\n").filter(Boolean);
    } catch { /* origin/main pode não existir; aheadOrigin fica 0 */ }

    // PR aberto? best-effort via gh; gh ausente/erro → prState=null (cai no threshold)
    let prState = null;
    if (aheadUpstream > 0 || aheadOrigin > 0) {
      try {
        const out = git ? execFileSync("gh", ["pr", "view", branch, "--json", "state"],
          { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim() : "";
        prState = (JSON.parse(out || "{}").state || null);
      } catch { prState = null; }
    }

    const r = evaluateUnshipped({ branch, aheadOrigin, hasUpstream, aheadUpstream, prState, subjects, allowUnshipped: ALLOW_UNSHIPPED });
    if (r) add("unshipped", r.level, r.msg);
    if (semOrigin) {
      // Repo local-only: "embarcado" = produção. Antes o check engolia a falta de origin/main e passava calado.
      try {
        const di = await import("../deploy-integrity/deploy-integrity.mjs");
        const itens = [...new Map(di.produtosRegistrados(root).map((p) => [p.produto, p])).values()]
          .filter((p) => existsSync(join(root, p.produto)))
          .map((p) => { const ultimoDeploy = di.ultimoCommitDeploy(root, p.produto); let commits = []; try { commits = di.commitsSemDeploy(root, p.produto, ultimoDeploy) || []; } catch { /* sha fora do histórico */ } return { produto: p.produto, ultimoDeploy, commits }; });
        for (const f of evaluateUnshippedRegistro({ itens, allowUnshipped: ALLOW_UNSHIPPED })) add(f.check, f.level, f.msg);
      } catch (e) { add("unshipped", "warn", `CHECK 6 inativo: sem origin/main e o registro de deploy não pôde ser lido (${e.message})`); }
    }
  } catch (e) { add("unshipped", "warn", `checagem de unshipped falhou: ${e.message}`); }

  // CHECK 7 — TaskLog (fim de sessão; pre-commit passa --no-tasklog)
  if (cfg.tasklog?.enabled && !NO_TASKLOG) {
    const gate = join(dirname(fileURLToPath(import.meta.url)), "..", "tasklog-hygiene", "tasklog-hygiene.mjs");
    if (!existsSync(gate)) add("tasklog", "warn", `tasklog-hygiene não encontrado em ${gate} — CHECK 7 não rodou`);
    else {
      const a = [gate, "check", "--repo", root, "--json"];
      if (cfg.tasklog.staleDays) a.push("--stale-days", String(cfg.tasklog.staleDays));
      if (cfg.tasklog.runningHours) a.push("--running-hours", String(cfg.tasklog.runningHours));
      if (cfg.tasklog.prove === false) a.push("--no-prod");
      const r = spawnSync(process.execPath, a, { encoding: "utf8", timeout: (cfg.tasklog.timeoutSec || 180) * 1000, maxBuffer: 64 * 1024 * 1024 });
      let res;
      if (r.status === 3 || r.error || !r.stdout) res = { falhaLeitura: (r.error?.message || r.stderr || `exit ${r.status}`).trim().split("\n")[0] };
      else { try { res = JSON.parse(r.stdout); } catch { res = { falhaLeitura: "saída ilegível do tasklog-hygiene" }; } }
      for (const f of tasklogFindings(res)) add(f.check, f.level, f.msg);
    }
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
} // fim IS_MAIN
