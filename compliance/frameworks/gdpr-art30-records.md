# GDPR Art. 30 — Records of Processing Activities (ROPA)

**Owner:** DPO · **Version:** 0.1.0 · **Last updated:** 2026-04-20
**Maps to:** GDPR Art. 30(1) (controller) and Art. 30(2) (processor).

> Two sections below: records **as controller** (Cachola Tech's own processing) and records **as processor** (when customers route personal data through Batiste). Update at least annually and upon material change.

## A. Records as controller

| # | Processing activity | Purpose | Legal basis | Data subjects | Data categories | Recipients | Transfers | Retention | Security measures |
|---|---|---|---|---|---|---|---|---|---|
| A1 | Employment administration | Pay, benefits, statutory reporting | Art. 6(1)(b) contract; 6(1)(c) legal obligation | Employees | Name, contact, bank details, tax ID, attendance | Payroll provider (NL), tax authority | None outside EEA | 7 years (NL statutory) | Access control, encryption at rest, MFA |
| A2 | Recruitment | Evaluate applicants | Art. 6(1)(a) consent for CV retention; 6(1)(b) pre-contractual | Applicants | CV, interview notes | Hiring panel | None | 6 months after close | Access control, least privilege |
| A3 | Customer contract admin | Deliver contracted service, invoice | Art. 6(1)(b) contract | Customer contact persons | Name, email, role, invoicing address | Accountant, Stripe (optional) | Stripe US (SCCs + TIA) | 7 years (NL fiscal) | Encryption in transit, DPA on file |
| A4 | Security incident investigation | Detect and respond | Art. 6(1)(f) legitimate interest; 6(1)(c) legal obligation | Employees, customers, attackers | Logs, IP, user agents | DPA, CSIRT | As per runbook | 6 years | Immutable ledger, controlled access |
| A5 | Website analytics (self-hosted) | Improve site, no ads | Art. 6(1)(f) legitimate interest | Visitors | Anonymised IP, page views | None | None | 90 days | Aggregation, no third-party trackers |
| A6 | Marketing emails (opt-in) | Announcements | Art. 6(1)(a) consent | Subscribers | Email, subscription state | Self-hosted mailer | None | Until unsubscribe | Encryption in transit |

## B. Records as processor (template per customer)

Populate per customer deployment. Template:

| Field | Example value |
|---|---|
| Controller | <Customer Legal Entity, address, DPO contact> |
| Name of processing | <Batiste deployment in customer's VPC> |
| Categories of processing | Code analysis, document intelligence, compliance auditing |
| Categories of data subjects | <end-users of the AI system, employees, ...> |
| Categories of personal data | <typed by customer during onboarding> |
| Special category data | <yes/no and legal basis Art. 9 if yes> |
| Sub-processors (if any) | <from `sub-processors.md`, usually none> |
| Transfers outside EEA | None by default (air-gapped) |
| Retention | Per controller instruction; Batiste defaults to 6 years for audit ledger |
| Security measures (Art. 32) | Cross-ref `../mappings/batiste-to-controls.md` §§1-4 |
| DPIA reference | Link to DPIA if Art. 35 triggered |

## Maintenance

- Review yearly; mark review date in the version header.
- Update immediately when a new processing activity begins.
- Keep previous versions under `compliance/history/gdpr-art30/`.
