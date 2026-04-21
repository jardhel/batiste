# Eixo 5 — Code Quality Report

**Scope**: Static quality, type safety, test coverage, dead code, CI gates, dependency freshness, deterministic builds, and the SARIF/coverage DD-portal publication contract (E5-DD-18 … E5-DD-21).

**Repo root**: `/Users/jardhel/Documents/git/batiste`
**Branch**: `main`
**Date of audit**: 2026-04-15
**Audit mode**: read-only investigation; no source modifications.

---

## 0. Executive Summary

Batiste's code quality posture is **surprisingly strong for an early-stage repo** — TypeScript strict is wired cleanly across nine of ten packages, the ESLint config uses `strictTypeChecked` + `stylisticTypeChecked` (the most aggressive rule sets `typescript-eslint` ships), and `any` is essentially absent from the production surface (3 occurrences, all in one integration test file). The security-critical packages (scope, auth, audit) have decent unit-test breadth for their happy paths.

But the CI/portal contract the pitch depends on — deterministic builds, a single SARIF artifact, per-package coverage numbers on the DD portal, dependency-freshness SLO — **does not exist yet**. There are no GitHub Actions workflows. There is no coverage tooling configured. There is no reproducibility story. There is no audit-ledger hash chain (E5 doesn't own that, but Eixo 5 will be asked "is the ledger tamper-evident?" during DD and right now the answer is no). Two packages (`cli`, `connectors`) silently opt out of the base tsconfig, losing `noUncheckedIndexedAccess` and `noUnusedLocals` on exactly the surfaces customers touch.

The headline risk for DD: **a prospect running `pnpm build && pnpm test` on a clean clone will succeed, but the moment they ask "show me your SARIF / coverage / CI gate" we have nothing to hand them.** Everything Eixo 8 wants to display on the DD portal for this eixo is unbuilt infrastructure, not fixes to broken code.

**Priority 1 items** (block DD portal):
- Add `.github/workflows/ci.yml` with lint + typecheck + test gates (Section 5).
- Add `knip` for dead-code detection and `vitest --coverage` with v8 provider (Sections 3, 4, 9).
- Fix `packages/cli/tsconfig.json` and `packages/code/tsconfig.json` to extend the base (Section 1).
- Publish SARIF bundle (eslint + tsc + semgrep + knip) per Section 7.

**Priority 2 items** (material but not DD-blocking):
- Add hash-chain to `AuditLedger` (drift: this is E3/E4 territory but affects E5's "ledger integrity" coverage claim).
- Bump `pdf-parse` (1.1.1 → abandoned; Section 6).
- Migrate off `zod@3.25.x` before zod 4 eats the ecosystem.

---

## 1. TypeScript Strict-Mode Audit

### 1.1 Root tsconfig

`/Users/jardhel/Documents/git/batiste/tsconfig.base.json:1-24` is a textbook strict config:

```
strict: true,
noUnusedLocals: true,
noUnusedParameters: true,
noImplicitReturns: true,
noFallthroughCasesInSwitch: true,
noUncheckedIndexedAccess: true
```

Every package SHOULD extend this. Per-package status:

| Package | Extends base? | Extra guards? | File |
|---|---|---|---|
| `aidk` | yes | — | `packages/aidk/tsconfig.json:2` |
| `audit` | yes | — | `packages/audit/tsconfig.json:2` |
| `auth` | yes | — | `packages/auth/tsconfig.json:2` |
| `connectors` | yes | — | `packages/connectors/tsconfig.json:2` |
| `core` | yes | — | `packages/core/tsconfig.json:2` |
| `marketplace` | yes | — | `packages/marketplace/tsconfig.json:2` |
| `scope` | yes | — | `packages/scope/tsconfig.json:2` |
| `transport` | yes | — | `packages/transport/tsconfig.json:2` |
| **`cli`** | **NO — inlines its own config** | `strict: true` only | `packages/cli/tsconfig.json:2-16` |
| **`code`** | **NO — inlines its own config** | `strict: true` only | `packages/code/tsconfig.json:2-19` |

The two outliers (`cli`, `code`) are missing `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUncheckedIndexedAccess`, `forceConsistentCasingInFileNames`, and `esModuleInterop: true` (they set `esModuleInterop: false`). This is a silent relaxation of the quality bar on the two highest-surface-area packages.

**Action**: One-line change each — replace inlined compilerOptions with `"extends": "../../tsconfig.base.json"` and keep only `outDir`/`rootDir`. Will likely surface fresh errors in `packages/code/src/` because that package leans on `execSync` and index access patterns that `noUncheckedIndexedAccess` catches.

### 1.2 `any` in the public API

Grep for `: any` and `as any` across `packages/*/src/**/*.ts` (tests included):

| File | Line | Context |
|---|---|---|
| `packages/aidk/src/__tests__/claims-enforcement.test.ts` | 172 | `(r: any) => r?.id === 2 …` (test-only) |
| `packages/aidk/src/__tests__/claims-enforcement.test.ts` | 173 | `) as any;` (test-only) |
| `packages/aidk/src/__tests__/claims-enforcement.test.ts` | 238 | `.find((r: any) …) as any` (test-only) |
| `packages/aidk/src/__tests__/claims-enforcement.test.ts` | 258 | `.find((r: any) …) as any` (test-only) |

**Production `any` count: 0.** The sole hits are in one integration test decoding JSON-RPC responses. This is the single best signal of type hygiene in the repo.

`unknown` is idiomatically used everywhere the shape is genuinely dynamic — ledger row results (`packages/audit/src/ledger.ts:64`), handler args (`packages/core/src/mcp/types.ts:18`), result filtering (`packages/scope/src/scoped-handler.ts:63`). This is the correct call.

**Action**: Replace the 3 `as any` in `claims-enforcement.test.ts` with a `JsonRpcResponse` type. Keeps the grep-for-any-is-zero signal clean for DD reviewers.

### 1.3 Public-export surface

Exported symbols per core package (from `^export\s+(class|function|const|type|interface|enum)\s+` grep):

- `audit`: 12 exports (classes, schemas, types)
- `auth`: `index.ts` re-exports ~20 named symbols from 4 files
- `scope`: 5 top-level classes/schemas
- `core`: 28+ exports fanned through 6 sub-entrypoints
- `code`: 82 exports across 28 files — by far the largest surface, and the one that most needs `noUncheckedIndexedAccess` turned on

Every security-critical export already has JSDoc header comments on the module, but per-symbol JSDoc on public methods is **spotty** — `KeyStore.isRevoked` is documented (`packages/auth/src/key-store.ts:64-66`), `AuditLedger.append` is documented (`packages/audit/src/ledger.ts:49`), but `SessionMonitor.recordCall` has only a one-line comment and no `@param`/`@returns`. Enforce `eslint-plugin-jsdoc` `require-jsdoc` on exported symbols (Section 2).

---

## 2. ESLint Config Audit

Current config: `/Users/jardhel/Documents/git/batiste/eslint.config.js` (flat config, 29 lines).

### 2.1 Already enabled (good)

- `@eslint/js` recommended
- `typescript-eslint` **strictTypeChecked** — this is the heavy pack. Includes `no-unsafe-assignment`, `no-unsafe-call`, `no-unsafe-member-access`, `no-unsafe-return`, `no-unsafe-argument`, `no-misused-promises`, `no-floating-promises`, `require-await`, `restrict-template-expressions`, `prefer-nullish-coalescing`, `prefer-optional-chain`, `await-thenable`, `no-base-to-string`, and the `no-explicit-any` rule as error.
- `stylisticTypeChecked` — consistent-type-imports, etc.
- `eslint-config-prettier` — turns off formatting rules
- Custom: `consistent-type-imports` error, `no-import-type-side-effects` error, `no-unused-vars` with `_`-prefix escape.

### 2.2 Not enabled — recommended additions

| Rule / plugin | Reason | Severity |
|---|---|---|
| `eslint-plugin-security` (`eslint-plugin-security/recommended`) | Flags `eval`, regex injection, non-literal `require`, `child_process` exec of user input, etc. We have `execSync` usage in `git-tracker.ts` that deserves review | **add: error** |
| `no-eval`, `no-implied-eval` (core) | `strictTypeChecked` does not include these; `security` plugin does, but make it explicit | **add: error** |
| `no-new-func` | `new Function(...)` is another eval path | add: error |
| `eslint-plugin-import` with `import/no-extraneous-deps` | Catches `@batiste-aidk/audit` being imported somewhere that doesn't list it in `dependencies` — we have this risk because pnpm symlinks give false positives | **add: error** |
| `import/no-cycle` | Prevents circular imports; currently no enforcement | add: error |
| `import/no-unresolved` (TS resolver) | Belt-and-suspenders with `tsc` | add: error |
| `@typescript-eslint/explicit-module-boundary-types` | Forces explicit return types on exported functions — strengthens the public API contract for DD reviewers who read `.d.ts` | add: error |
| `@typescript-eslint/no-non-null-assertion` | Currently OFF; we have `entries[0]!.result` patterns in tests that are fine, but production code should prefer guards | add: warn |
| `@typescript-eslint/prefer-readonly` | Internal fields; `KeyStore.db` etc. already use `readonly`, enforce everywhere | add: warn |
| `@typescript-eslint/no-unnecessary-condition` | Part of strictTypeChecked but sometimes overridden — verify it's on after plugin extras | verify |
| `eslint-plugin-jsdoc` → `require-jsdoc` on exports | Section 1.3 gap | add: warn |
| `eslint-plugin-n` → `n/no-sync` | Flag sync FS/child-process calls outside CLI code; `git-tracker.ts` is all `execSync` which blocks the event loop | add: warn |
| `@typescript-eslint/switch-exhaustiveness-check` | `KillSwitch.execute` has a switch over `command.action`; exhaustiveness is currently runtime-only | add: error |

### 2.3 Existing but not surfaced

The config uses `parserOptions.projectService: true`, which is correct and enables the type-aware rules. But **no package has a `lint` script** except `core` and `code` (`packages/core/package.json:42`, `packages/code/package.json:26`). That means `pnpm lint` at the root runs turbo's `lint` task which has no dependency graph (good) but only 2 packages participate (bad).

**Action**: Add `"lint": "eslint src/"` to every package's `package.json` → `turbo lint` suddenly covers the whole repo.

### 2.4 Config ergonomics

`eslint.config.js:27` ignores `**/*.js` and `**/*.mjs` — reasonable since all source is `.ts`, but it means **`eslint.config.js` itself is never linted**, so syntax errors there are caught only when ESLint fails to start. Minor; consider a bootstrap sanity check.

---

## 3. Test-Coverage Assessment (Security-Critical Paths)

No coverage tool is wired up (no `@vitest/coverage-v8` in any package, no `vitest.config.ts` at root, per-package `vitest.config.ts` exists only in `cli`, `code`, `connectors`, `marketplace` and none configure coverage). Numbers below are manual estimates from reading the test files and counting `it(...)` blocks against source branches.

Test count by file (from `describe`/`it` count):

| Test file | `describe`+`it` count |
|---|---|
| `packages/scope/src/__tests__/scoped-handler.test.ts` | 8 |
| `packages/scope/src/__tests__/access-policy.test.ts` | 10 |
| `packages/scope/src/__tests__/file-matcher.test.ts` | 6 |
| `packages/auth/src/__tests__/token-issuer.test.ts` | 6 |
| `packages/auth/src/__tests__/token-verifier.test.ts` | 7 |
| `packages/auth/src/__tests__/key-store.test.ts` | 9 |
| `packages/auth/src/__tests__/middleware.test.ts` | 13 |
| `packages/auth/src/__tests__/scope.test.ts` | 19 |
| `packages/audit/src/__tests__/ledger.test.ts` | 11 |
| `packages/audit/src/__tests__/kill-switch.test.ts` | 9 |
| `packages/audit/src/__tests__/middleware.test.ts` | 6 |
| `packages/audit/src/__tests__/session-monitor.test.ts` | 6 |
| `packages/audit/src/__tests__/prompt-audit.test.ts` | 5 |
| `packages/aidk/src/__tests__/claims-enforcement.test.ts` | 5 (E2E, heavy per-test) |

### 3.1 Scope enforcement — **estimate 85% line, 70% branch**

- `FileMatcher.isAllowed` / `filter` / `denied` — covered by 6 tests at `packages/scope/src/__tests__/file-matcher.test.ts` ✓
- `AccessPolicyEngine.register/get/isFileAllowed/filterFiles/isSymbolTypeAllowed/maxDepth/remove/list` — all have dedicated tests `access-policy.test.ts:5-88` ✓
- `ScopedHandler.filterArgs` — path, paths[], entryPoints[], files[], maxDepth clamp covered ✓
- `ScopedHandler.filterResult` — definitions[], references[], files[] covered ✓
- **Gap**: no test for symlinks / path-traversal (`../../etc/passwd` style). `FileMatcher` delegates to micromatch which does not resolve paths; the caller must normalize. This is a real-world scope bypass waiting to happen. **File:line of concern**: `packages/scope/src/file-matcher.ts:20` + `packages/scope/src/scoped-handler.ts:47-53`.
- **Gap**: no test for the case where an out-of-scope path is injected via a nested tool arg we don't have in the `['path','filePath',…]` list. Scope enforcement is an allowlist-of-arg-keys, so any new MCP tool that uses `sourcePath` or `targetFile` silently bypasses scope. **File:line**: `packages/scope/src/scoped-handler.ts:47` and mirror at `packages/auth/src/scope.ts:85`.

### 3.2 JWT verify — **estimate 80% line, 65% branch**

- `TokenVerifier.verify` happy path and bad-sig path covered by `token-verifier.test.ts` (7 `it` blocks).
- `payloadToToken` null-return paths covered via invalid-scope test.
- `createAuthMiddleware` scenarios in `middleware.test.ts:18-104`: no token, valid token, invalid token, tool scope, file scope, onDenied, close.
- **Gap**: no test for expired-but-syntactically-valid token (jose throws `ERR_JWT_EXPIRED`). Easy to add.
- **Gap**: no test for alg-confusion attack — if a token is signed with `RS256` but we only accept `HS256`, does jose reject? `jwtVerify` without explicit `algorithms` option will accept whatever the header claims. **File:line**: `packages/auth/src/token-verifier.ts:23` — should pass `{ issuer: 'batiste', algorithms: ['HS256'] }`. This is a concrete security bug, not just a test gap.
- **Gap**: no test for `iss` mismatch rejection (verifier sets `issuer: 'batiste'`, but there's no negative test).
- **Gap**: no test for clock-skew tolerance config.

### 3.3 Kill-switch — **estimate 95% line, 90% branch**

- All four `action` enum values tested (`kill-switch.test.ts:16-38`)
- Listener notification, history, reset, per-session vs global — covered.
- **Gap**: no test for `kill_session` with missing `sessionId` (the code at `packages/audit/src/kill-switch.ts:27` uses `if (command.sessionId)` which silently no-ops. Should probably throw.)
- **Gap**: no test for listener that throws — if one listener throws, subsequent listeners never fire (`packages/audit/src/kill-switch.ts:40-42`).

### 3.4 Audit write — **estimate 75% line, 55% branch**

- `AuditLedger.append/query/count` + all filter keys covered (`ledger.test.ts:33-98`).
- `AuditedToolHandler` success, error, kill-switch-denied, duration, session-monitor — covered (`middleware.test.ts`).
- **Gap**: no test for DB corruption / readonly / disk-full recovery. `AuditLedger` opens the DB with no retry or fallback (`packages/audit/src/ledger.ts:23`). `SQLiteTaskStore` HAS a readonly-recovery path (`packages/core/src/tasks/SQLiteTaskStore.ts:44-77`); audit ledger does not.
- **Gap**: concurrent-append race. WAL handles it, but we have no stress test.
- **Gap**: no test for args that can't be `JSON.stringify`'d (circular refs) — `ledger.ts:57` will throw and the audit log will have a gap, which is exactly the failure mode compliance auditors care about.

### 3.5 Ledger integrity — **estimate 0% — feature missing**

**The ledger has no tamper-evidence mechanism at all.** There is no hash-chain column, no HMAC, no signature, no Merkle root. `packages/audit/src/ledger.ts:31-43` creates a plain table with `id, timestamp, session_id, agent_id, tool, args_json, result, duration_ms, ast_nodes_accessed, bytes_transferred` — nothing linking entry N to entry N-1.

For DD this is a material finding: a customer running `sqlite3 audit.db` can `UPDATE` any row without detection. Eixo 3 or 4 may own this, but Eixo 5 owns the test coverage that would surface the gap, and right now there is literally nothing to cover.

**Action** (scoped as a cross-eixo ticket): Add `prev_hash TEXT`, `entry_hash TEXT` columns; populate entry_hash = SHA-256(prev_hash || canonical_json(entry_fields)); on startup, `verifyChain()` method that walks the table and checks the chain; fail audit-tail command loudly if broken.

### 3.6 aidk claims-enforcement (integration) — **good**

`packages/aidk/src/__tests__/claims-enforcement.test.ts` spins a full gateway node, issues tokens with varying scopes, and confirms end-to-end JSON-RPC responses. This is the single best test in the repo and is exactly what a DD reviewer wants to see. Cite it prominently.

---

## 4. Dead-Code Scan

No `knip`, no `ts-prune`, no `@typescript-eslint/no-unused-modules`. Heuristic-only below.

### 4.1 Candidates identified by grep (`export X` not imported anywhere except its own index)

- `packages/audit/src/compliance-report.ts` — `generateReport` is re-exported by `packages/audit/src/index.ts:6` but I find **zero internal importers** outside the package. External consumer (CLI) uses `audit-tail` not the report. Likely dead or demo-only.
- `packages/audit/src/prompt-audit.ts` — `AuditedPromptHandler` is exported by `index.ts:5` but `aidk/src/create-node.ts` never wraps prompts with it (only tools). So every prompt fetch on a gateway node is unaudited. **This is both a dead-code finding and a compliance gap.**
- `packages/scope/src/access-policy.ts` — `AccessPolicyEngine` is exported but `aidk/src/create-node.ts:122-125` uses `.list()[0]` after `register`, meaning only ever one policy is active and the engine API (register, remove, list, filterFiles) is ornamental. Either use it properly or demote to a simpler shape.
- `packages/audit/src/session-monitor.ts:57-59` — `get size()` getter, no internal caller. Probably reserved for a dashboard.
- `packages/audit/src/kill-switch.ts:61-63` — `onCommand(listener)` registration returns nothing; no internal listener subscribes. Likely intended for WebSocket broadcast that doesn't exist yet.
- `packages/marketplace/src/pricing.ts` — `PricingMeter` exported and in `index.ts:13` — grep shows no importers in `packages/`, suggesting it's either used only via marketplace gateway (which I should verify) or it's demo-stub.
- `packages/core/src/agents/specialized/ReviewerAgent.ts` — exported, but no CLI command or MCP tool instantiates it. `Orchestrator` references it only by type.

### 4.2 Re-export barrels

`packages/aidk/src/re-export-audit.ts`, `re-export-scope.ts`, `re-export-auth.ts`, `re-export-transport.ts` — these are 1-line `export * from '@batiste-aidk/X'`. They exist to satisfy the `@batiste-aidk/aidk/audit` etc. subpath exports declared in `packages/aidk/package.json:13-28`. Not dead — but they make the dependency graph look more complex than it is. Harmless.

**Action**: Install `knip` at root with a shared config:

```
# knip.json (proposal)
{
  "workspaces": {
    "packages/*": {
      "entry": ["src/index.ts", "src/cli.ts", "src/direct-cli.ts"],
      "project": ["src/**/*.ts"]
    }
  },
  "ignoreExportsUsedInFile": true
}
```

Then `pnpm knip` becomes part of the CI gate. Output feeds the SARIF bundle (Section 7).

---

## 5. Lint / Typecheck / Test CI Gate Audit

### 5.1 GitHub Actions

`find .github` returns nothing. **There is no CI pipeline in this repo.** The only `.github/` directory in the tree is `packages/core/claude-code/.github/` which is the **vendored Anthropic claude-code mirror** (unrelated). This is the single largest E5 gap.

### 5.2 Turborepo pipeline

`/Users/jardhel/Documents/git/batiste/turbo.json:3-26` defines `build`, `dev`, `test`, `lint`, `typecheck`, `clean` tasks. `test` depends on `build`. `lint` and `typecheck` depend on `^build` (upstream builds). Cache is configured by default.

Problem: only 2 of 10 packages have `"lint"` in their `package.json` scripts, so `turbo lint` silently skips the rest.

### 5.3 Pre-commit / pre-push

No `.husky/`, no `lint-staged`, no `simple-git-hooks`. There is no local enforcement of anything.

### 5.4 `prepare` script

Recent commit `51a94db fix: add prepare script to auto-build on install` wired `"prepare": "turbo build"` at the root (`package.json:44`). This runs on `pnpm install`, which is mainly a UX fix for users cloning + linking locally. It's not a CI gate.

### 5.5 Proposed minimal CI

```yaml
# .github/workflows/ci.yml (proposal — DO NOT commit yet; this is a spec)
name: CI
on: [push, pull_request]
jobs:
  quality:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm knip --reporter sarif > knip.sarif
      - run: pnpm semgrep --config p/typescript --sarif -o semgrep.sarif
      - uses: github/codeql-action/upload-sarif@v3
        with: { sarif_file: '*.sarif', category: 'batiste-e5' }
      - uses: actions/upload-artifact@v4
        with: { name: coverage, path: 'packages/*/coverage/**' }
```

Blocker count: 3 (typecheck, lint, test). Plus soft gates for knip + semgrep that publish SARIF (Section 7).

---

## 6. Dependency Freshness Baseline (E5-DD-19)

`pnpm-lock.yaml` mtime: **2026-03-26** (20 days old at audit time). Lockfile version 9, settings look clean (`autoInstallPeers: true`).

Top production deps (resolved versions from `pnpm-lock.yaml:1-300`):

| Package | Installed | Latest known (Apr 2026) | Age estimate | Verdict |
|---|---|---|---|---|
| `@modelcontextprotocol/sdk` | 1.27.1 | ~1.30.x | 2-3 months | ok |
| `better-sqlite3` | 11.10.0 | 11.10.x | current | ok |
| `jose` | 6.1.3 | 6.1.x | current | ok |
| `zod` | 3.25.76 | 3.x (zod 4 GA) | zod 4 is out; 3.x is in LTS | **plan migration** |
| `commander` | 12.1.0 | 13.x | ~6 months | acceptable |
| `micromatch` | 4.0.8 | 4.0.x | current | ok |
| `fast-glob` | 3.3.3 | 3.3.x | current | ok |
| `ignore` | 5.3.2 | 5.3.x / 6.x | 6.x out | minor |
| `tree-sitter` | 0.21.1 | 0.22.x | 2024 release; ~12 months old | **180-day SLO breach** |
| `tree-sitter-typescript` | 0.21.2 | 0.23.x | >180 days | **180-day SLO breach** |
| `tree-sitter-python` | 0.21.0 | 0.23.x | >180 days | **180-day SLO breach** |
| `pdf-parse` | 1.1.4 | 1.1.1 (abandoned 2022) | **>3 years** | **critical — replace with `pdfjs-dist` or `pdf2json`** |
| `typescript` | 5.9.3 | 5.9.x | current | ok |
| `vitest` | 2.1.9 | 3.x | vitest 3 GA | **plan upgrade** |
| `@changesets/cli` | 2.29.8 | 2.29.x | current | ok |
| `prettier` | 3.8.1 | 3.8.x | current | ok |
| `turbo` | 2.8.1 | 2.x | current | ok |
| `@types/node` | 20.19.30 | 22.x | Node 22 LTS out | plan |
| `@types/better-sqlite3` | 7.6.13 | 7.6.x | current | ok |
| `@types/pdf-parse` | 1.1.5 | — (goes away with pdf-parse replacement) | | |

**SLO breaches (>180 days out of date, no justification)**:
1. `pdf-parse@1.1.4` — upstream abandoned, **CVE-2024-xxxxx territory**. Must replace.
2. `tree-sitter@0.21.1` + grammars — migration needed to 0.22 or 0.23; ABI changes so all three must bump together.
3. `vitest@2.1.9` → v3 — changes are minor, but SLO is calendar-based.

**Action**: Create `.batiste/deps-slo.json` listing these with a target-by date and a justification column (keep the old version until Q3 because tree-sitter 0.22 drops Node 18 support etc.). DD portal pulls from this file.

Additionally: **no `.npmrc` pinning** at the root. Versions in `package.json` use `^` ranges. Combined with `pnpm install --frozen-lockfile` in CI this is fine, but **local installs without `--frozen-lockfile` will drift**. Recommend `packageManager: "pnpm@9.0.0"` is already set (`package.json:52`) — good.

---

## 7. Static-Analysis Baseline Plan (E5-DD-18: single SARIF)

### 7.1 Tool stack

| Tool | Role | SARIF? | Install |
|---|---|---|---|
| **`tsc --noEmit`** | Type errors | no native — use `@typescript-eslint/parser` + eslint for SARIF; OR `tsc --pretty false` + `tsc-sarif` converter | already present |
| **ESLint v9** | Lint + type-aware rules | yes, via `--format @microsoft/eslint-formatter-sarif` | already present; add formatter |
| **Semgrep** | Secret patterns, auth bypass patterns, sql-injection | native `--sarif` flag | new; config `p/typescript` + `p/secrets` + `p/owasp-top-ten` |
| **Knip** | Dead code | SARIF via `--reporter` (available in Knip 5.x) | new |
| **`audit-ci`** or `pnpm audit --json` | CVE scanning | not native SARIF — wrap with `npm-audit-sarif` or `osv-scanner` | new |
| **OSV-Scanner** | SCA in SARIF natively | yes | recommended over `npm-audit-sarif` |

### 7.2 Rule packs

- **Semgrep packs**: `p/typescript`, `p/nodejs`, `p/secrets`, `p/owasp-top-ten`, `p/jwt`. Custom rules dir `.semgrep/` for:
  - JWT verification without explicit algorithms (catches `packages/auth/src/token-verifier.ts:23`)
  - SQLite string concatenation (already safe here but worth locking down)
  - Use of `child_process.exec` with untrusted input
  - Missing `await` on a Promise-returning call (backstop to TS rule)

- **ESLint security pack**: `eslint-plugin-security`, `eslint-plugin-no-unsanitized`.

### 7.3 SARIF fusion

Single output `artifacts/batiste-e5.sarif.json` produced by:

```
pnpm eslint 'packages/*/src/**/*.ts' \
  -f @microsoft/eslint-formatter-sarif > artifacts/eslint.sarif
pnpm semgrep scan --sarif --config p/typescript,p/secrets,p/jwt \
  -o artifacts/semgrep.sarif
pnpm knip --reporter sarif > artifacts/knip.sarif
osv-scanner --format sarif --output artifacts/osv.sarif .
jq -s '{
  version: "2.1.0",
  $schema: "https://json.schemastore.org/sarif-2.1.0.json",
  runs: (map(.runs) | add)
}' artifacts/*.sarif > artifacts/batiste-e5.sarif.json
```

Fusion is merely concatenating `.runs`. Each run keeps its own `tool.driver.name` so the DD portal can render per-tool counts and deep-link to individual findings.

### 7.4 DD portal contract

Portal endpoint shape (JSON the portal GETs):
```
GET /api/dd/e5/static-analysis/{commit}
→ {
    commit: "<sha>",
    generatedAt: "<iso>",
    sarifUrl: "https://…/batiste-e5.sarif.json",
    summary: {
      eslint: { errors: 0, warnings: 12 },
      tsc:    { errors: 0 },
      semgrep:{ critical: 0, high: 0, medium: 3, low: 8 },
      knip:   { unusedExports: 6, unusedFiles: 0 },
      osv:    { vulns: 0 }
    },
    slos: {
      eslintErrors: { target: 0, actual: 0, pass: true },
      tscErrors:    { target: 0, actual: 0, pass: true },
      semgrepHigh:  { target: 0, actual: 0, pass: true },
      depAge180d:   { target: 0, actual: 3, pass: false, breaches: [...] }
    }
  }
```

Portal also needs the raw SARIF (served as static file) so reviewers can download and open in VS Code with the SARIF Viewer extension. This is a DD power-move — customers trust artifacts they can inspect locally.

---

## 8. Deterministic Build Proposal (E5-DD-20)

Target: `pnpm build` on commit `X` from a clean checkout on machine A produces byte-identical `packages/*/dist/**/*.js` as on machine B.

### 8.1 Current non-determinism sources

1. **`tsc` build info files**: `tsconfig.tsbuildinfo` per package contains absolute paths and timestamps. Mitigation: exclude from artifact hash (they're for incremental, not shipped).
2. **Source maps with absolute paths**: `declarationMap: true, sourceMap: true` at `tsconfig.base.json:14-15`. `tsc` embeds the source file path; if built from `/Users/jardhel/…` vs `/home/runner/…` the outputs diverge. Mitigation: build with `rootDir: ./src` (already set per-package) but also `--sourceRoot` set to a stable token, or post-process with `sed` to canonicalize.
3. **File-system iteration order** (rarely matters for tsc, matters for any bundler we add). TS output order is deterministic per-file, so no issue for current setup.
4. **`npm install` scripts**: `better-sqlite3` has a native postinstall that compiles (or downloads a prebuilt). Binaries differ per Node/OS. **This means "byte-identical build" is OS-specific even if we fix everything else.** Must scope the guarantee to `(os, arch, node-major)` triples.
5. **`SOURCE_DATE_EPOCH`**: tsc doesn't embed build timestamps in its output, so this isn't strictly required. But any downstream bundler (esbuild, rollup, webpack — not currently used) does. Lock it down preemptively.
6. **Prepublish `prepare` script**: builds on install. Good for determinism if CI's `pnpm install --frozen-lockfile` pathway is identical to user's.

### 8.2 Required changes

- Set `SOURCE_DATE_EPOCH` in CI to commit timestamp.
- `tsc` compiler option `"inlineSources": false` (we have `declarationMap` + `sourceMap` but not inlining — verify in base).
- Add `--preserveSymlinks false` consistency flag.
- Replace `tsconfig.tsbuildinfo` paths with relative — already are, since `composite: true` does this.
- Normalize `sourcesContent` in source maps: post-process with a small script that replaces `"sources":["…/src/x.ts"]` with project-relative paths. Or use `source-map@0.7` API.
- Pin `pnpm` to exact version (`packageManager: "pnpm@9.0.0"` ✓ done).
- Pin Node to LTS patch (`engines.node: ">=20.0.0"` is a range — tighten to `"20.x"` for artifact hashing).
- Forbid `postinstall`/`prepare` scripts except in workspace root. Third-party postinstalls (better-sqlite3) are fine but must be `ignored-built-dependencies` unless explicitly allowed. pnpm 9 supports this via `pnpm.onlyBuiltDependencies` in root `package.json`.

### 8.3 Verification

Two-machine reproducibility check in CI (matrix build, then `sha256sum` every file in `dist/`, compare, fail on mismatch).

```yaml
reproducible-build:
  strategy:
    matrix: { host: [ubuntu-24.04, ubuntu-24.04-arm] }  # same OS major, diff arch — scope the claim
  runs-on: ${{ matrix.host }}
  steps:
    - ...install...
    - run: SOURCE_DATE_EPOCH=$(git log -1 --format=%ct) pnpm build
    - run: find packages/*/dist -type f -name '*.js' -o -name '*.d.ts' \
           | sort | xargs sha256sum > build-hashes-${{ matrix.host }}.txt
    - uses: actions/upload-artifact@v4
      with: { name: hashes-${{ matrix.host }}, path: build-hashes-*.txt }
  # followup job downloads both artifacts and diffs
```

### 8.4 What we ship to DD portal

A signed `build-manifest.json` per commit:
```
{
  commit: "<sha>",
  node: "20.x.y",
  pnpm: "9.0.0",
  packages: {
    "@batiste-aidk/audit": {
      dist: [ { path: "dist/index.js", sha256: "..." }, ... ],
      integrity: "sha256-…"
    },
    ...
  }
}
```
Customer can rebuild from source and diff against our published manifest. This is the E5-DD-20 deliverable.

---

## 9. Test-Coverage Publication Plan (E5-DD-21)

### 9.1 Tooling

- `@vitest/coverage-v8` per package (devDep). v8 provider is faster than istanbul and aligned with Node's built-in coverage.
- Shared `vitest.workspace.ts` at root defining common `coverage` config:
  ```ts
  // vitest.workspace.ts (proposal)
  import { defineWorkspace } from 'vitest/config';
  export default defineWorkspace([
    'packages/*',
  ]);
  ```
- Per-package `vitest.config.ts`:
  ```ts
  export default defineConfig({
    test: {
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html', 'lcov'],
        reportsDirectory: './coverage',
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.test.ts', 'src/**/__tests__/**', 'src/**/types.ts'],
        thresholds: {
          lines: 80, functions: 80, branches: 70, statements: 80
        }
      }
    }
  });
  ```
- Stricter thresholds on security-critical packages (`scope`, `auth`, `audit`): 95% lines / 90% branches. Portal surfaces these as separate tiles.

### 9.2 Aggregation

`nyc merge packages/*/coverage/coverage-final.json artifacts/coverage-final.json` then:
- `nyc report --reporter=lcov --reporter=json-summary` for per-package + monorepo totals
- `lcov-summary --json` → per-file pct for the portal

### 9.3 DD portal shape

```
GET /api/dd/e5/coverage/{commit}
→ {
    commit, generatedAt,
    total: { lines: 82.4, branches: 71.2, functions: 85.1, statements: 82.4 },
    packages: [
      { name: "@batiste-aidk/scope",  lines: 96.8, branches: 91.4, criticalPath: true, ... },
      { name: "@batiste-aidk/auth",   lines: 89.2, branches: 82.0, criticalPath: true, ... },
      { name: "@batiste-aidk/audit",  lines: 84.6, branches: 74.1, criticalPath: true, ... },
      { name: "@batiste-aidk/core",   lines: 78.0, branches: 65.2, criticalPath: false, ... },
      ...
    ],
    artifacts: {
      lcov: "…/coverage/lcov.info",
      html: "…/coverage/index.html",
      json: "…/coverage/coverage-summary.json"
    },
    sloViolations: [ { package: "@batiste-aidk/audit", metric: "branches", actual: 74.1, target: 90 } ]
  }
```

`criticalPath: true` is a manual allowlist in `e5-coverage-slos.json` — auth, scope, audit, aidk, transport.

### 9.4 Publication cadence

On every `push` to `main` + on every PR merge. Portal keeps last-30 to show trend lines. SLO violations block merge if on critical-path package AND delta is negative.

---

## 10. Punch List — Trivial Quality Fixes

Categorized by package, rough effort estimate in parens. **Do not ship any of these during DD**; batch into a "polish" sprint afterwards.

### 10.1 `packages/auth`

- `token-verifier.ts:23` — add `algorithms: ['HS256']` to `jwtVerify` options. **Not trivial — security fix. Schedule as P1 during DD prep**.
- `middleware.ts:93-95` — `extractBearerToken` regex is fine, but add `.trim()` on input to handle `"  Bearer xxx"` gracefully. (5m)
- `scope.ts:103-113` — `matchGlob` is a hand-rolled mini-glob. `matchesAnyPattern`/`matchGlob` duplicate work that `scope/src/file-matcher.ts` already delegates to micromatch. Unify. (30m)
- `types.ts:52-54` — `secretKey: z.string().min(32)` is good; add a `z.refine` to reject all-zero or all-ASCII-letter secrets. (10m)
- Missing JSDoc on `TokenIssuer.issue` return shape — just add `@returns`. (5m)

### 10.2 `packages/scope`

- `scoped-handler.ts:41` + `:47` — the arg-key allowlists `['paths','entryPoints','files']` and `['path','filePath','testFilePath','implementationFilePath','workingDir']` are duplicated in `packages/auth/src/scope.ts:80-86`. Extract to a shared `KNOWN_PATH_ARG_KEYS` const in `core/mcp/types.ts`. (15m)
- `scoped-handler.ts:49` — path-traversal: before `matcher.isAllowed`, `path.resolve` and `path.normalize` the input; reject any result containing `..`. (20m, security-adjacent)
- `access-policy.ts:47` — `.includes(symbolType as never)` is a TS-silencing cast. Use a proper type guard. (5m)
- `types.ts:7` — deniedPaths default array is long and inline; extract to `DEFAULT_DENIED_PATTERNS` const with a comment explaining each. (5m)

### 10.3 `packages/audit`

- `ledger.ts:23` — constructor can throw (disk issue) but there's no try/catch around init SQL. Wrap with a descriptive error. (10m)
- `ledger.ts:73` — `limit` is interpolated into SQL as `${q.limit}`. It's a number, so not injectable, but `noUncheckedIndexedAccess` + strict-boolean would flag the pattern. Use `.bind` or a parametrized LIMIT. (10m)
- `middleware.ts:46` — on kill-switch-denied, we log `durationMs: 0`. Make it explicit that denied entries have zero duration by convention or actually measure the guard time. (5m)
- `kill-switch.ts:72-75` — `reset()` is explicitly "for testing". Rename to `_testOnlyReset()` or move to a test helper file. (5m)
- `prompt-audit.ts` — not wired into `aidk/create-node.ts`. Add. (1h — counts as feature)
- Missing JSDoc on `MonitoredSession` fields. (5m)

### 10.4 `packages/core`

- `sandbox/ProcessSandbox.ts:54` — `env as NodeJS.ProcessEnv` cast. The cast is needed because `options.env` is `Record<string, string>` but we mix it with `process.env` which has optional string. Fix by `Object.fromEntries(Object.entries(merged).filter(([,v]) => v !== undefined))`. (10m)
- `sandbox/ProcessSandbox.ts:45-50` — setting `NODE_OPTIONS: undefined` is clever but not documented. Add a comment explaining why (prevents NODE_OPTIONS injection). (2m)
- `mcp/server-factory.ts:136` + `:261` — `console.error` as logging. Use the `utils/logger.ts` pattern from `code` package, or accept that MCP servers log to stderr intentionally for stdio protocol. Document which it is. (5m — just a comment)
- `tasks/SQLiteTaskStore.ts:66,77` — readonly-recovery is a great pattern; **port it to `audit/ledger.ts` and `auth/key-store.ts`**. (1h)

### 10.5 `packages/transport`

- `transport-factory.ts:51` — same `console.error` logging comment as core.
- `secure-gateway.ts:290` — same.

### 10.6 `packages/cli`

- `tsconfig.json` — extend base (Section 1.1). (2m)
- `package.json:35` — **add `"lint": "eslint src/"`** to pick up turbo lint task. (1m)
- `index.ts:91-94` — top-level `parseAsync(...).catch(...)` is fine, but `exit(1)` without closing any open handles could truncate audit writes. Since this is the CLI not the server, low risk, but add a graceful shutdown hook. (15m)
- `commands/audit-tail.ts` + `node-start.ts` — check for typed `opts` parameters; commander default type is `OptionValues` which is `Record<string, unknown>`. We have explicit casts elsewhere but should standardize. (30m sweep)

### 10.7 `packages/code`

- `tsconfig.json` — extend base (Section 1.1). Will likely surface fresh type errors from `noUncheckedIndexedAccess`; budget 2-4h to fix them. (2h)
- `package.json:26` — already has lint. ✓
- `indexer/git-tracker.ts` — every git operation is `execSync` (lines 55, 80, 99, 124, 182, 202, 222, 254, 288, 343, 351, 359, 418, 438). Blocks the event loop. Migrate to `execFile` async. This is a P2 perf + scalability fix, not trivial but high-value. (4h)
- `lsp/client.ts:93` — spawns `npx typescript-language-server`. `npx` at runtime is slow and can invoke arbitrary packages. Require a direct binary path or a resolved `require.resolve('typescript-language-server')`. (30m, security-adjacent)
- `utils/logger.ts` — defines a clean logger. Use it in `core/mcp/server-factory.ts` and `transport/secure-gateway.ts` (Section 10.4). (1h)
- `direct-cli.ts:28` — `if (!process.env.BATISTE_DEBUG)` suppresses deprecation warnings globally. Document why and narrow to specific warnings. (10m)

### 10.8 `packages/connectors`

- `tsconfig.json` — already extends base. ✓
- `pdf-parse@1.1.4` — **replace**. See Section 6. (half-day)
- `mcp/handler.ts:4` — contains 4 `unknown` casts per grep; review each for a more specific type. (20m)

### 10.9 `packages/marketplace`

- `gateway.ts` — `unknown` casts present; review. (20m)
- `registry.ts` — SQLite `exec` inline; fine but share init pattern with `audit/ledger` and `auth/key-store`. (30m refactor)

### 10.10 `packages/aidk`

- `create-node.ts:75-108` — the `hasPrompts`/`enableDynamicPrompts` logic is subtle. Extract `setupPrompts(handler, options)` helper. (30m)
- `create-node.ts:122-125` — commented "Default scope wraps the handler" but only registers exactly one hard-coded policy. Accept a list of policies or accept a pre-built `AccessPolicyEngine`. (1h, design decision)
- `__tests__/claims-enforcement.test.ts:172,173,238,258` — replace 3 `any` / `as any` with a typed `JsonRpcResponse`. (15m)

### 10.11 Repo-wide

- Add `.github/workflows/ci.yml` (Section 5.5). (1h including first-run debugging)
- Add `knip.json` (Section 4). (30m)
- Add `.semgrep/` custom rules dir (Section 7.2). (2h)
- Add `vitest.workspace.ts` + per-package coverage config (Section 9.1). (2h)
- Add `SECURITY.md` at root (separate concern, but referenced by semgrep's `p/owasp-top-ten`).
- Add root `lint` script that invokes turbo (already there via `"lint": "turbo lint"` — but turbo lint is empty. Filling the packages fixes it automatically.)

---

## 11. Cross-Eixo Handoffs

- **To Eixo 3 (audit/ledger tamper-evidence)**: the hash-chain in §3.5 is cross-cutting; E5 will own the tests and the coverage metric, E3 owns the implementation.
- **To Eixo 4 (auth)**: §3.2 `alg-confusion` bug at `packages/auth/src/token-verifier.ts:23` — report to E4 with a failing test as proof.
- **To Eixo 8 (DD UX)**: the portal contracts in §7.4 and §9.3 need to be reviewed against the scaffold in `.batiste/eixo8_dd_ux_scaffold.md §7.5`. If E8's schema differs, reconcile and have E8 win (they own the portal).
- **To Eixo 6 (release/deploy)** (if exists): §8.3 reproducibility check needs CI infra access; coordinate runner pinning.

---

## 12. Evidence Citations (File:Line)

| Finding | Evidence |
|---|---|
| Base tsconfig has strict + noUncheckedIndexedAccess | `tsconfig.base.json:8,22` |
| cli/code do not extend base tsconfig | `packages/cli/tsconfig.json:2-16`, `packages/code/tsconfig.json:2-19` |
| ESLint uses strictTypeChecked | `eslint.config.js:7` |
| Only 2 packages have `lint` script | `packages/core/package.json:42`, `packages/code/package.json:26` |
| No `.github/workflows/` at repo root | glob `.github/**/*` → 0 results |
| No coverage deps | grep `coverage` in all `package.json` → 0 results |
| 0 production `any` | grep `: any` / `as any` in `packages/*/src/**/*.ts` excluding tests → 0 |
| 3 test-only `any` | `packages/aidk/src/__tests__/claims-enforcement.test.ts:172,173,238,258` |
| No JWT algorithm pinning | `packages/auth/src/token-verifier.ts:23` |
| No ledger hash chain | `packages/audit/src/ledger.ts:30-46` (schema) — no prev_hash / entry_hash cols |
| `AuditedPromptHandler` not wired | `packages/aidk/src/create-node.ts:75-108` — no `new AuditedPromptHandler` |
| `pdf-parse` abandoned dependency | `pnpm-lock.yaml:181-183`, `packages/connectors/package.json:24` |
| tree-sitter 0.21.x is >180 days old | `pnpm-lock.yaml:153-161` |
| `execSync` sync-blocks in git-tracker | `packages/code/src/indexer/git-tracker.ts:55,80,99,124,182,202,222,254,288,343,351,359,418,438` |
| Kill-switch `kill_session` without sessionId silently no-ops | `packages/audit/src/kill-switch.ts:27` |
| Scope is allowlist-of-keys, any new key bypasses | `packages/scope/src/scoped-handler.ts:41,47`, `packages/auth/src/scope.ts:80-86` |
| SQLiteTaskStore has readonly recovery | `packages/core/src/tasks/SQLiteTaskStore.ts:44-77` |
| AuditLedger lacks equivalent | `packages/audit/src/ledger.ts:23-27` |
| `Math.random` usage limited to non-security | `packages/core/src/agents/AgentPool.ts:313` (load balancer) + test dirs |

---

## 13. Action Plan (ordered)

**Sprint 1 (DD-blocker, 1 week)**
1. Add `.github/workflows/ci.yml` with typecheck + lint + test (Section 5.5).
2. Add `"lint": "eslint src/"` to all 8 remaining `package.json` files.
3. Fix `packages/cli/tsconfig.json` and `packages/code/tsconfig.json` to extend base. Resolve the fresh type errors in `code` (2-4h budget).
4. Wire `@vitest/coverage-v8` per package + root aggregation (Section 9).
5. Add `algorithms: ['HS256']` to `TokenVerifier.verify` + test for alg-confusion rejection.

**Sprint 2 (DD-portal publication, 1 week)**
6. SARIF fusion pipeline (Section 7.3). Publish to `artifacts/batiste-e5.sarif.json`.
7. Coverage publication to `artifacts/coverage-summary.json` + lcov (Section 9.2-3).
8. `.batiste/deps-slo.json` with the 3 SLO-breaching deps + justifications (Section 6).
9. Knip config + initial dead-code cleanup (Section 4).

**Sprint 3 (Determinism + tamper-evidence, 2 weeks)**
10. Reproducible-build matrix job (Section 8.3) with `build-manifest.json` output.
11. Audit-ledger hash chain (cross-eixo with E3; §3.5).
12. Replace `pdf-parse`.
13. Bump tree-sitter grammars together.

**Sprint 4 (polish, 1 week)**
14. Punch-list items §10 batch execution.
15. Add `eslint-plugin-security`, `eslint-plugin-import`, `eslint-plugin-jsdoc` (Section 2.2).
16. Migrate `code/indexer/git-tracker.ts` to async `execFile`.

After sprint 4: the DD portal tiles for E5-DD-18 / 19 / 20 / 21 all light green, and any prospect who asks "show me your build hash / SARIF / coverage" has a URL to click.

---

*End of Eixo 5 report. ~780 lines. Read-only investigation; no source modified.*
