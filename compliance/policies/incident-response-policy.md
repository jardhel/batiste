# Incident Response Policy

**Owner:** Security Lead · **Version:** 0.1.0 · **Effective:** 2026-04-20
**Maps to:** ISO/IEC 27001:2022 A.5.24-26; SOC 2 CC7.3-7.5; GDPR Art. 33-34; NIS2 Art. 23; DORA Art. 17-19.

## 1. Intent

Detect, contain, eradicate, recover, and report security incidents fast enough to preserve rights, keep regulators informed, and protect customers.

## 2. Scope

Any event impacting confidentiality, integrity or availability of Batiste product, Batiste engineering systems, or customer data processed through Batiste.

## 3. Policy statements

- 24/7 on-call for SEV-0 and SEV-1; business hours for SEV-2 / SEV-3.
- Breach clocks run in UTC and start at the moment of awareness.
- Kill switch is an authorised containment option at any severity.
- Every incident produces a post-mortem within 10 business days (blameless).
- Drills every 6 months (table-top) and every quarter (kill-switch live fire).

## 4. Operations

All operational detail lives in the runbook [`../runbooks/incident-response.md`](../runbooks/incident-response.md). This policy makes the runbook binding.

## 5. Reporting obligations

| Jurisdiction / role | Obligation | Window |
|---|---|---|
| EU DPA (customer role controller) | GDPR Art. 33 | 72 h from awareness |
| EU DPA (us controller) | GDPR Art. 33 | 72 h from awareness |
| Data subjects (high risk) | GDPR Art. 34 | without undue delay |
| National CSIRT (NIS2 essential/important entity) | NIS2 Art. 23(4)(a) early warning | 24 h |
| NIS2 incident notification | Art. 23(4)(b) | 72 h |
| NIS2 final report | Art. 23(4)(d) | 1 month |
| DORA lead overseer (financial entity) | Art. 19(4)(a) initial | 4 h from major classification |
| DORA intermediate | Art. 19(4)(b) | within 72 h |
| DORA final | Art. 19(4)(c) | within 1 month |
| Customer (processor → controller) | DPA Art. 28(3)(f) | without undue delay |

Where Batiste is a processor, the customer files with the authority; we provide all the evidence they need under DPA Art. 28(3)(f).

## 6. Records

- Incident ticket with timeline.
- Ledger evidence pack.
- Post-mortem at `compliance/post-mortems/INC-<id>.md`.
- Drill reports at `compliance/drills/YYYY-QN.md`.

Retention: 6 years.

## 7. Training

All engineers run one tabletop drill per year minimum. Security Lead runs the kill-switch live-fire quarterly.
