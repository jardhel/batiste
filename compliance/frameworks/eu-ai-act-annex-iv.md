# EU AI Act — Annex IV Technical Documentation (template)

> Required when Batiste is used as a safety-relevant component inside a high-risk AI system under Annex III. Populate per release. Publish with the release artefact.

**Provider:** <customer's legal entity if they are the provider; or Cachola Tech if Batiste is distributed as a stand-alone high-risk AI system>
**Product:** Batiste — Zero-trust middleware for AI agents
**Version:** v0.1.0
**Release date:** 2026-04-20
**Intended purpose:** Enforce Scope / Auth / Audit / Kill switch guarantees on agent tool calls.

## 1. General description (Annex IV(1))

### 1.1 Intended purpose

### 1.2 Previous and related versions

### 1.3 Interactions with hardware or other software

### 1.4 User instructions and, when applicable, installation instructions

Reference: `/README.md`, `/docs/COWORK.md`.

## 2. Detailed description of elements (Annex IV(2))

### 2.1 Design specifications

### 2.2 General logic of the system

Describe the three-layer chain (Scope → Auth → Audit) and the kill switch path. Diagram: reference `/ARCHITECTURE.md`.

### 2.3 Main choices and trade-offs

### 2.4 System architecture

### 2.5 Datasets used

If the release includes model assets, list them with origin, size, licence, and any filtering applied.

### 2.6 Human oversight measures (Art. 14)

See `policies/ai-governance-policy.md` §6.

### 2.7 Predetermined changes to the system

Explain how changes (post-market updates, OTA) are managed (`policies/change-management-policy.md`).

### 2.8 Validation and testing procedures

Reference: 446-test suite, property tests for Scope, CI gates.

### 2.9 Cybersecurity measures (Art. 15(4))

Reference: `mappings/batiste-to-controls.md`.

## 3. Detailed information on monitoring, functioning and control (Annex IV(3))

- Capabilities and limitations:
- Expected accuracy levels:
- Foreseeable misuse and mitigations:

## 4. Risk management system description (Annex IV(4))

Reference: `policies/ai-governance-policy.md` §2 and `.batiste/eixo3_security_hardening.md`.

## 5. Description of changes through the lifecycle (Annex IV(5))

Changelog pointer: `/CHANGELOG.md` or GitHub releases.

## 6. Standards applied (Annex IV(6))

- ISO/IEC 27001:2022
- ISO/IEC 42001:2023 (AIMS structure)
- CEN/CENELEC AI Act harmonised standards (track publication; update this list)

## 7. EU declaration of conformity (Annex IV(7))

Keep the signed declaration at `compliance/declarations/<version>.pdf`. One per release.

## 8. Post-market monitoring plan (Annex IV(8); Art. 72)

- Incident sources monitored:
- Metrics reviewed:
- Reporting cadence:
- Serious incidents reporting channel: national market surveillance authority (Art. 73).

## 9. List of harmonised standards (Annex IV(9))

Populate when the harmonised standards list publishes.

## 10. Declaration of conformity (Annex IV(10))

Signed and dated; customer-facing copy in `/compliance/declarations/<version>.pdf`.
