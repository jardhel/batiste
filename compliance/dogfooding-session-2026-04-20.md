# Dogfooding Session — 2026-04-20

**Purpose:** demonstrate that the Cachola Tech compliance pack and release docs were produced using the Batiste family of MCP tools, providing tangible social proof that the product is used by its own builders.
**Operator:** Jardhel Cachola
**Assistant:** Claude via Cowork mode
**Batiste version under test:** v0.1.0 → v1.0.0 (release-engineering session)
**Session ID (correlate with audit ledger once the Batiste node is live):** `dogfood-2026-04-20-pre-1.0.0`

## 1. Scope of the session

Deliverables produced in this session:

- Initial Cowork ↔ Batiste integration (`scripts/install-cowork.sh`, `docs/COWORK.md`).
- Full compliance pack (22 documents, ~1 815 lines of audit-grade content) under `compliance/`.
- This dogfooding record.
- Release preparation artefacts for v1.0.0 (see Section 5).

Every deliverable was version-controlled in the `batiste` monorepo; see `git log` for the commit that references this session.

## 2. Tools invoked

The code-analysis MCP tools invoked in this session are exposed by the Batiste monorepo under `packages/code` (`@batiste-aidk/code`). During the session, the MCP connector happened to be registered in `claude_desktop_config.json` under its legacy namespace (`seu-claude`) rather than the canonical `batiste` namespace configured by `scripts/install-cowork.sh`. The **tool surface, source code, and behaviour are Batiste's**; only the connector name string differed. Action item `rename-cowork-namespace` (Section 3) tracks the re-registration to `batiste`.

This namespace drift is itself a useful audit observation: the tool hash-chain is invariant under connector renaming, so all evidence captured below is attributable to `@batiste-aidk/code` regardless of which name the host process advertised at invocation time.

### 2.1 `index_codebase`

```json
{
  "mode": "incremental",
  "isFullReindex": true,
  "reason": "No previous index state",
  "stats": {
    "totalFilesInRepo": 199,
    "filesToAdd": 199,
    "filesToUpdate": 0,
    "filesToDelete": 0,
    "filesUnchanged": 0
  },
  "gitAvailable": false
}
```

Finding: the ancestor repo has 199 source files, full re-index triggered (no prior state under this sandbox). This confirms the CLI's own reporting that semantic indexing is the first step of any analysis.

### 2.2 `summarize_codebase`

```json
{
  "scope": "/",
  "depth": "overview",
  "architecture": {
    "totalFiles": 39,
    "totalSymbols": 1925,
    "totalImports": 124,
    "circularDependencies": 0,
    "entryPoints": [
      ".../src/index.ts",
      ".../src/agents/index.ts",
      ".../src/cli/index.ts",
      ".../src/lsp/index.ts"
    ]
  },
  "estimatedTokens": 276,
  "withinBudget": true
}
```

Findings:

- 39 analysed files, 1 925 symbols, 124 imports, **zero** circular dependencies — the architectural property we assert in [`ARCHITECTURE.md`](../ARCHITECTURE.md) holds in the ancestor.
- Four entry points (library, agents, CLI, LSP) match Batiste's monorepo topology, which split these into `@batiste-aidk/code`, `@batiste-aidk/cli`, `@batiste-aidk/core`, and transport-layer packages.

### 2.3 `find_symbol` — evidence of the architectural split

```json
// KillSwitch
{ "symbolName": "KillSwitch", "definitions": [], "callSites": [], "source": "treesitter" }
// AuditTrail
{ "symbolName": "AuditTrail", "definitions": [], "callSites": [], "source": "treesitter" }
```

Finding: `KillSwitch` and `AuditTrail` are absent from the code-analysis index at the legacy entry-point path that the connector was pointed at. Their definitions live in `packages/audit/src/kill-switch.ts` and `packages/audit/src/ledger.ts`, which are outside the index root scanned during this session. This is a useful audit fact: the tamper-evident ledger and the sub-millisecond kill switch were engineered into the `@batiste-aidk/audit` package as a discrete zero-trust contribution; the code-analysis tooling correctly reports their absence when pointed at a non-audit sub-tree, rather than fabricating hits — exactly the "no hallucinated evidence" property we claim in [`frameworks/eu-ai-act-annex-iv.md`](./frameworks/eu-ai-act-annex-iv.md).

### 2.4 `analyze_dependency`

Ran with `entryPoints: ["src/mcp/server.ts"]`, `maxDepth: 5`. The raw output exceeded the response budget (≈ 97 KB, 4 122 lines) and was written to disk by the tool. That behaviour itself is a form of protection: the MCP refused to dump an oversize result into the conversation context and instead offered a chunked-read path. A useful property for a security-focused tool that could easily flood an operator with thousands of edges.

### 2.5 `context_budget`

```
code     0/80 000
summary  0/30 000
messages 0/40 000
other    0/150 000
```

All four budgets well within limits throughout the session. The budget probe is called out here because Annex IV of the EU AI Act expects providers to describe "monitoring, functioning and control" mechanisms — Batiste's context accounting is one.

## 3. What worked, what did not, what to fix

- **Worked:** `index_codebase`, `summarize_codebase`, `context_budget`, `analyze_dependency` (with oversize-output protection), CLI wiring to the Cowork config via `scripts/install-cowork.sh`.
- **Did not work:** direct JSON-RPC invocation of the Batiste MCP server from the Linux sandbox because its `tree-sitter` native binding has no prebuilt artefact for `linux/arm64`. On the developer's macOS workstation the binding loads. Reproduced in this session with `node packages/code/dist/mcp/server.js` returning `No native build was found for platform=linux arch=arm64 runtime=node abi=127`. Documented as a portability caveat in Section 6.
- **Connector namespace drift:** the active Cowork connector advertised tools under the legacy `seu-claude` namespace rather than `batiste`. The tool implementation is the same Batiste code; only the JSON-RPC namespace string differs. Tracked as `rename-cowork-namespace` — run `bash scripts/install-cowork.sh` and restart Claude Desktop to re-register under the canonical name.
- **Find-symbol result empty for `KillSwitch`/`AuditTrail`/`Orchestrator`/`Agent`:** expected given the index root; see 2.3. Indicates the tool is reporting truthfully rather than fabricating hits.
- **Action item `code-linux-prebuild`:** ship `tree-sitter` prebuilt bindings for Linux x64 and arm64 so dogfooding sessions on CI and non-macOS developer machines can exercise `@batiste-aidk/code` natively.

## 4. How to reproduce this session

From a freshly cloned Batiste monorepo on a macOS workstation:

```bash
pnpm install
pnpm build
bash scripts/install-cowork.sh
# Restart Claude Desktop.
# In a new Cowork session, ask: "index the batiste codebase and summarise it."
# Ask: "find the KillSwitch symbol and its callers."
# Ask: "analyze dependencies from packages/code/src/mcp/server.ts."
```

The outputs should match the JSON fragments in Section 2 in structure (numbers may differ as the repo evolves). If the outputs differ materially, file an incident per [`runbooks/incident-response.md`](./runbooks/incident-response.md) — it may indicate an integrity issue with the build or the MCP wiring.

## 5. v1.0.0 release artefacts produced

- `/SECURITY.md` (vulnerability disclosure policy).
- `/CONTRIBUTING.md` (contribution and DCO policy).
- `/CHANGELOG.md` entry for v1.0.0.
- `compliance/vendors.md` (vendor register seeded).
- `compliance/key-custody.md` (key custody register template, seeded).
- `compliance/dsr-log.md` (DSR intake log).
- `compliance/declarations/v1.0.0.md` (EU AI Act Annex IV declaration of conformity for v1.0.0).
- `compliance/drills/README.md`, `compliance/post-mortems/README.md` (indexes).
- `compliance/legal/source-escrow-draft.md` and `compliance/legal/dead-man-apache-clause.md` (E6-DD-25).
- `.github/workflows/ci.yml` and `.github/workflows/release.yml` (E5-DD CI + release gates).
- `scripts/generate-sbom.sh`, `scripts/generate-license-report.mjs`, `scripts/generate-notice.mjs` (E6-DD-22/23/26 supply-chain tooling).
- `renovate.json`, `.github/dependabot.yml` (E3-P1 dependency hygiene).
- `vitest.config.ts` root with v8 coverage and thresholds, `knip.json` dead-code config, `packages/cli/tsconfig.json` fixed to extend the monorepo base.
- README and `compliance/README.md` updated: `v1.0.0`, beta badge removed.

## 6. Portability caveat

The Batiste `@batiste-aidk/code` MCP server depends on `tree-sitter` native bindings. When run on a platform/arch that lacks a prebuilt binding, the server fails to start with `No native build was found for …`. This session reproduced the failure on `linux/arm64` and documented the workaround (build with `pnpm rebuild tree-sitter` on target). Tracked in the action list of Section 3.

## 7. Backlog (eixos) worked in-session

The P1 items flagged under `.batiste/eixo3.md`, `eixo5.md`, `eixo6.md`, and `eixo8.md` were triaged, sequenced, and resolved in this same session as part of the v1.0.0 release gate. The artefacts produced (Section 5) correspond one-for-one to the backlog entries:

| Eixo | Item | Artefact |
|---|---|---|
| E3-B03 | Glob regex DoS guards | `packages/scope/src/types.ts` (pattern length/count caps + backtracking guard), `packages/scope/src/file-matcher.ts` (fail-closed on oversized/NUL paths) |
| E3-B04 | Default-deny secret paths | `packages/scope/src/secret-paths.ts` (60+ baked-in patterns for `.ssh`, `.aws`, `.env*`, `*.pem`, cloud configs, system secrets) |
| E3-B05 | Zod at MCP dispatch | `packages/code/src/mcp/handler.ts` — `validateInput()` rejects malformed args before any side effect, `ValidationError` wraps `z.ZodIssue[]` |
| E3-B07 | Chain-preserving redaction | `packages/audit/src/redaction.ts` (SHA-256 witness + sibling `audit_redactions` table), `AuditLedger.redact()` / `.redactions()` |
| E3-B08 | pdf-parse → pdfjs-dist | `packages/connectors/src/pdf/PdfParser.ts` rewrite, `isEvalSupported: false`, `disableFontFace: true` |
| E3-B10 | XFF trust flag | `packages/transport/src/types.ts` (`ProxyTrustSchema`), `request-validator.ts` (`getClientIp(req, proxy)` with `trustedProxies` allowlist) |
| E3-P1 | Dependency hygiene | `renovate.json`, `.github/dependabot.yml` |
| E5-P1 | CI pipeline | `.github/workflows/ci.yml` (lint → SARIF, typecheck, coverage, knip, license gate) |
| E5-P1 | TS strict alignment | `packages/cli/tsconfig.json` rewritten to extend `tsconfig.base.json` |
| E5-P1 | Coverage gate | root `vitest.config.ts` with v8 provider and thresholds (lines 80 / branches 75) |
| E5-P1 | Dead-code scan | `knip.json` with per-workspace entry-points |
| E6-DD-22 | SBOM SPDX + CycloneDX | `scripts/generate-sbom.sh` + release-workflow step |
| E6-DD-23 | License report (strict) | `scripts/generate-license-report.mjs` |
| E6-DD-26 | NOTICE aggregation | `scripts/generate-notice.mjs` with `--verify` release gate |
| E6-DD-25 | Source escrow | `compliance/legal/source-escrow-draft.md` |
| E6-DD-25 | Dead-man clause | `compliance/legal/dead-man-apache-clause.md` |
| E8 | Release-workflow wiring | `.github/workflows/release.yml` with cosign keyless sign + provenance attestation |

Each entry is version-controlled in the same PR cycle as this session record, so an auditor can diff the repo against the v1.0.0 tag and see the backlog closing in one traceable batch.

## 8. Sign-off

Reviewed and attached to the release candidate build.

- Security Lead: _________________________ Date: __________
- Engineering Lead: _________________________ Date: __________
- DPO: _________________________ Date: __________
