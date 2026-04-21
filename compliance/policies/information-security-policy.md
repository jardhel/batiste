# Information Security Policy

**Owner:** Security Lead · **Approver:** CEO · **Review cadence:** annual · **Version:** 0.1.0 · **Effective:** 2026-04-20
**Maps to:** ISO/IEC 27001:2022 cl. 5.2, SOC 2 CC1, NIS2 Art. 21(2)(a), DORA Art. 5, GDPR Art. 24.

## 1. Purpose

Define the information-security principles Batiste enforces in its product and in its engineering organisation.

## 2. Scope

Applies to all Batiste source code, releases, operational documentation, employees, contractors, and sub-processors.

## 3. Principles

1. **Zero-trust by structure, not by procedure.** Controls are implemented in code (Scope, Auth, Audit, Kill Switch). Every call traverses all three gates; bypass is not a configuration option.
2. **Data never leaves the customer's network by default.** Connectors process in-process; no outbound telemetry.
3. **Every action is auditable.** The append-only ledger is the source of truth.
4. **Revocation is instantaneous.** Kill switch < 1 ms is a hard requirement, not a target.
5. **Secure defaults.** Fail closed. Deny by default. No hidden debug flags.
6. **Minimum data.** We process what we must, for as long as we must.

## 4. Roles

| Role | Responsibilities |
|---|---|
| CEO | Accountable for compliance programme, approves this policy. |
| Security Lead | Owns policies, runbooks, threat modelling, incident response. |
| Engineering Lead | Ensures changes respect policy; signs off releases. |
| DPO | Data subject rights, Art. 30 records, supervisory authority liaison. |
| Every employee | Reports suspected incidents within 2 hours of discovery. |

## 5. Policy statements

- **5.1 Access control.** Least privilege enforced via Scope policies and JWT-bound capabilities (see `access-control-policy.md`).
- **5.2 Cryptography.** Only approved algorithms (see `cryptography-policy.md`). Keys rotate quarterly at minimum.
- **5.3 Change management.** Every production-impacting change goes through PR, tests, and security review (see `change-management-policy.md`).
- **5.4 Incident response.** See `incident-response-policy.md` and the runbook.
- **5.5 Business continuity.** See `business-continuity-policy.md`.
- **5.6 Third parties.** See `vendor-management-policy.md`.
- **5.7 Human resources security.** Background checks for employees with access to signing keys. Security training quarterly.
- **5.8 Physical security.** Air-gapped on-prem: the customer's control. Batiste engineering assets (laptops) use full-disk encryption and MDM.
- **5.9 Exceptions.** Any exception to this policy requires written approval from the Security Lead and an entry in the exceptions register.

## 6. Measurement

- Zero unclosed critical findings older than 30 days.
- 100 % of releases signed and SBOM-attested.
- Quarterly kill-switch drill completed with timings recorded.
- 100 % of employees have current security training.

## 7. Enforcement

Violations are handled per the employee handbook. Contractors lose access immediately. Software bugs that create policy violations are treated as SEV-1 incidents.
