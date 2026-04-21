# Dead-Man Relicensing Clause — Draft

> **Status:** Draft v0.1 — Batiste v1.0.0.
> **Purpose:** Make the customer comfortable that the Batiste source will not become a stranded asset if Cachola Tech BV disappears, without requiring a full open-source commitment today.
> **Legal review:** This is a **draft for counsel review**. It is not yet binding until counter-signed in the Order Form or appended to the repository `LICENSE` file.
> **Companion document:** `compliance/legal/source-escrow-draft.md`.
> **Audience:** Enterprise procurement, investor DD, open-source community.

---

## 1. Intent

Batiste is currently distributed under a commercial licence ("UNLICENSED" in `package.json`, subject to the terms of each customer's Order Form). The intent of this clause is to provide a **credible commitment** that in specified adverse circumstances the source code shall transition to the **Apache License 2.0**, so that customers who rely on Batiste can continue to operate, maintain, and extend it without dependency on Cachola Tech BV.

This clause is not charity. It reduces single-vendor risk in procurement, aligns with ISO 27001 A.5.30 (ICT readiness for business continuity), DORA Art. 11 (business continuity policy), and NIS2 Art. 21(2)(c) (business continuity and crisis management). It is a substitute for the harsher remedy of public source disclosure today.

## 2. Trigger Conditions

The dead-man trigger fires when **any one** of the following independently verifiable conditions is true, as confirmed by the trustee named in §5:

1. **Bankruptcy.** Cachola Tech BV enters bankruptcy, liquidation, or an analogous proceeding under Dutch law (faillissement or surseance van betaling) or the equivalent in its then-current country of registration, and no successor entity assumes the obligations under this clause within one hundred and twenty (120) days.
2. **Commercial discontinuation.** Cachola Tech BV publicly announces the discontinuation of Batiste as a commercial product, or effectively ceases publishing updates for a period exceeding twelve (12) consecutive months without a published reason and public roadmap resumption.
3. **Unresponsive vendor.** Cachola Tech BV fails, for a period exceeding ninety (90) consecutive days, to respond to either (a) a properly filed security vulnerability disclosure via `security@cachola.tech` in respect of a confirmed high or critical severity issue, or (b) a formal notice of material breach from any paying customer.
4. **Explicit opt-in.** The director(s) of Cachola Tech BV execute and publish a written notice electing to accelerate this clause.

The conditions above are intentionally conservative. "Paused development" or "quiet quarter" is not a trigger; only sustained, evidenced absence of stewardship is.

## 3. Effect

Upon verified occurrence of a trigger under §2, the then-current Batiste source code as most recently deposited under `compliance/legal/source-escrow-draft.md`, together with the Git history up to and including the most recent deposit, is automatically relicensed under the **Apache License, Version 2.0** (https://www.apache.org/licenses/LICENSE-2.0), including the explicit patent grant at §3 of that licence and the NOTICE attribution requirement at §4(d).

The trustee (§5) shall publish the relicensed source at a public URL and issue a signed statement recording the trigger condition, the date, and the Git commit hash being relicensed. The trustee shall also publish the associated SBOMs and cosign attestations already deposited.

## 4. Scope of Relicensing

The relicensing covers:

1. All code in the `packages/` directory of the Batiste monorepo.
2. The `scripts/` directory.
3. The `docs/` and `compliance/` directories, insofar as they constitute the technical documentation and policy scaffolding of the software (the narrative content remains copyright of the authors but the licence permits its distribution with the software).
4. Build configuration and test fixtures required to reproduce a working build.

Excluded from relicensing (trademarks, goodwill, operational data) are:

1. The "Batiste" and "Cachola Tech" names, logos, and any associated trademarks, which remain the property of their respective owners. Downstream distributions must rename accordingly under Apache-2.0 §4(c).
2. Proprietary customer data, keys, audit logs, or any material belonging to the customer; these are never deposited.
3. Third-party dependencies, which continue under their own respective licences unchanged.

## 5. Trustee

The trustee for the purpose of this clause is the same party acting as Escrow Agent under `compliance/legal/source-escrow-draft.md`, acting under instructions from the tri-party escrow services agreement. The trustee acts independently of Cachola Tech BV and is not subject to its direction in respect of verifying trigger conditions or publishing the relicensed source.

If the trustee is unable or unwilling to act, the Software Freedom Conservancy or an analogous neutral non-profit may be substituted on thirty (30) days' notice published in the repository.

## 6. Irrevocability

This clause is irrevocable once incorporated into an executed Order Form or appended to the published `LICENSE` file. Cachola Tech BV may not withdraw, narrow, or condition it unilaterally. Amendments shall only widen its scope or shorten its trigger durations; no amendment shall increase the burden on customers relying on it.

## 7. Customer Acknowledgement and Limitation

The customer acknowledges that this clause is a contingency mechanism, not a present open-source commitment. Nothing in this clause obliges Cachola Tech BV to accept contributions from the public, to maintain a public issue tracker, or to depart from its current commercial distribution model while it remains a going concern.

The customer further acknowledges that the Apache-2.0 licence disclaims warranties and limits liability ("AS IS", "WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND"). Post-trigger, the customer relies on the source at its own risk; prior warranties and indemnities ran against Cachola Tech BV and do not survive its disappearance.

## 8. Governing Law

This clause is governed by the laws of the Netherlands. The courts of 's-Hertogenbosch have exclusive jurisdiction over its interpretation and enforcement.

---

## Implementation checklist

- [ ] Counsel review of §2 trigger language against Dutch insolvency law terminology.
- [ ] Counsel review of §5 trustee substitution mechanism.
- [ ] Escrow agent selection and tri-party agreement execution (`source-escrow-draft.md` §1).
- [ ] Append this file URL to `LICENSE` and `package.json` metadata as a public commitment.
- [ ] First production deposit at `v1.0.0` GA.
- [ ] Annual review: `compliance/policies/business-continuity-policy.md` §4.
- [ ] Reference from `compliance/mappings/batiste-to-controls.md` under BC/DR, vendor risk, software supply-chain controls.

---

## Change log

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1.0 | 2026-04-20 | J. Cachola | Initial dead-man clause draft for v1.0.0 investor DD. Pending counsel review. |
