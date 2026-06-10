#!/usr/bin/env node
// =============================================================================
//  @batiste-aidk/credential-preflight — GATE de identidade/credencial em
//  commit/push. É a fechadura que faltou (2026-06-08: push pra `jardhel/batiste`
//  com a conta gh ATIVA = `cachola_admin`, que só tem READ → 403). Toda vez que
//  você commita/empurra, verifica se está usando a credencial/identidade certa.
//
//  Checa, contra o repo do cwd (ou --repo):
//    1. owner/name do repo via `git remote get-url origin`
//    2. conta gh ATIVA via `gh auth status` (linha "Active account: true")
//    3. permissão dessa conta no repo via `gh repo view --json viewerPermission`
//       → tem que ser WRITE/ADMIN/MAINTAIN; READ/NONE REPROVA (exit 1) e, se
//         outra conta gh logada for o dono do repo, SUGERE trocar.
//    4. `git config user.email` não-vazio e (se houver expectativa) bate com
//       --expect-email <email> ou .batiste-identity na raiz do repo.
//
//  uso:  node credential-preflight.mjs [--repo <dir>] [--expect-email <e>]
//                                      [--install-hooks] [--json] [--quiet]
//  hooks: --install-hooks escreve .git/hooks/pre-push e pre-commit chamando o gate.
//  sai !=0 (bloqueia commit/push) se qualquer ERRO; warns não bloqueiam.
// =============================================================================
import { execSync } from "node:child_process";
import { readFileSync, existsSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

const WRITE_PERMS = new Set(["WRITE", "ADMIN", "MAINTAIN"]);

// --- helpers puros (testáveis sem rede) -------------------------------------

// Extrai owner/name de qualquer forma de remote: https, ssh (git@), git://, com
// ou sem .git, com porta, com subgrupo. Retorna { owner, name } ou null.
export function parseRemote(url) {
  if (!url) return null;
  let s = url.trim().replace(/\.git$/i, "");
  // ssh scp-like: git@github.com:owner/name
  let m = s.match(/^[\w.-]+@[\w.-]+:(.+)$/);
  if (m) s = m[1];
  // url com esquema: https://host/owner/name  |  ssh://git@host:22/owner/name
  else if (/^[a-z]+:\/\//i.test(s)) {
    m = s.match(/^[a-z]+:\/\/[^/]+\/(.+)$/i);
    if (m) s = m[1];
  }
  const parts = s.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  // owner = penúltimo segmento, name = último (cobre subgrupos do GitLab também)
  const name = parts[parts.length - 1];
  const owner = parts[parts.length - 2];
  if (!owner || !name) return null;
  return { owner, name };
}

// Decisão de permissão: WRITE/ADMIN/MAINTAIN passa; READ/NONE/desconhecido reprova.
export function permissionDecision(viewerPermission) {
  const p = (viewerPermission || "NONE").toUpperCase();
  return { ok: WRITE_PERMS.has(p), permission: p };
}

// Parser do `gh auth status`: devolve [{ account, active }] na ordem reportada.
export function parseGhAuthStatus(text) {
  const accounts = [];
  let cur = null;
  for (const raw of (text || "").split("\n")) {
    const line = raw.trim();
    let m = line.match(/Logged in to [\w.-]+ account ([\w.-]+)/i);
    if (m) { cur = { account: m[1], active: false }; accounts.push(cur); continue; }
    if (cur && /Active account:\s*true/i.test(line)) cur.active = true;
  }
  return accounts;
}

// Dada a conta ativa (sem write) e a lista toda, sugere outra conta logada que
// seja o dono do repo. Retorna o nome da conta sugerida ou null.
export function suggestAccount(accounts, activeAccount, owner) {
  if (!owner) return null;
  const other = accounts.find(
    (a) => a.account !== activeAccount && a.account.toLowerCase() === owner.toLowerCase(),
  );
  return other ? other.account : null;
}

// --- IO / CLI ---------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const has = (f) => args.includes(f);
  const val = (f) => (has(f) ? args[args.indexOf(f) + 1] : undefined);
  const repoRoot = resolve(val("--repo") || process.cwd());
  const JSON_OUT = has("--json");
  const QUIET = has("--quiet");

  if (has("--install-hooks")) return installHooks(repoRoot);

  const findings = [];
  const fail = (msg) => findings.push({ level: "error", msg });
  const warn = (msg) => findings.push({ level: "warn", msg });
  const sh = (c) => execSync(c, { cwd: repoRoot, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();

  // 1) owner/name do remote
  let remote = "", repoInfo = null;
  try { remote = sh("git remote get-url origin"); } catch { /* */ }
  repoInfo = parseRemote(remote);
  if (!repoInfo) fail(`não consegui resolver owner/name de origin (remote='${remote || "vazio"}')`);

  // 2) conta gh ativa + todas as logadas
  let accounts = [], active = null;
  try {
    accounts = parseGhAuthStatus(sh("gh auth status 2>&1"));
    active = (accounts.find((a) => a.active) || {}).account || null;
  } catch {
    fail("`gh auth status` falhou — gh não autenticado? rode `gh auth login`.");
  }
  if (accounts.length && !active) warn("nenhuma conta gh marcada como ativa (Active account: true)");

  // 2b) credencial FIXADA no repo (git config credential.username) tem
  // precedência sobre a conta ativa: é ela que o push vai usar de fato.
  // Sem isso o gate briga com a realidade quando duas sessões revezam
  // `gh auth switch` (guerra de contas 2026-06-10).
  let pinned = null;
  try { pinned = sh("git config --local credential.username") || null; } catch { /* não fixada */ }
  const effective = pinned || active;
  const who = pinned ? `FIXADA '${pinned}' (credential.username)` : `ATIVA '${active}'`;

  // 3) permissão da conta efetiva no repo
  let permission = null;
  if (repoInfo && effective) {
    const slug = `${repoInfo.owner}/${repoInfo.name}`;
    const viewCmd = pinned
      ? `GH_TOKEN=$(gh auth token --user ${pinned}) gh repo view ${slug} --json viewerPermission`
      : `gh repo view ${slug} --json viewerPermission`;
    try {
      const out = sh(viewCmd);
      permission = JSON.parse(out).viewerPermission;
    } catch {
      fail(`\`gh repo view ${slug}\` falhou com a conta ${who} (sem acesso ao repo? token expirado?).`);
    }
    if (permission) {
      const dec = permissionDecision(permission);
      if (!dec.ok) {
        const suggestion = pinned ? null : suggestAccount(accounts, active, repoInfo.owner);
        const hint = suggestion
          ? `\n    → outra conta gh logada é o dono do repo: \`gh auth switch --user ${suggestion}\``
          : (accounts.length > 1
              ? `\n    → contas gh logadas: ${accounts.map((a) => a.account).join(", ")} — talvez precise trocar com \`gh auth switch\`.`
              : "");
        fail(`conta ${who} tem permissão ${dec.permission} em ${slug} (precisa de WRITE/ADMIN/MAINTAIN p/ push).${hint}`);
      }
    }
  }

  // 4) identidade do committer
  let email = "";
  try { email = sh("git config user.email"); } catch { /* */ }
  if (!email) {
    fail("`git config user.email` está vazio — defina o e-mail do committer.");
  } else {
    let expected = val("--expect-email");
    if (!expected) {
      const idPath = join(repoRoot, ".batiste-identity");
      if (existsSync(idPath)) {
        const m = readFileSync(idPath, "utf8").match(/email\s*[:=]\s*(\S+)/i);
        expected = m ? m[1] : readFileSync(idPath, "utf8").trim().split("\n")[0].trim();
      }
    }
    if (expected && expected.toLowerCase() !== email.toLowerCase())
      fail(`git user.email '${email}' != identidade esperada '${expected}' (--expect-email/.batiste-identity).`);
  }

  // relatório + exit
  const errors = findings.filter((f) => f.level === "error");
  if (JSON_OUT) {
    console.log(JSON.stringify({
      repo: repoInfo, activeAccount: active, permission,
      committerEmail: email, pass: errors.length === 0, findings,
    }, null, 2));
  } else if (!QUIET || findings.length) {
    const icon = { error: "✗", warn: "⚠" };
    if (!findings.length && repoInfo)
      console.log(`✔ credential-preflight OK · ${active} → ${repoInfo.owner}/${repoInfo.name} · ${permission} · ${email}`);
    for (const f of findings) console.error(`${icon[f.level]} credential-preflight: ${f.msg}`);
  }
  process.exit(errors.length ? 1 : 0);
}

function installHooks(repoRoot) {
  let gitDir;
  try {
    gitDir = execSync("git rev-parse --git-dir", { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch { console.error("✗ credential-preflight: --repo não é um repositório git"); process.exit(1); }
  const hooksDir = resolve(repoRoot, gitDir, "hooks");
  mkdirSync(hooksDir, { recursive: true });
  const self = fileURLToPathSafe(import.meta.url);
  const body = (op) =>
    `#!/bin/sh\n# instalado por @batiste-aidk/credential-preflight (${op})\n` +
    `# verifica conta gh ativa + permissão de write + identidade do committer.\n` +
    `exec node "${self}" --repo "${repoRoot}" --quiet\n`;
  for (const op of ["pre-push", "pre-commit"]) {
    const p = join(hooksDir, op);
    writeFileSync(p, body(op));
    chmodSync(p, 0o755);
    console.log(`✔ instalado ${op} → ${p}`);
  }
}

function fileURLToPathSafe(u) {
  try { return new URL(u).pathname; } catch { return u; }
}

// só roda o CLI quando executado direto (não quando importado pelo teste)
const entry = process.argv[1] ? resolve(process.argv[1]) : "";
if (entry && fileURLToPathSafe(import.meta.url) === entry) main();
