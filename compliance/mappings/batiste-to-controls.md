# Batiste → Control ID Mapping

> The single document an auditor needs. Every Batiste feature, every control it satisfies, every piece of evidence that proves it.

## How to read this

Each row: **Batiste feature → evidence artifact → control IDs across all applicable frameworks**.

Abbreviations: `SOC2` = Trust Services Criteria · `ISO` = ISO/IEC 27001:2022 Annex A · `NIS2` = Directive 2022/2555 Art. 21 · `DORA` = Regulation 2022/2554 · `GDPR` = Regulation 2016/679 · `AIA` = EU AI Act (Reg. 2024/1689).

## 1. Scope layer — path-based access enforcement

| Feature | Evidence | SOC2 | ISO | NIS2 | DORA | GDPR | AIA |
|---|---|---|---|---|---|---|---|
| Glob deny-list evaluated pre-handler | `packages/scope/src/policy.ts`, deny-list PR review log | CC6.1, CC6.3 | A.5.15, A.5.18, A.8.3 | Art. 21(2)(i) | Art. 9(4)(c) | Art. 25(2), Art. 32(1)(b) | Art. 15(4) |
| AST-level scope enforcement (`@batiste-aidk/graph`) | Unit tests `packages/scope/src/__tests__/ast-deny.test.ts` | CC6.1, CC6.8 | A.8.3, A.8.28 | Art. 21(2)(i) | Art. 9(4)(c) | Art. 25 | Art. 15(4) |
| Depth caps on directory traversal | `ScopePolicy.maxDepth` config, integration tests | CC6.6 | A.8.23 | Art. 21(2)(i) | Art. 9(4)(c) | Art. 32(1)(b) | — |
| Symbol-type filters (class/fn/etc.) | `policies/access-control-policy.md` §3.2 | CC6.3 | A.5.15 | Art. 21(2)(i) | Art. 9(4)(c) | — | Art. 15(4) |

**Auditor takeaway:** Access control is code, not configuration. A tool call with a path outside scope is unreachable — the handler function is never invoked. This satisfies the "default deny" requirement across all frameworks.

## 2. Auth layer — JWT verification

| Feature | Evidence | SOC2 | ISO | NIS2 | DORA | GDPR | AIA |
|---|---|---|---|---|---|---|---|
| JWT signature + expiry verification | `packages/auth/src/verify.ts`, test matrix | CC6.1, CC6.6 | A.5.16, A.5.17, A.8.5 | Art. 21(2)(i) | Art. 9(4)(d) | Art. 32(1)(b) | — |
| Short-lived token rotation | `packages/auth/src/issuer.ts` (default TTL 15 min) | CC6.1 | A.8.5 | Art. 21(2)(i) | Art. 9(4)(d) | Art. 32 | — |
| Algorithm pinning (allowlist RS256/EdDSA) | `packages/auth/src/verify.ts` `ALLOWED_ALGS` | CC6.1 | A.8.24 | Art. 21(2)(h) | Art. 9(4)(e) | Art. 32(1)(a) | — |
| Clock-skew tolerance bounded | Config `authSkewMs` ≤ 60 s | CC6.1 | A.8.5 | — | — | — | — |

**Auditor takeaway:** Authentication failure modes are tested exhaustively (tampered signature, expired token, disallowed algorithm, future `iat`). The ledger records every failure with reason code.

## 3. Audit layer — append-only ledger

| Feature | Evidence | SOC2 | ISO | NIS2 | DORA | GDPR | AIA |
|---|---|---|---|---|---|---|---|
| Append-only SQLite WAL | `packages/audit/src/ledger.ts`, schema migration 001 | CC7.2, CC7.3 | A.8.15, A.8.16 | Art. 21(2)(c), Art. 23 | Art. 10, Art. 17 | Art. 30, Art. 32(1)(d) | Art. 12, Art. 14(2)(a) |
| Per-entry monotonic sequence + BLAKE3 chain | `packages/audit/src/hashchain.ts`, verify CLI | CC7.2 | A.8.15 | Art. 21(2)(c) | Art. 10(3) | Art. 5(1)(f), Art. 32 | Art. 12(2) |
| NDJSON deterministic export | `runbooks/audit-evidence-export.md` | CC7.3 | A.8.15 | Art. 23 | Art. 17 | Art. 30 | Art. 12 |
| Minimum retention 6 y (configurable) | `.batiste/config.yaml` `auditRetentionDays` | A1.2 | A.5.33 | Art. 21(2)(c) | Art. 12 | Art. 5(1)(e) | Art. 12(1) |

**Auditor takeaway:** The audit trail is tamper-evident (hash-chained) and non-destructive (WAL append-only). Retention defaults exceed the longest framework requirement (DORA Art. 12 — retention of ICT logs). Evidence export is byte-reproducible.

## 4. Kill switch — emergency revocation

| Feature | Evidence | SOC2 | ISO | NIS2 | DORA | GDPR | AIA |
|---|---|---|---|---|---|---|---|
| `KillSwitch.fire()` revokes all sessions < 1 ms | `packages/audit/src/kill-switch.ts`, bench `kill-switch.bench.ts` | CC7.4, A1.2 | A.5.24, A.5.26, A.5.30 | Art. 21(2)(b), (c) | Art. 11, Art. 12(3) | Art. 32(1)(c), Art. 33 | Art. 15(4) |
| Quarterly drill (documented) | `runbooks/kill-switch.md` §4 | CC7.5 | A.5.24 | Art. 21(2)(f) | Art. 11(6) | — | — |
| Ledger entry on fire + on reset | `packages/audit/src/kill-switch.ts` `logFired()` | CC7.3 | A.8.15 | Art. 23 | Art. 17 | Art. 33(5) | — |

**Auditor takeaway:** Business-continuity requirement "ability to isolate affected systems" (DORA Art. 11(2)(f), NIS2 Art. 21(2)(c)) is satisfied by an engineered primitive, not a procedure.

## 5. Pricing meter — billing + usage accounting

| Feature | Evidence | SOC2 | ISO | NIS2 | DORA | GDPR | AIA |
|---|---|---|---|---|---|---|---|
| Per-cycle PricingMeter output reconciled with audit entries | `packages/marketplace/src/pricing-meter.ts`, reconciliation tests | PI1.1, PI1.3 | A.5.34, A.8.15 | — | Art. 10(2) | — | Art. 12(2) |
| Immutable billing records | `packages/marketplace/src/billing-record.ts` | PI1.2 | A.8.15 | — | — | — | — |

## 6. Release engineering

| Feature | Evidence | SOC2 | ISO | NIS2 | DORA | GDPR | AIA |
|---|---|---|---|---|---|---|---|
| Signed releases (sigstore/cosign) | GitHub release artifacts `*.sig` | CC7.1, CC8.1 | A.8.30, A.8.32 | Art. 21(2)(e) | Art. 9(4)(f) | Art. 32 | Art. 15(1) |
| SBOM (CycloneDX) per release | `sbom.cdx.json` attached to each GH release | CC7.1 | A.8.30 | Art. 21(2)(j) | Art. 28(4) | — | Art. 15(1) |
| Reproducible build | `pnpm build --frozen-lockfile`, `turbo.json` cache keyed on input hash | CC8.1 | A.8.32 | Art. 21(2)(e) | Art. 9(4)(f) | — | Art. 12(2) |
| Static analysis + SAST gate | `eslint.config.js`, CI workflow (when published) | CC7.1, CC8.1 | A.8.28, A.8.29 | Art. 21(2)(e) | Art. 9(4)(f) | — | Art. 15(4) |
| Dependency vulnerability gate | `pnpm audit` in CI; `.batiste/eixo5_code_quality.md` | CC7.1 | A.8.8 | Art. 21(2)(e) | Art. 9(4)(f) | — | — |

## 7. Testing & verification

| Feature | Evidence | SOC2 | ISO | NIS2 | DORA | GDPR | AIA |
|---|---|---|---|---|---|---|---|
| 446 tests, no mocks, real SQLite `:memory:` | `README.md` §Technology, test logs | CC7.1, CC8.1 | A.8.29 | Art. 21(2)(e) | Art. 24-26 | — | Art. 15(3) |
| Threat modeling per eixo | `.batiste/eixo3_security_hardening.md` | CC3.2, CC7.1 | A.5.7, A.8.25 | Art. 21(2)(b) | Art. 6 | Art. 32 | Art. 9 |
| Claims enforcement tests (no false security claims) | `packages/aidk/src/__tests__/claims-enforcement.test.ts` | CC1.1 | A.5.2 | — | — | — | Art. 50 |

## 8. Privacy & data minimisation

| Feature | Evidence | SOC2 | ISO | NIS2 | DORA | GDPR | AIA |
|---|---|---|---|---|---|---|---|
| No personal data processed by default | `ARCHITECTURE.md`, `policies/data-protection-policy.md` §2 | C1.1 | A.8.11 | — | — | Art. 5(1)(c), Art. 25 | Art. 10(2) |
| Right-to-erasure tooling | `runbooks/right-to-erasure.md` | C1.2 | A.8.10 | — | — | Art. 17 | — |
| DPIA template ready | `frameworks/gdpr-dpia-template.md` | — | A.5.34 | — | — | Art. 35 | Art. 27 |
| Art. 30 records scaffold | `frameworks/gdpr-art30-records.md` | — | A.5.34 | — | — | Art. 30 | — |

## 9. Vendor / third-party risk

Because Batiste runs air-gapped on-prem, the *Batiste product itself* does not introduce a third-party dependency on our cloud. Customers receive source + SBOM and deploy inside their trust boundary. Our own vendor posture (GitHub, npm registry, signing key authority) is documented in `policies/vendor-management-policy.md` and mapped to DORA Art. 28-30 + ISO A.5.19-23.

## 10. Training & awareness

| Feature | Evidence | SOC2 | ISO | NIS2 | DORA | GDPR | AIA |
|---|---|---|---|---|---|---|---|
| Developer security training (quarterly) | HR records (customer to maintain) | CC1.4 | A.6.3 | Art. 21(2)(g) | Art. 13 | Art. 39(1)(b) | Art. 4 |
| Incident runbook drills | `runbooks/incident-response.md` §Drill | CC7.5 | A.5.24 | Art. 21(2)(g) | Art. 11(6) | — | — |

---

## Cross-reference index (control → section above)

| Control ID | Satisfied by |
|---|---|
| SOC 2 CC6.1 | §1, §2 |
| SOC 2 CC7.2, CC7.3 | §3 |
| SOC 2 CC7.4 | §4 |
| SOC 2 CC8.1 | §6 |
| ISO A.5.15 | §1 |
| ISO A.5.24 | §4, §10 |
| ISO A.5.30 | §4 |
| ISO A.8.15 | §3, §4, §5 |
| ISO A.8.24 | §2, §6 |
| ISO A.8.28 | §1, §6 |
| ISO A.8.30 | §6 |
| NIS2 Art. 21(2)(b) | §4, §7 |
| NIS2 Art. 21(2)(c) | §3, §4 |
| NIS2 Art. 21(2)(e) | §6, §7 |
| NIS2 Art. 23 | §3, §4 (via runbook) |
| DORA Art. 9 | §1, §6 |
| DORA Art. 10 | §3 |
| DORA Art. 11 | §4 |
| DORA Art. 17-19 | runbook |
| DORA Art. 28-30 | vendor policy |
| GDPR Art. 5 | §3, §8 |
| GDPR Art. 25 | §1, §8 |
| GDPR Art. 30 | §3, §8 |
| GDPR Art. 32 | §1, §2, §3, §6 |
| GDPR Art. 33 | §4, runbook |
| GDPR Art. 35 | §8 |
| AIA Art. 9 | §7 |
| AIA Art. 12 | §3, §5 |
| AIA Art. 15 | §1, §6, §7 |
| AIA Annex IV | `frameworks/eu-ai-act-annex-iv.md` |
