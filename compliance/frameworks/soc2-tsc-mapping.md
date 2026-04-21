# SOC 2 — Trust Services Criteria Mapping

> TSC 2017 with 2022 points of focus. Categories covered: **Security** (common criteria), **Availability**, **Confidentiality**. Privacy category covered via GDPR posture (see data-protection policy). Processing-integrity PI1 covered by the audit ledger + billing reconciliation.

## CC1 — Control environment

| Point of focus | Evidence |
|---|---|
| CC1.1 Commitment to integrity and ethics | Code of conduct (employee handbook); claims-enforcement tests |
| CC1.2 Board oversight | CEO sign-off on ISMS (information-security policy §4) |
| CC1.3 Organisational structure | Org chart + roles section in ISMS |
| CC1.4 Commitment to competence | Training policy, quarterly security training |
| CC1.5 Accountability | Performance reviews reference policy adherence |

## CC2 — Communication and information

| Point of focus | Evidence |
|---|---|
| CC2.1 Internal communication | `#security` channel, monthly all-hands |
| CC2.2 External communication | `SECURITY.md`, VDP, customer DPA comms channel |
| CC2.3 Communication of changes | Changelog + release notes |

## CC3 — Risk assessment

| Point of focus | Evidence |
|---|---|
| CC3.1 Objectives specified | In ISMS §1 + data-protection §1 |
| CC3.2 Risks identified | Threat models per eixo, vendor risk tier |
| CC3.3 Fraud risks | Segregation of duties in change mgmt policy |
| CC3.4 Monitoring changes | Quarterly access review, SBOM diff |

## CC4 — Monitoring activities

| Point of focus | Evidence |
|---|---|
| CC4.1 Ongoing / separate evaluations | CI gates + quarterly internal reviews |
| CC4.2 Reporting deficiencies | Issue tracker with security label; escalation to Security Lead |

## CC5 — Control activities

| Point of focus | Evidence |
|---|---|
| CC5.1 Selection of controls | This compliance pack |
| CC5.2 Selection / development over technology | Scope / Auth / Audit are engineered controls |
| CC5.3 Policies and procedures | Policies folder |

## CC6 — Logical and physical access

| Point of focus | Evidence |
|---|---|
| CC6.1 Access restricted to authorised users | Scope + Auth layers + access control policy |
| CC6.2 Access granted, modified, removed | Joiner-mover-leaver procedures |
| CC6.3 Separation of duties | Dual reviewer on security-sensitive PRs |
| CC6.4 Physical access | MDM + full-disk encryption on engineering laptops |
| CC6.5 Data destruction | Secure disposal procedure; DSR runbook |
| CC6.6 Transmission protection | TLS 1.3 mTLS |
| CC6.7 User authentication | SSO + hardware MFA |
| CC6.8 Unauthorised software prevention | Signed releases, SBOM, lockfile enforcement |

## CC7 — System operations

| Point of focus | Evidence |
|---|---|
| CC7.1 Infrastructure monitoring | `/metrics` + ledger tail + CI health |
| CC7.2 Event analysis | Ledger chain verification, alerting rules |
| CC7.3 Incident response | Runbook + post-mortems |
| CC7.4 Security incident recovery | Kill switch + key rotation |
| CC7.5 Lessons learned | Post-mortem process |

## CC8 — Change management

| Point of focus | Evidence |
|---|---|
| CC8.1 Changes authorised and tested | Change management policy + CI history |

## CC9 — Risk mitigation

| Point of focus | Evidence |
|---|---|
| CC9.1 Business-disruption risk mitigation | BC policy, drills |
| CC9.2 Vendor risk | Vendor management policy |

## A1 — Availability

| Point of focus | Evidence |
|---|---|
| A1.1 Capacity performance | p50/p95/p99 metrics tracked, published per release |
| A1.2 Environmental protection & backup | Ledger replication, kill switch, restoration tests |
| A1.3 Recovery | RTO/RPO table in BC policy |

## C1 — Confidentiality

| Point of focus | Evidence |
|---|---|
| C1.1 Identify and protect confidential information | Data minimisation + air-gapped posture |
| C1.2 Disposal of confidential information | DSR runbook, retention policy |

## PI1 — Processing integrity (selected because of billing/accounting-adjacent outputs)

| Point of focus | Evidence |
|---|---|
| PI1.1 Processing inputs complete and accurate | PricingMeter reconciliation tests |
| PI1.2 Processing is complete, accurate, timely | Ledger sequence + hash chain |
| PI1.3 Outputs complete and accurate | Reconciliation of billing records with ledger |
