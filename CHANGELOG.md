# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] — 2026-04-21

**GVS 0.1 reference implementation — the ledger and the graph are the same substance.** Batiste now ingests and validates any GVS-conforming governance vault out of the box. This is the dogfood² cut: the firm's own Obsidian vault is the first vault Batiste ingests.

### Added

- **`@batiste-aidk/gvs`** — new package. Reference loader and validator for the [Governance Vault Specification v0.1](./specs/gvs-0.1.md).
  - `loadVault(root)` — walks a `NN Axis/` layout, parses YAML frontmatter with a safe schema loader (§14), extracts wikilinks, and returns a typed `Vault` indexed by axis.
  - `validateVault(vault, opts)` — enforces the six §10 rules that do not require external state: frontmatter completeness, axis consistency, wikilink resolution, canonical-path resolution, audit-ref uniqueness, and status consistency. Also enforces the templates catalog (§5.7) and `gvs_version` declaration (§13).
  - Zod schemas per axis: `BaseFrontmatterSchema`, `DecisionFrontmatterSchema`, `RolesFrontmatterSchema`, `MemoryFrontmatterSchema`, `AuditFrontmatterSchema`.
  - Tolerates the YAML-nested-array rendering of `[[wikilinks]]` — GVS spec authors can write `authority: [[Name]]` unquoted and the validator collapses it correctly.
- **`batiste vault` CLI** — new command group in `@batiste-aidk/cli`.
  - `batiste vault validate <path>` — runs the validator and prints a conformance report (pass/fail, per-axis counts, full issue list with severity).
  - `batiste vault index <path>` — prints the vault's note inventory grouped by axis, with `--axis` filter and `--json` machine-readable output.
- **`vault_validate` / `vault_index` MCP tools** — new tools in `@batiste-aidk/code`. Agents can now reason over a GVS-conforming vault as a first-class surface: query the inventory, check conformance, surface broken wikilinks, and cite audit entries directly.

### Dogfood²

- Ran `batiste vault validate` against the Cachola Tech reference vault (`~/Documents/git/cachola_tech/obs_vault/cachola_tech`) during the release. 79 notes across 6 axes; two real conformance issues surfaced (audit notes with non-SHA256 `stamp_hash`), which is exactly the class of issue GVS validation is meant to catch. The spec and the implementation now co-evolve against a live vault — not a toy fixture.

### Changed

- `@batiste-aidk/cli` depends on `@batiste-aidk/gvs` (workspace).
- `@batiste-aidk/code` depends on `@batiste-aidk/gvs` (workspace) to serve the two new MCP tools.

### Notes

- Validation rules (6) *audit-ledger agreement* and (8) *decision immutability* are not yet implemented — they require an operating ledger path and git history respectively, and will land in 1.2.0.
- GVS 0.1 is still a draft (`0.1-draft`). Breaking changes permitted during the `0.x` line; the validator moves in lockstep.

## [1.0.0] — 2026-04-20

**First non-beta release.** Enterprise-ready posture, audit pack, Cowork dogfooding.

### Added

- Full compliance data room under `compliance/` covering GDPR, EU AI Act, NIS2, DORA, SOC 2 and ISO 27001:2022.
- Feature-to-control mapping (`compliance/mappings/batiste-to-controls.md`) — single document that answers every auditor's first question.
- Operational runbooks: kill switch, audit evidence export, incident response (GDPR Art. 33 + NIS2 Art. 23 + DORA Art. 19), right-to-erasure (GDPR Art. 17).
- Nine policies (information-security, data-protection, AI-governance, access-control, cryptography, incident-response, vendor-management, change-management, business-continuity).
- EU AI Act Annex IV technical documentation template.
- GDPR Art. 30 ROPA and DPIA template.
- Cowork integration: `scripts/install-cowork.sh` idempotent installer, `.batiste/cowork-config.example.json`, `docs/COWORK.md`.
- `SECURITY.md` with vulnerability disclosure policy (90-day coordinated disclosure), `CONTRIBUTING.md` with DCO.
- README badges for GDPR, EU AI Act, NIS2, DORA, SOC 2, ISO 27001 readiness.
- Dogfooding record (`compliance/dogfooding-session-2026-04-20.md`) — real tool output captured during this release's preparation.

### Changed

- Graduated from `v0.1.0-beta.1` to `v1.0.0` stable.
- README re-organised; Compliance section added above the Our-Story section.
- Shared-responsibility model formalised (customer vs. Batiste).

### Security

- All existing zero-trust claims backed by evidence pointers in the audit pack.
- Release signing process standardised (sigstore/cosign + CycloneDX SBOM).
- **E3-B03 / E3-B04** — `@batiste-aidk/scope`: baked-in default-deny list for well-known secret paths (`.ssh`, `.aws/credentials`, `.env*`, `*.pem`, `/etc/shadow`, cloud provider configs, and more). Operators can add, never remove. Pattern-count / length / NUL-byte / backtracking guards added to the policy schema; `assertValidPath` exported for reuse. Fail-closed semantics on the matcher.
- **E3-B05** — `@batiste-aidk/code`: Zod input validation enforced at MCP dispatch. Every tool invocation now rejects malformed arguments **before** any side effect, surfacing a structured `INPUT_VALIDATION_FAILED` error for audit.
- **E3-B07** — `@batiste-aidk/audit`: chain-preserving redaction for GDPR Art. 17 right-to-erasure. `AuditLedger.redact()` replaces payloads with a SHA-256-witnessed tombstone and records the redaction itself in a sibling `audit_redactions` table, so erasure is auditable without collapsing the integrity chain.
- **E3-B08** — `@batiste-aidk/connectors`: replaced unmaintained `pdf-parse` with actively-maintained `pdfjs-dist` (Mozilla). `isEvalSupported: false`, `disableFontFace: true` on every parse for additional hardening.
- **E3-B10** — `@batiste-aidk/transport`: explicit proxy-trust config. `X-Forwarded-For` is honoured only when the TCP peer is in the operator-configured `trustedProxies` list; untrusted XFF is ignored. Default is `trustProxy: false` — safe for internet-exposed gateways.
- Dependency hygiene automated: `renovate.json` with security-sensitive package review gate and `.github/dependabot.yml` as fallback.

### Notes

- No breaking changes relative to `v0.1.0-beta.1`. Public API is now considered stable under SemVer.
- Retention defaults for the audit ledger set to 6 years (exceeds DORA Art. 12 requirement).

## [0.1.0-beta.1] — 2026-01-15

Initial public beta. 446 tests passing, marketplace core, CLI, Cowork-adjacent tooling.

[1.1.0]: https://github.com/jardhel/batiste/releases/tag/v1.1.0
[1.0.0]: https://github.com/jardhel/batiste/releases/tag/v1.0.0
[0.1.0-beta.1]: https://github.com/jardhel/batiste/releases/tag/v0.1.0-beta.1
