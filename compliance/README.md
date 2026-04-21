# Batiste — Compliance & Audit Pack

> **Posture:** Global air-gapped on-prem. Batiste provides the zero-trust framework, runtime, and tamper-evident ledger. The customer owns deployment, key custody, data residency and the legal role of data controller.
>
> **Audience:** European and worldwide auditors (GDPR Art. 58, NIS2 competent authorities, DORA lead overseers, SOC 2 assessors, ISO 27001 registrars, EU AI Act notified bodies) and investor technical due diligence teams.

## Executive summary

Batiste is a zero-trust middleware for AI agents. Every tool call traverses three non-optional layers: **Scope** (path-based deny-list), **Auth** (JWT verification), **Audit** (append-only SQLite WAL). A **Kill Switch** revokes all tokens in < 1 ms. **No telemetry leaves the customer network by default.**

This posture translates into the following compliance claims, each backed by an evidence pointer below:

| Claim | Why it holds | Evidence |
|---|---|---|
| Data never leaves customer network | Connectors (PDF/CSV/ETL) execute in-process; no outbound calls | [`mappings/batiste-to-controls.md` §1](./mappings/batiste-to-controls.md) |
| Complete audit trail | Append-only WAL, exported as immutable NDJSON | [`runbooks/audit-evidence-export.md`](./runbooks/audit-evidence-export.md) |
| Immediate revocation | `KillSwitch.fire()` < 1 ms, drops all sessions | [`runbooks/kill-switch.md`](./runbooks/kill-switch.md) |
| Breach notification ready | Runbook aligned with GDPR Art. 33 (72h) and DORA Art. 19 | [`runbooks/incident-response.md`](./runbooks/incident-response.md) |
| AI Act Annex IV ready | Technical documentation scaffolded and versioned with code | [`frameworks/eu-ai-act-annex-iv.md`](./frameworks/eu-ai-act-annex-iv.md) |

## Document map

```
compliance/
├── README.md                                ← this file (start here)
├── mappings/
│   └── batiste-to-controls.md              ← feature → control ID matrix (the killer doc)
├── runbooks/
│   ├── kill-switch.md
│   ├── audit-evidence-export.md
│   ├── incident-response.md                ← GDPR Art. 33/34 + DORA Art. 19 + NIS2 Art. 23
│   └── right-to-erasure.md                 ← GDPR Art. 17
├── policies/
│   ├── information-security-policy.md      ← ISO 27001 cl. 5.2, SOC 2 CC1
│   ├── data-protection-policy.md           ← GDPR Art. 5, 24, 25
│   ├── ai-governance-policy.md             ← EU AI Act Art. 9-15, 17
│   ├── ai-vendor-policy.md                 ← EU AI Act Arts. 25, 53-55 (GPAI), DORA Art. 28-30, GDPR Art. 28
│   ├── access-control-policy.md            ← ISO 27001 A.5.15-18, SOC 2 CC6
│   ├── cryptography-policy.md              ← ISO 27001 A.8.24, SOC 2 CC6.1
│   ├── incident-response-policy.md         ← ISO 27001 A.5.24-26
│   ├── vendor-management-policy.md         ← DORA Art. 28-30, ISO 27001 A.5.19-23
│   ├── change-management-policy.md         ← ISO 27001 A.8.32, SOC 2 CC8
│   └── business-continuity-policy.md       ← ISO 27001 A.5.29-30, DORA Art. 11
└── frameworks/
    ├── gdpr-art30-records.md               ← Records of processing activities
    ├── gdpr-dpia-template.md               ← Data protection impact assessment
    ├── eu-ai-act-annex-iv.md               ← Technical documentation
    ├── nis2-art21-measures.md              ← Ten cybersecurity risk-management measures
    ├── dora-ict-risk.md                    ← ICT risk management framework (Art. 5-14)
    ├── soc2-tsc-mapping.md                 ← Trust Services Criteria CC1-CC9, A1, C1, PI1
    └── iso27001-annex-a.md                 ← Annex A (2022 edition) controls mapping
```

## Framework coverage

| Framework | Version | Coverage | Evidence location |
|---|---|---|---|
| GDPR | Regulation 2016/679 | Arts. 5, 13-14, 17, 24-25, 28, 30, 32-34, 35 | `frameworks/gdpr-*`, `runbooks/` |
| EU AI Act | Regulation 2024/1689 | Arts. 9-15, 17; Annex IV | `frameworks/eu-ai-act-annex-iv.md`, `policies/ai-governance-policy.md` |
| NIS2 | Directive 2022/2555 | Art. 21 (all 10 measures), Art. 23 (reporting) | `frameworks/nis2-art21-measures.md` |
| DORA | Regulation 2022/2554 | Arts. 5-14 (ICT risk), 17-23 (incident), 25-27 (TLPT), 28-30 (third-party) | `frameworks/dora-ict-risk.md`, `policies/vendor-management-policy.md` |
| SOC 2 | TSP Section 100 (2017 TSC, 2022 points of focus) | Security + Availability + Confidentiality | `frameworks/soc2-tsc-mapping.md` |
| ISO/IEC 27001 | 2022 | Clauses 4-10 + Annex A (93 controls) | `frameworks/iso27001-annex-a.md` |
| ISO/IEC 42001 | 2023 | AIMS high-level structure | referenced in `policies/ai-governance-policy.md` |
| CCPA/CPRA | 2018/2020 | Satisfied via GDPR posture + regional deployment | `policies/data-protection-policy.md` §6 |

## Shared responsibility (air-gapped on-prem)

| Responsibility | Batiste | Customer |
|---|---|---|
| Zero-trust middleware code | ✓ | |
| Audit ledger schema + WAL integrity | ✓ | |
| Kill switch implementation | ✓ | |
| Release signing & SBOM | ✓ | |
| Vulnerability disclosure program | ✓ | |
| Physical hosting | | ✓ |
| Network segmentation | | ✓ |
| Key management (JWT signing, TLS) | Ref. implementation | ✓ (production) |
| Identity provider / SSO integration | Interfaces | ✓ |
| Data subject request handling | Tooling | ✓ (controller) |
| Incident notification to authorities | Runbook | ✓ (controller) |
| Legal bases / lawful processing | | ✓ (controller) |

This table is the single source of truth for the shared-responsibility model and is referenced from every policy and runbook.

## How to use this pack in an audit

1. Start with [`mappings/batiste-to-controls.md`](./mappings/batiste-to-controls.md) — auditors pick a control, the doc tells them which Batiste feature satisfies it and where to find evidence.
2. Pull live evidence with [`runbooks/audit-evidence-export.md`](./runbooks/audit-evidence-export.md) — deterministic NDJSON exports with hash manifest.
3. If a finding, follow [`runbooks/incident-response.md`](./runbooks/incident-response.md).
4. For EU AI Act conformity, populate [`frameworks/eu-ai-act-annex-iv.md`](./frameworks/eu-ai-act-annex-iv.md) per release.
5. For investor DD, share `compliance/` read-only — everything is designed to be shared unchanged.

## Versioning

This pack is versioned with the code. A change to any policy or runbook requires a PR, a changelog entry, and review by the Security Lead. Policy reviews happen annually at minimum (ISO 27001 A.5.1, SOC 2 CC1.4).

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1.0 | 2026-04-20 | J. Cachola | Initial audit pack for seed-stage investor DD + first EU conformity review. |
| 1.0.0 | 2026-04-20 | J. Cachola | Release-aligned with Batiste v1.0.0. Added vendors, key-custody, DSR log, v1.0.0 declaration of conformity, drills + post-mortems indexes, dogfooding session record. |

## Contact

- Security disclosures: `security@cachola.tech` (PGP key in `/SECURITY.md`)
- Data protection: `dpo@cachola.tech`
- Compliance program owner: Jardhel Cachola, Eindhoven NL
