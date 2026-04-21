# Data Protection Policy

**Owner:** DPO · **Version:** 0.1.0 · **Effective:** 2026-04-20
**Maps to:** GDPR Art. 5, 13, 24, 25, 28, 30, 32-35; ISO/IEC 27701; EU AI Act Art. 10; CCPA §1798.100-.199 (as equivalent).

## 1. Legal role

Batiste (Cachola Tech) is a **processor** when a customer deploys Batiste and routes their personal data through it, and a **controller** only for our own employees, contractors and commercial counterparties. This policy addresses both roles and flags which provisions apply to each.

## 2. Data minimisation (controller and processor)

- The audit ledger records **metadata** by default: actor IDs, scope paths, timings, result codes. It does **not** record the content of files analysed by connectors, unless the customer explicitly enables content capture.
- Connector outputs are ephemeral; caching is opt-in and time-boxed.
- No biometric data, no special category data (Art. 9), no children's data (under 16) is collected by Batiste itself.

## 3. Lawful bases

For the **controller** role:

| Processing activity | Lawful basis (Art. 6) |
|---|---|
| Employment / contractor management | 6(1)(b) contract; 6(1)(c) legal obligation |
| Recruitment | 6(1)(a) consent (applicant), 6(1)(f) legitimate interest |
| Customer contract administration | 6(1)(b) contract |
| Product telemetry (only if opted in) | 6(1)(a) consent |
| Incident investigation | 6(1)(f) legitimate interest, 6(1)(c) legal obligation |

For the **processor** role, we do not establish lawful bases for customer processing; we act only on documented controller instructions (Art. 28(3)(a)).

## 4. Principles in practice (Art. 5)

- **Lawfulness, fairness, transparency.** Privacy notice published at `https://batiste.network/privacy` (template in `/docs/privacy-notice.md`).
- **Purpose limitation.** Processing activities documented per §3 and in the Art. 30 records.
- **Data minimisation.** See §2.
- **Accuracy.** Subjects can correct their data via the DSR workflow.
- **Storage limitation.** Retention schedule: operational logs 180 days, audit ledger 6 years, HR records per NL law.
- **Integrity and confidentiality.** Enforced by Scope/Auth/Audit and the cryptography policy.
- **Accountability.** This policy + ROPA + Art. 32 technical measures documented in `mappings/batiste-to-controls.md`.

## 5. Data subject rights

All eight GDPR rights (Arts. 15-22 + withdraw consent + lodge complaint) are honoured. Workflow lives in [`../runbooks/right-to-erasure.md`](../runbooks/right-to-erasure.md) for deletion; other rights follow the same intake → locate → respond pattern. Response within 1 month (extendable +2 per Art. 12(3)).

## 6. International transfers (Arts. 44-50)

Because Batiste runs air-gapped on-prem, cross-border transfer is a customer deployment decision, not a product decision. For our controller processing, we only transfer to countries with an adequacy decision, or under Standard Contractual Clauses (Commission Implementing Decision (EU) 2021/914) with a Transfer Impact Assessment on file.

## 7. Impact assessments

When a processing activity meets the Art. 35(1) threshold (high risk), a DPIA is run using [`../frameworks/gdpr-dpia-template.md`](../frameworks/gdpr-dpia-template.md). The DPIA is reviewed annually and on any material change.

## 8. Records of processing (Art. 30)

Maintained in [`../frameworks/gdpr-art30-records.md`](../frameworks/gdpr-art30-records.md). Scoped separately for controller and processor activities.

## 9. Sub-processors

Listed publicly at `/docs/sub-processors.md` and updated with 30 days notice prior to change. Each sub-processor has a DPA on file with GDPR-equivalent obligations. No sub-processor is in a country without adequacy unless SCCs + TIA are in place.

## 10. Equivalence notes

- **CCPA/CPRA:** The GDPR posture above satisfies the substantive CCPA rights (know, delete, correct, opt-out of sale, limit use of sensitive PI). Consumer rights portal at `/privacy/request`. No sale of personal information.
- **LGPD (Brazil):** Controller obligations mirror GDPR; DPO designate on file.
- **PIPL (China):** Not targeted; cross-border flows to China are not permitted.

## 11. Breach handling

Follow [`../runbooks/incident-response.md`](../runbooks/incident-response.md). GDPR Art. 33/34 timelines are embedded in that runbook.
