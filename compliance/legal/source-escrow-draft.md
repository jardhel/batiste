# Source Code Escrow Agreement — Draft

> **Status:** Draft template v0.1 — Batiste v1.0.0.
> **Purpose:** Give Batiste customers contractual comfort that the code they depend on will remain available to them even if Cachola Tech BV ceases to trade, is acquired, or otherwise becomes unable to support the software.
> **Audience:** Enterprise procurement, general counsel, investor DD.
> **Authority:** Referenced by `compliance/policies/vendor-management-policy.md` §7 and `compliance/policies/business-continuity-policy.md` §4.
> **Legal review:** This document is a **draft for counsel review**. It is not yet legally binding on any party. Final execution requires sign-off from (a) Cachola Tech BV legal counsel, (b) the customer's legal counsel, and (c) the designated escrow agent.

---

## 1. Parties

| Role | Party |
|---|---|
| Depositor | Cachola Tech BV, a *besloten vennootschap* under the laws of the Netherlands, registered office: Eindhoven, NL |
| Beneficiary | The customer identified in the executed Order Form to which this Agreement is attached |
| Escrow Agent | A reputable independent escrow service mutually agreed in writing (suggested: Iron Mountain NCC Escrow Associates, or NCC Group Escrow BV for EU deposits) |

## 2. Deposit Material

The Depositor shall deposit with the Escrow Agent, within **thirty (30) days** of each GA release tagged as `v*.*.*` in the Batiste repository, a sealed deposit (the **"Deposit Material"**) containing:

1. The full source code of the Batiste monorepo at the released tag, including `packages/`, `scripts/`, `compliance/`, `docs/`, build configuration, and the `pnpm-lock.yaml`.
2. Build instructions sufficient for a skilled developer with commonly available tooling (Node.js ≥ 20, pnpm ≥ 9) to reproduce a working build from the deposited source.
3. The SBOMs (SPDX and CycloneDX) emitted by the release pipeline, signed with sigstore/cosign keyless certificates, together with the signing certificate chain.
4. A written attestation signed by the Depositor's Security Lead confirming that the deposited material corresponds to the released tag and that no material has been withheld.
5. A copy of `compliance/legal/dead-man-apache-clause.md` in the version current at the time of deposit.

The Depositor shall verify within **fifteen (15) days** of each deposit that the Escrow Agent's acknowledgement references the correct tag, SHA, and SBOM digests.

## 3. Release Conditions

The Escrow Agent shall release the most recent Deposit Material to the Beneficiary on the occurrence of any of the following events (each a **"Release Event"**), verified by independent written evidence submitted to the Escrow Agent:

1. **Insolvency.** The Depositor files for or is subjected to bankruptcy, surseance van betaling (suspension of payments under Dutch law), liquidation, or any analogous proceeding in any jurisdiction, and such proceeding is not dismissed within sixty (60) days.
2. **Discontinuation.** The Depositor publicly announces discontinuation of the Batiste software or ceases commercial operations for a period exceeding ninety (90) consecutive days.
3. **Persistent support failure.** The Depositor materially fails to provide support services owed under the Order Form, such failure is formally notified by the Beneficiary, and the failure is not cured within forty-five (45) days of notice.
4. **Acquisition with discontinuation.** The Depositor is acquired and the acquirer, within twelve (12) months of closing, announces or effects the discontinuation, sunset, or material degradation of Batiste as a commercially available product.
5. **Dead-man trigger.** The dead-man conditions described in `compliance/legal/dead-man-apache-clause.md` are satisfied.

A Release Event does not transfer ownership of the intellectual property rights in the Deposit Material; it grants the Beneficiary the licence described in §4.

## 4. Licence on Release

Upon verified occurrence of a Release Event the Beneficiary shall be granted a **perpetual, irrevocable, worldwide, royalty-free licence** to use, modify, and distribute the Deposit Material for the Beneficiary's own internal business purposes, together with the right to engage third parties to do so on the Beneficiary's behalf.

This licence is non-exclusive and is intended solely to preserve the Beneficiary's operational continuity. It does not grant trademark rights to "Batiste" or "Cachola Tech" other than the right to refer to the software by its original name for interoperability and attribution purposes.

Where a Release Event under §3.2 (Discontinuation) or §3.5 (Dead-man trigger) occurs, the Beneficiary's licence under this §4 is co-extensive with, and shall not be more restrictive than, the licence granted to the public at large under `compliance/legal/dead-man-apache-clause.md`.

## 5. Verification Rights

The Beneficiary may, once per calendar year and at its own cost, appoint an independent auditor to verify that the Deposit Material actually reproduces a working build and corresponds to the released tag. The Escrow Agent shall facilitate such verification subject to reasonable confidentiality undertakings. Adverse findings (material drift, missing files, failing build) shall be reported to the Depositor with a ninety (90) day cure period, failing which §3.3 applies.

## 6. Confidentiality

Until a Release Event the Deposit Material is confidential. The Escrow Agent shall hold it subject to the same confidentiality obligations the Depositor owes to the Beneficiary in the Order Form. The Beneficiary shall not be entitled to access the Deposit Material prior to a verified Release Event.

## 7. Costs

Unless otherwise agreed in the Order Form, escrow agent fees are borne by the Depositor. Verification under §5 is borne by the Beneficiary.

## 8. Term and Termination

This Agreement runs co-terminously with the Order Form and survives for as long as the Beneficiary holds a valid licence to use Batiste. Either party may terminate on sixty (60) days' written notice, except that termination by the Depositor does not extinguish the Beneficiary's rights in deposits already made.

## 9. Governing Law and Jurisdiction

This Agreement is governed by the laws of the Netherlands. The courts of 's-Hertogenbosch have exclusive jurisdiction over any dispute arising under or in connection with this Agreement, without prejudice to the right of either party to seek interim relief before any court of competent jurisdiction.

## 10. Entire Agreement and Amendment

This Agreement, together with the Order Form and the tri-party escrow services agreement executed with the Escrow Agent, constitutes the entire agreement of the parties on its subject matter. Amendments require signature by all three parties.

---

## Signature Block

| Party | Name | Title | Date | Signature |
|---|---|---|---|---|
| Depositor (Cachola Tech BV) | Jardhel Cachola | Director | — | — |
| Beneficiary | — | — | — | — |
| Escrow Agent | — | — | — | — |

---

## Change log

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1.0 | 2026-04-20 | J. Cachola | Initial draft for v1.0.0 investor DD / procurement readiness. Not yet reviewed by counsel. |
