# ISO/IEC 27001:2022 — Annex A Mapping

> Annex A (2022) has 93 controls across four themes: Organisational (37), People (8), Physical (14), Technological (34). Each row below maps a control that Batiste implements or supports, with evidence. Controls that are primarily customer-owned in the air-gapped model are flagged "customer" in the notes column.

## A.5 Organisational controls

| Control | Name | Status | Evidence / Notes |
|---|---|---|---|
| A.5.1 | Policies for information security | met | Policy set + annual review |
| A.5.2 | Information security roles and responsibilities | met | ISMS §4 |
| A.5.3 | Segregation of duties | met | Change mgmt policy + access control policy |
| A.5.4 | Management responsibilities | met | CEO accountability statement |
| A.5.5 | Contact with authorities | met | Incident runbook §9 |
| A.5.6 | Contact with special interest groups | met | CERT-EU membership, CSIRT contacts |
| A.5.7 | Threat intelligence | met | Eixo docs + CVE watch |
| A.5.8 | Information security in project management | met | Threat model per project eixo |
| A.5.9 | Inventory of information and other associated assets | met | Asset register |
| A.5.10 | Acceptable use of information and associated assets | met | Employee handbook |
| A.5.11 | Return of assets | met | Leaver procedure |
| A.5.12 | Classification of information | met | Data classification in data-protection policy §2 |
| A.5.13 | Labelling of information | met | Document templates |
| A.5.14 | Information transfer | met | TLS 1.3 mTLS; DPAs |
| A.5.15 | Access control | met | Access control policy |
| A.5.16 | Identity management | met | SSO + lifecycle procedures |
| A.5.17 | Authentication information | met | MFA + secrets management |
| A.5.18 | Access rights | met | Quarterly review |
| A.5.19 | Information security in supplier relationships | met | Vendor mgmt policy |
| A.5.20 | Addressing information security within supplier agreements | met | Standard DPA + MSA |
| A.5.21 | Managing information security in the ICT supply chain | met | SBOM, signing, lockfiles |
| A.5.22 | Monitoring, review and change management of supplier services | met | Vendor review cadence |
| A.5.23 | Information security for use of cloud services | met | Only internal GH org + registry; docs published |
| A.5.24 | Information security incident management planning and preparation | met | Incident policy + runbook |
| A.5.25 | Assessment and decision on information security events | met | Severity matrix + triage |
| A.5.26 | Response to information security incidents | met | Runbook + kill switch |
| A.5.27 | Learning from information security incidents | met | Post-mortems |
| A.5.28 | Collection of evidence | met | Audit export runbook |
| A.5.29 | Information security during disruption | met | BC policy |
| A.5.30 | ICT readiness for business continuity | met | Kill switch + replication |
| A.5.31 | Legal, statutory, regulatory and contractual requirements | met | Data protection + AI governance policies |
| A.5.32 | Intellectual property rights | met | `.batiste/eixo6_licensing_hygiene.md` |
| A.5.33 | Protection of records | met | Ledger retention + storage limitation |
| A.5.34 | Privacy and protection of PII | met | Data protection policy |
| A.5.35 | Independent review of information security | planned | External audit at Series A |
| A.5.36 | Compliance with policies, rules and standards | met | Review cadence |
| A.5.37 | Documented operating procedures | met | Runbooks |

## A.6 People controls

| Control | Status | Evidence |
|---|---|---|
| A.6.1 Screening | met | Pre-hire checks |
| A.6.2 Terms and conditions of employment | met | Employment contract clauses |
| A.6.3 Information security awareness, education and training | met | Quarterly training |
| A.6.4 Disciplinary process | met | Employee handbook |
| A.6.5 Responsibilities after termination or change | met | Leaver procedure |
| A.6.6 Confidentiality or non-disclosure agreements | met | NDA standard |
| A.6.7 Remote working | met | VPN + endpoint baseline |
| A.6.8 Information security event reporting | met | `security@` + internal channel |

## A.7 Physical controls (primarily customer-owned)

| Control | Status | Evidence |
|---|---|---|
| A.7.1 Physical security perimeters | customer | — |
| A.7.2 Physical entry | customer | — |
| A.7.3 Securing offices, rooms and facilities | partial | Cachola office policy |
| A.7.4 Physical security monitoring | customer | — |
| A.7.5 Protecting against physical and environmental threats | customer | — |
| A.7.6 Working in secure areas | partial | Remote-work baseline |
| A.7.7 Clear desk and clear screen | partial | Employee policy |
| A.7.8 Equipment siting and protection | partial | MDM baseline |
| A.7.9 Security of assets off-premises | partial | MDM + full-disk encryption |
| A.7.10 Storage media | partial | Encryption at rest; destruction procedure |
| A.7.11 Supporting utilities | customer | — |
| A.7.12 Cabling security | customer | — |
| A.7.13 Equipment maintenance | partial | MDM maintenance |
| A.7.14 Secure disposal or re-use of equipment | partial | Disposal procedure |

## A.8 Technological controls

| Control | Status | Evidence |
|---|---|---|
| A.8.1 User end point devices | met | MDM + FDE |
| A.8.2 Privileged access rights | met | Dual-control for signing |
| A.8.3 Information access restriction | met | Scope layer |
| A.8.4 Access to source code | met | GH org with least privilege |
| A.8.5 Secure authentication | met | SSO + MFA; JWT rotation |
| A.8.6 Capacity management | met | p50/p95/p99 metrics |
| A.8.7 Protection against malware | met | Endpoint protection + code signing |
| A.8.8 Management of technical vulnerabilities | met | Dependabot + `pnpm audit` + SBOM |
| A.8.9 Configuration management | met | Config-as-code |
| A.8.10 Information deletion | met | DSR runbook + redaction mechanism |
| A.8.11 Data masking | met | `--redact-pii` on export |
| A.8.12 Data leakage prevention | met | Air-gapped deployment + scope |
| A.8.13 Information backup | met | Ledger replication |
| A.8.14 Redundancy of information processing facilities | customer | — (customer-sided) |
| A.8.15 Logging | met | Append-only ledger |
| A.8.16 Monitoring activities | met | Ledger tail + metrics |
| A.8.17 Clock synchronisation | met | NTP requirement in deployment guide |
| A.8.18 Use of privileged utility programs | met | Restricted via Scope |
| A.8.19 Installation of software on operational systems | met | Change mgmt policy |
| A.8.20 Networks security | met | mTLS + segmentation |
| A.8.21 Security of network services | met | Gateway hardening |
| A.8.22 Segregation of networks | customer | — |
| A.8.23 Web filtering | customer | — |
| A.8.24 Use of cryptography | met | Cryptography policy |
| A.8.25 Secure development life cycle | met | Change mgmt + CI gates |
| A.8.26 Application security requirements | met | Policy set |
| A.8.27 Secure system architecture and engineering principles | met | `ARCHITECTURE.md` |
| A.8.28 Secure coding | met | Linters, typecheck, review |
| A.8.29 Security testing in development and acceptance | met | 446-test suite, property tests |
| A.8.30 Outsourced development | not applicable | No outsourced dev as of v0.1.0 |
| A.8.31 Separation of development, test and production environments | met | Per-package dev / test; customer prod |
| A.8.32 Change management | met | Change mgmt policy |
| A.8.33 Test information | met | Synthetic test data only |
| A.8.34 Protection of information systems during audit testing | met | Read-only evidence exports |
