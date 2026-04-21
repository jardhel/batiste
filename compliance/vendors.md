# Vendor Register — Cachola Tech

**Owner:** CEO + Security Lead · **Version:** 0.1.0 · **Last reviewed:** 2026-04-20
**Maps to:** ISO 27001 A.5.19-23, DORA Arts. 28-30, NIS2 Art. 21(2)(d), GDPR Art. 28.

> This register captures every third party that touches Batiste's code, build, signing, or customer relationship. Review annually and whenever a vendor is added, replaced, or loses a critical service line.

## Legend

- **Tier 1 (critical):** loss within 24 h would stop code shipping.
- **Tier 2 (important):** loss within 7 days would stop code shipping.
- **Tier 3 (other):** convenience or low-risk.
- **Role:** processor / infrastructure / custodian / commercial.
- **PD:** does this vendor process personal data on Batiste's behalf?

## Register

| # | Vendor | Jurisdiction | Service | Tier | Role | PD | DPA | Risk review | Exit plan |
|---|---|---|---|---|---|---|---|---|---|
| V1 | GitHub, Inc. (Microsoft) | US | Source hosting, CI, issue tracker | 1 | infrastructure | limited (commit metadata) | yes, SCCs | 2026-04-20 | mirror to Codeberg + local bundle archive (tested) |
| V2 | npm, Inc. (GitHub) | US | Package registry | 1 | infrastructure | no | n/a | 2026-04-20 | lockfile offline cache + verdaccio mirror (tested) |
| V3 | Sigstore community (OIDC to GitHub) | global | Release signing (cosign) | 1 | custodian | no | n/a | 2026-04-20 | offline signing key fallback (documented) |
| V4 | Cloudflare R2 | EU | Release artefact mirror | 2 | infrastructure | no | yes | 2026-04-20 | primary hosting on GitHub Releases; mirror non-critical |
| V5 | Fastmail | AU | Business email | 2 | processor | yes (staff email) | yes | 2026-04-20 | self-hosted Postfix image on standby |
| V6 | 1Password | CA | Secrets vault (non-production) | 2 | custodian | limited | yes | 2026-04-20 | export + HSM custody for production secrets |
| V7 | Tax adviser (KPMG NL) | NL | Accounting, payroll | 2 | processor | yes (HR data) | yes | 2026-04-20 | substitute adviser retained as backup |
| V8 | Stripe | IE/US | Future payments (not yet active) | 3 | processor | yes (when active) | yes, SCCs | — | not active; will re-tier when enabled |
| V9 | Anthropic PBC | US | Foundation model API (Claude) | 1 | processor | limited (prompt content may carry PD) | **pending** — execute before Radaz Phase 1 execution | 2026-04-21 | secondary AI vendor account to be contracted within 30 days (see `policies/ai-vendor-policy.md` §3.4) |

## Sub-processor policy

Sub-processors that touch customer personal data are separately listed at `/docs/sub-processors.md` with 30-day advance-change notice. As of this version, **no sub-processor** processes customer personal data, because Batiste is deployed air-gapped on-prem by default.

## Review cadence

- Tier 1: every 6 months + on material service change + on public breach disclosure.
- Tier 2: yearly.
- Tier 3: yearly (lighter review).

Each review writes an entry in `compliance/vendor-reviews/YYYY-MM-<vendor>.md` with: questionnaire responses, residual risks, remediation deadlines.

## DORA concentration risk note (Art. 29)

Current concentration risk is low:

- Source hosting (GitHub) is mirrored; exit plan tested.
- Package registry (npm) is cached; offline install path exercised in CI.
- Signing (Sigstore) has an offline fallback key.
- No single provider sits on the critical path without a rehearsed substitute.

## Onboarding checklist (new vendor)

- [ ] Purpose documented.
- [ ] Alternatives considered.
- [ ] Security questionnaire (`compliance/vendor-questionnaire.md`) completed and scored.
- [ ] DPA signed if personal data is involved.
- [ ] SCC + Transfer Impact Assessment on file if outside EEA.
- [ ] Risk tier assigned.
- [ ] Listed in this register.
- [ ] Sub-processor list updated (if customer-facing).
- [ ] Exit plan drafted.
