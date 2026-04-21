# DORA — ICT Risk Management Framework

> DORA (Regulation 2022/2554) applies to financial entities in the EU. Batiste is a supplier to such entities and provides features that map directly to DORA obligations. This document is framed for a financial-entity customer performing due diligence on Batiste.

## Applicability

Batiste: ICT third-party service provider.
Customer: financial entity subject to DORA.
Batiste is not (as of v0.1.0) designated a "critical ICT third-party service provider" (CTPP) under Art. 31. We stand ready to comply with oversight obligations should that designation apply in future.

## Chapter II — ICT risk management (Arts. 5-14)

| Article | Requirement | How Batiste supports it |
|---|---|---|
| 5 — Governance and organisation | Management body accountable for ICT risk | Security Lead role + Board oversight (`policies/information-security-policy.md`) |
| 6 — ICT risk-management framework | Documented, reviewed yearly | This compliance pack, annual review |
| 7 — ICT systems, protocols and tools | State-of-the-art, reliable, sufficient capacity | 446 tests no mocks; SQLite WAL; benchmarks |
| 8 — Identification | Identify ICT-supported business functions and assets | Vendor register + architecture doc |
| 9 — Protection and prevention | Security-by-design | Scope + Auth + Audit mechanisms |
| 10 — Detection | Mechanisms to promptly detect anomalies | Ledger tail, metrics endpoint |
| 11 — Response and recovery | Policies, backup, containment, restoration | Kill switch, ledger replication, runbooks |
| 12 — Backup policies and restoration | Documented, tested | BC policy + restoration tests |
| 13 — Learning and evolving | Post-incident analysis, threat monitoring | Post-mortems, threat model updates |
| 14 — Communication | Crisis communication plan | Runbook §4 |

## Chapter III — Incident management (Arts. 17-23)

- Classification of ICT-related incidents per Art. 18 and the Commission Delegated Regulation: runbook §3.
- Notification timelines: 4 h initial, 72 h intermediate, 1 month final: runbook §3.
- Reporting of significant cyber threats: customer may request Batiste evidence per DPA.

## Chapter IV — Digital operational resilience testing (Arts. 24-27)

- Basic testing programme: vulnerability assessments, network security assessments, gap analyses, source-code reviews, scenario-based tests, compatibility testing.
- Advanced testing (TLPT, Art. 26): Batiste supports customers by providing a TLPT harness — mesh can be exercised with red-team JWTs; test provenance recorded in the ledger; reset uses the documented key rotation path.

## Chapter V — Third-party risk (Arts. 28-30)

- Written arrangements meeting Art. 30 content requirements: available as a DPA + contract addendum template.
- Concentration risk (Art. 29): low for Batiste itself (open source runtime, multi-supplier distribution of signing and hosting).
- Register of information (Art. 28(3)): the customer maintains per the RTS; Batiste supplies the fields defined in the Commission's implementing technical standards.

## Chapter VI — Information-sharing (Art. 45)

We participate in applicable information-sharing arrangements once our customer footprint warrants it. In the meantime, we subscribe to CERT-EU and national CSIRT feeds for EU jurisdictions.

## Exit and portability

Data exports (ledger NDJSON + billing records CSV + config backup) are deterministic and documented. A customer can exit to a like-for-like self-hosted install or to an alternative supplier within the SLA commitments in their contract.
