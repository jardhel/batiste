# Vendor & Third-Party Management Policy

**Owner:** CEO + Security Lead · **Version:** 0.1.0 · **Effective:** 2026-04-20
**Maps to:** ISO/IEC 27001:2022 A.5.19-23; DORA Arts. 28-30; NIS2 Art. 21(2)(d); SOC 2 CC9.2; GDPR Art. 28.

## 1. Principle

The air-gapped on-prem model minimises third-party exposure for the customer. For Batiste itself, we manage a small, audited vendor footprint and publish it.

## 2. Vendor register

Maintained at `compliance/vendors.md` with:

- Name, jurisdiction, role (sub-processor / critical IT supplier / other).
- Service provided.
- Data categories processed (if any).
- Contract and DPA reference.
- Risk tier (critical / important / other).
- Review date.

## 3. Onboarding requirements

Before a vendor touches Batiste code, artefacts, or data:

- Security questionnaire completed.
- Signed DPA (for processors of personal data) with SCCs if outside the EEA.
- If DORA-critical (applicable once Batiste customers are financial entities): written agreement meeting Art. 30 contractual provisions.
- Due diligence file stored with the vendor register.

## 4. Ongoing monitoring

- Annual re-assessment for critical vendors.
- SBOM diff watch for upstream npm packages that enter our supply chain.
- CVE alerts subscribed via GitHub Security Advisories.

## 5. Exit

Every contract includes data-return and data-destruction obligations and an exit plan. For DORA-critical vendors the exit plan is tested annually (Art. 28(8)).

## 6. ICT concentration risk (DORA Art. 29)

We track dependency concentration (e.g., reliance on a single cloud signing authority). Where concentration reaches material levels, we either add a second provider or document the residual risk on the Annex IV sheet.

## 7. Sub-processor list (published)

A public list at `/docs/sub-processors.md`. Customers get 30 days' notice before any addition or replacement. If they object, they may terminate the affected statement of work.

## 8. License-gate exceptions

| Package | License | Reason | Approver | Date | Review trigger |
|---|---|---|---|---|---|
| `@img/sharp-libvips-linux-x64@1.2.4` | LGPL-3.0-or-later | Prebuilt libvips binary, dynamic linking only — no copyleft over first-party code | Jardhel Cachola | 2026-06-10 | version bump re-flags automatically |
| `@img/sharp-libvips-linuxmusl-x64@1.2.4` | LGPL-3.0-or-later | idem | Jardhel Cachola | 2026-06-10 | idem |
| `@img/sharp-libvips-darwin-arm64@1.2.4` | LGPL-3.0-or-later | idem (local dev) | Jardhel Cachola | 2026-06-10 | idem |

Exceptions live in code at `scripts/generate-license-report.mjs` (`EXCEPTIONS`) — the gate re-flags on any version change by design.
