# ADR-0001 — Row-Level Security as a first-class Batiste primitive (with GVS extension proposal)

- **Status:** Accepted
- **Date:** 2026-04-23
- **Deciders:** Jardhel Martins Cachola (founder, Cachola Tech) · advisory: Dr. César Cipriano de Fazio (counsel)
- **Trigger:** signing of Agência Bonita G as second anchor client (2026-04-23). The user noted: *"se por pertinente incorpore sistemicamente ao batiste essas novas funcionalidades, todos os clientes vao querer row level security nos assets deles."*

## Context

Until 2026-04-23, Batiste's authorization layer (`@batiste-aidk/scope`) enforced **path-level** access control: "may this principal write to `releases/`?" — sufficient for the single-principal Cachola Tech house, but insufficient for multi-principal client deployments.

The first multi-principal deployment is `apps/governance-vault/` for Agência Bonita G, where:

- A *gestora* principal owns the vault and the master encryption key.
- *Analyst* principals contribute to memory and read most axes, but cannot decrypt PII spans.
- *Designer* principals contribute attachments and read narrowly.
- *External* principals (clients, the Cachola Tech advisor itself) have **zero** access.

The Bonita G overlay implements this in Apps Script + Drive ACLs + Meld Encrypt. That works for the Drive-on-Workspace topology, but does not generalize:

1. The same principal/role model is going to be needed at every agency we onboard.
2. The same model is needed for non-agency verticals (law firms, fund admins, consultancies).
3. The model needs to apply to AI agents themselves — a Batiste node should be able to introspect "may I read this asset?" before reading.

Without a first-class primitive, every Batiste-using app would re-implement the discipline, with drift, gaps, and escape hatches.

## Decision

**Promote per-asset row-level security to a first-class Batiste primitive: `@batiste-aidk/rls`.**

The package skeleton is published as `0.1.0-alpha.1` on 2026-04-23 with interface-only exports (`evaluate`, `redact`, `guardFor`, `REFERENCE_AGENCY_POLICY`). Implementations land in `0.1.0` (target 2026-05-15).

By `0.2.0` (target 2026-05-31), `@batiste-aidk/scope` declares `@batiste-aidk/rls` as a peer dependency, and `apps/governance-vault/` v0.2 swaps its Apps Script ACL logic for thin calls into the package.

**Concurrent decision: propose RLS as a GVS 0.2 extension.**

GVS 0.1 §4.6 defines a Classification field but does not standardize the principal model or the access-decision engine. The RLS extension proposed here adds:

- §4.7 (new) — Principal model (id, roles, groups, key fingerprints).
- §4.8 (new) — Access policy schema (rules, decisions, redaction).
- §10 (extension) — Validation rules for RLS conformance.
- §11 (new) — `PII-RESTRICTED` classification level (between `INTERNAL` and `CONFIDENTIAL`), with normative requirements for inline encryption and ciphertext-only visibility for non-authorized principals.

The extension is documented in this repository (`docs/adr/ADR-0002-pii-restricted-classification.md` for the classification piece, and the `@batiste-aidk/rls` README for the engine piece). Formal incorporation into GVS happens in version `0.2-draft`, expected 2026-09-30.

## Alternatives considered

### Alt 1 — Keep RLS inside `apps/governance-vault/` (don't generalize)

**Rejected.** Every future client deployment would re-implement. The next agency onboarding would copy-paste Apps Script and accumulate drift. Cachola Tech's brand promise of "audit-ready discipline" cannot survive copy-paste duplication.

### Alt 2 — Embed RLS into `@batiste-aidk/scope` directly

**Rejected.** `@batiste-aidk/scope` enforces path-level rules and is a hot-path middleware. Adding classification-aware logic there would violate single-responsibility and complicate caching. RLS is **policy** (slow, declarative); scope is **mechanism** (fast, runtime). They cohabit better as separate packages with `scope` calling into `rls`.

### Alt 3 — Use an existing OSS RLS engine (Cedar, OPA/Rego, OSO)

**Considered, deferred.** Cedar (AWS) and OPA/Rego (CNCF) are both serious candidates. They cover the principal/policy/decision model well, but introduce a non-trivial dependency footprint into Batiste (Cedar requires the Cedar engine; OPA needs a sidecar or WASM bundle).

For v0.1 we ship a minimal in-process implementation in TypeScript. For v0.3 or v1.0, we will revisit whether to back `@batiste-aidk/rls` with Cedar or OPA under the hood, while preserving the same public API. This keeps the door open without locking in.

### Alt 4 — Defer until a third client requires it

**Rejected.** The user's instruction was explicit: *"todos os clientes vao querer row level security nos assets deles."* Building the primitive for the second client (Bonita G) is right-sized timing — the API design benefits from one real implementation pulling on it, but does not yet have legacy from N implementations to wrangle.

## Consequences

### Positive

- The next agency onboard takes hours, not days, because it composes packages instead of forking Apps Script.
- The Cachola Tech brand promise of "audit-ready discipline" survives multi-client growth — discipline is in the package, not in the consultant's head.
- The RLS extension to GVS gives the standard meaningful adoption path beyond Cachola Tech, which improves its credibility as a market standard.
- Future Batiste apps (not just governance vaults — any app that emits artifacts on behalf of multiple principals) get RLS for free.

### Negative

- Maintenance burden: `@batiste-aidk/rls` becomes a published package the firm is committed to versioning carefully. Breaking changes require deprecation cycles.
- Premature abstraction risk: the v0.1 API is shaped by a single concrete implementation (Bonita G overlay). Some surface area may need to evolve when the second non-agency vertical lands.
- Spec maintenance: GVS 0.2 with RLS extension is a larger spec change than 0.1 → 0.2 would otherwise have been. Schedule slip risk.

### Neutral

- The Apps Script in `apps/governance-vault/` v0.1 stays as-is — `@batiste-aidk/rls` does not block its delivery. The swap to package-backed enforcement is an incremental improvement in v0.2.

## Compliance and audit

This ADR is itself stamped (the `docs/adr/` folder is part of the Batiste repo's audit ledger). The fact that the user's exact prompt triggered the decision is captured in the **Trigger** field above, and the entire reasoning is on-record.

Any future change to `@batiste-aidk/rls`'s public API requires a follow-up ADR citing this one as parent.

## References

- Trigger conversation: 2026-04-23 session (auto-mode delivery for Bonita G)
- `apps/governance-vault/` v0.1.0 (this repo) — first user of the to-be-published API
- `apps/governance-vault/dogfooding.md` — the integrity audit that established the discipline
- `specs/gvs-0.1.md` — current GVS spec (RLS extension targets v0.2)
- `cachola_tech/memory/feedback_integrity_no_bluff.md` — the firm-level commitment that demands honest publishing of the alpha state
