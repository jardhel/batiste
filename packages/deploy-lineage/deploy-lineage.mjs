#!/usr/bin/env node
// @batiste-aidk/deploy-lineage — GATE de deploy. Recusa subir fonte que não está
// no registro DEPLOYMENTS.md, que não é git-tracked, ou que tem mudança não
// commitada; e carimba o SHA do commit. É a fechadura que faltou na porta do
// deploy (2026-06-08: cachola.tech foi servido de ~/Downloads, sem lineage).
//
// uso: node deploy-lineage.mjs <project> <sourceDir> [--repo <repoRoot>] [--deploy]
//   --deploy  : se passar, roda `wrangler pages deploy` após o gate passar.
// sai !=0 (bloqueia) se qualquer checagem falhar.
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const project = args[0];
const sourceDir = args[1];
const repoRoot = (args.includes("--repo") ? args[args.indexOf("--repo") + 1] : process.cwd());
const doDeploy = args.includes("--deploy");
const fail = (m) => { console.error("✗ deploy-lineage BLOQUEOU:", m); process.exit(1); };
if (!project || !sourceDir) fail("uso: deploy-lineage <project> <sourceDir>");

const sh = (c) => execSync(c, { cwd: repoRoot, encoding: "utf8" }).trim();

// 1) registro DEPLOYMENTS.md tem esse projeto apontando pra essa fonte?
const regPath = resolve(repoRoot, "DEPLOYMENTS.md");
if (!existsSync(regPath)) fail("DEPLOYMENTS.md não existe — sem registro, sem deploy");
const reg = readFileSync(regPath, "utf8");
const row = reg.split("\n").find((l) => l.includes("`" + project + "`") && l.includes("products/"));
if (!row) fail(`projeto '${project}' não está no DEPLOYMENTS.md (ou marcado A CONFIRMAR/LEGADO)`);
const expected = (row.match(/products\/[A-Za-z0-9._\/-]+/) || [])[0];
const srcNorm = sourceDir.replace(/^\.\//, "").replace(/\/$/, "");
if (!expected || !srcNorm.startsWith(expected.replace(/\/$/, ""))) fail(`fonte '${srcNorm}' != registro '${expected}' p/ '${project}'`);

// 2) a fonte é git-tracked?
const tracked = sh(`git ls-files -- ${srcNorm} | head -1`);
if (!tracked) fail(`'${srcNorm}' não tem arquivo algum git-tracked — fonte fora do git`);

// 3) sem mudança não-commitada na fonte? (derivados devem estar gitignored)
const dirty = sh(`git status --porcelain -- ${srcNorm}`);
if (dirty) fail(`'${srcNorm}' tem mudança não-commitada:\n${dirty}\n→ commite antes de deployar (lineage = só o que está no git vai pro ar)`);

// 4) carimba o SHA
const sha = sh("git rev-parse --short HEAD");
const branch = sh("git rev-parse --abbrev-ref HEAD");
console.log(`✔ deploy-lineage OK · ${project} ← ${srcNorm} · ${branch}@${sha}`);

if (doDeploy) {
  console.log(`▶ wrangler pages deploy ${srcNorm} --project-name ${project} --branch main --commit-hash ${sha}`);
  execSync(`npx wrangler pages deploy . --project-name ${project} --branch main --commit-dirty=false`, { cwd: resolve(repoRoot, srcNorm), stdio: "inherit" });
}
