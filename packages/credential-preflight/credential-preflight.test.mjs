// Testes do gate de credencial — node:test (built-in, zero dep, sem rede).
// Cobre: parse de remote (https/ssh/etc), decisão de permissão, parse do
// `gh auth status`, e a lógica de sugerir outra conta logada.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseRemote,
  permissionDecision,
  parseGhAuthStatus,
  suggestAccount,
} from "./credential-preflight.mjs";

test("parseRemote — formas de URL https e ssh", () => {
  assert.deepEqual(parseRemote("https://github.com/jardhel/batiste.git"), { owner: "jardhel", name: "batiste" });
  assert.deepEqual(parseRemote("https://github.com/jardhel/batiste"), { owner: "jardhel", name: "batiste" });
  assert.deepEqual(parseRemote("git@github.com:jardhel/batiste.git"), { owner: "jardhel", name: "batiste" });
  assert.deepEqual(parseRemote("git@github.com:jardhel/batiste"), { owner: "jardhel", name: "batiste" });
  assert.deepEqual(parseRemote("ssh://git@github.com:22/cachola/repo.git"), { owner: "cachola", name: "repo" });
  assert.deepEqual(parseRemote("git://github.com/jardhel/batiste.git"), { owner: "jardhel", name: "batiste" });
  // subgrupo (estilo GitLab) — pega os dois últimos segmentos
  assert.deepEqual(parseRemote("https://gitlab.com/group/sub/proj.git"), { owner: "sub", name: "proj" });
});

test("parseRemote — entradas inválidas devolvem null", () => {
  assert.equal(parseRemote(""), null);
  assert.equal(parseRemote(undefined), null);
  assert.equal(parseRemote("not-a-url"), null);
});

test("permissionDecision — WRITE/ADMIN/MAINTAIN passam; READ/NONE reprovam", () => {
  assert.equal(permissionDecision("WRITE").ok, true);
  assert.equal(permissionDecision("ADMIN").ok, true);
  assert.equal(permissionDecision("MAINTAIN").ok, true);
  assert.equal(permissionDecision("write").ok, true, "case-insensitive");
  assert.equal(permissionDecision("READ").ok, false);
  assert.equal(permissionDecision("NONE").ok, false);
  assert.equal(permissionDecision(null).ok, false);
  assert.equal(permissionDecision("READ").permission, "READ");
});

const GH_STATUS = `github.com
  ✓ Logged in to github.com account cachola_admin (keyring)
  - Active account: true
  - Git operations protocol: https
  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'

  ✓ Logged in to github.com account jardhel (keyring)
  - Active account: false
  - Git operations protocol: https
  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'`;

test("parseGhAuthStatus — extrai contas e marca a ativa", () => {
  const accts = parseGhAuthStatus(GH_STATUS);
  assert.equal(accts.length, 2);
  assert.deepEqual(accts[0], { account: "cachola_admin", active: true });
  assert.deepEqual(accts[1], { account: "jardhel", active: false });
});

test("parseGhAuthStatus — vazio devolve lista vazia", () => {
  assert.deepEqual(parseGhAuthStatus(""), []);
  assert.deepEqual(parseGhAuthStatus(undefined), []);
});

test("suggestAccount — sugere a outra conta logada que é dona do repo", () => {
  const accts = parseGhAuthStatus(GH_STATUS);
  // ativo=cachola_admin (READ), dono=jardhel → sugere jardhel
  assert.equal(suggestAccount(accts, "cachola_admin", "jardhel"), "jardhel");
});

test("suggestAccount — não sugere quando nenhuma outra conta é o dono", () => {
  const accts = parseGhAuthStatus(GH_STATUS);
  assert.equal(suggestAccount(accts, "cachola_admin", "alguem-aleatorio"), null);
  // não sugere a própria conta ativa mesmo que ela seja o dono
  assert.equal(suggestAccount(accts, "jardhel", "jardhel"), null);
  assert.equal(suggestAccount(accts, "cachola_admin", null), null);
});

// cenário-âncora do incidente 2026-06-08: end-to-end das peças puras.
test("cenário do incidente — cachola_admin/READ em jardhel/batiste reprova e sugere jardhel", () => {
  const repo = parseRemote("https://github.com/jardhel/batiste.git");
  const accts = parseGhAuthStatus(GH_STATUS);
  const active = accts.find((a) => a.active).account;
  const dec = permissionDecision("READ");
  assert.equal(active, "cachola_admin");
  assert.equal(dec.ok, false, "READ não pode empurrar → deve reprovar");
  assert.equal(suggestAccount(accts, active, repo.owner), "jardhel");
});
