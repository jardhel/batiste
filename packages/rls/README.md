# `@batiste-aidk/rls`

> **Row-Level Security primitives for Batiste.** Status: `0.1.0-alpha.1` (skeleton — interfaces stable, implementations forthcoming in v0.2).

This package promotes the per-asset access control, classification labels, and PII routing pattern proven in `apps/governance-vault/` into a first-class Batiste primitive. Every Batiste node will be able to enforce row-level security on artifacts the agent emits, without each app re-implementing the discipline.

## Why this exists

Until now, Batiste's `@batiste-aidk/scope` middleware enforced **path-level** authorization: "may this principal write to `releases/`?". That was sufficient for solo-developer use, and is what Cachola Tech runs on itself today.

The deployment to **Agência Bonita G** (2026-04-23, see `apps/governance-vault/`) exposed the gap: when multiple principals (gestora + N analysts + N designers) share a vault, **every artifact carries its own classification** (`PUBLIC`, `INTERNAL`, `PII-RESTRICTED`, `CONFIDENTIAL`), and the authorization check has to consult both **path** and **classification + principal role**.

The Bonita G overlay solved this in Apps Script + Drive ACLs. That works for an agency-on-Drive deployment, but does not generalize to Batiste nodes orchestrating AI agents on arbitrary backends.

`@batiste-aidk/rls` is the generalization. It defines:

- A **classification taxonomy** (extensible, defaults conform to GVS 0.1 §4.6 + the PII-RESTRICTED extension proposed for GVS 0.2).
- A **principal model** (role + group memberships + key fingerprints).
- An **AccessDecision engine** that evaluates `(principal, classification, action) → ALLOW | DENY | ALLOW_REDACTED`.
- **Adapters** for storage backends (filesystem, Drive, S3 — only filesystem in v0.1).

## Status

This is an **alpha skeleton**: the interfaces in `src/index.ts` are ratified; the implementations are stubs. Real enforcement comes in `v0.2`, target 2026-05-31 — at which point this package becomes a hard dependency of `@batiste-aidk/scope` and the Bonita G overlay's Apps Script becomes a thin caller into this package's logic.

The skeleton is published now (in alpha) so:

- Downstream packages can declare the dependency.
- The interface design can be reviewed publicly before lock-in.
- The agency-overlay implementation has a target API to converge to.

## Public surface (v0.1 alpha — interfaces only)

```typescript
import {
  Classification,
  Principal,
  Asset,
  AccessDecision,
  AccessPolicy,
  evaluate,
  redact,
} from "@batiste-aidk/rls";
```

### `Classification`

```typescript
type Classification =
  | "PUBLIC"
  | "INTERNAL"
  | "PII-RESTRICTED"
  | "CONFIDENTIAL"
  | "SECRET";
```

### `Principal`

```typescript
interface Principal {
  id: string;                      // unique principal id (email, agent uuid, key fingerprint)
  roles: string[];                 // ["gestora"] | ["analyst"] | ["designer"] | ["external"] | ["agent"]
  groups: string[];                // multi-tenant: ["agency:bonita-g", "client:itau"]
  keyFingerprints?: string[];      // for cryptographic principals (sigstore, gpg)
  attestation?: string;            // optional verifier output (DID, JWT, etc.)
}
```

### `Asset`

```typescript
interface Asset {
  uri: string;                     // canonical URI (file path, drive id, s3 key)
  classification: Classification;
  ownerId: string;                 // principal id of the asset owner
  contentHash?: string;            // sha256 of the canonical content
  attributes?: Record<string, string>;
}
```

### `AccessPolicy`

```typescript
interface AccessPolicy {
  defaultDecision: "ALLOW" | "DENY";
  rules: AccessRule[];
}

interface AccessRule {
  match: {                        // all match conditions are AND
    principalRoles?: string[];
    classifications?: Classification[];
    actions?: ("read" | "write" | "delete" | "share")[];
    uriPattern?: string;          // glob (matches via micromatch, like @batiste-aidk/scope)
  };
  decision: "ALLOW" | "DENY" | "ALLOW_REDACTED";
  redactSpans?: RedactSpec;       // required when decision=ALLOW_REDACTED
}
```

### `evaluate`

```typescript
function evaluate(
  principal: Principal,
  asset: Asset,
  action: "read" | "write" | "delete" | "share",
  policy: AccessPolicy
): AccessDecision;
```

### `redact`

```typescript
function redact(content: string, spec: RedactSpec): string;
```

Redaction strategies in v0.1: `placeholder` (replace with `[REDACTED]`), `cipher` (preserve Meld-Encrypt span markers), `hash` (replace with sha256 prefix), `null` (delete).

## Conformance with GVS

`@batiste-aidk/rls` is the reference implementation of the **RLS extension to GVS 0.1**, formally proposed in `docs/adr/ADR-0001-rls-extension.md` for incorporation into GVS 0.2. Until ratification, the extension is documented locally; the spec is free to evolve.

## Roadmap

| Version | Target | Scope |
|---|---|---|
| **0.1.0-alpha.1** (this) | 2026-04-23 | Interfaces only (no enforcement) — published to lock the design |
| 0.1.0 | 2026-05-15 | Filesystem adapter + reference policy DSL + tests |
| 0.2.0 | 2026-05-31 | Drive adapter, S3 adapter, integration with `@batiste-aidk/scope`, used in production by `apps/governance-vault/` v0.2 |
| 0.3.0 | 2026-06-30 | Sigstore principal verification, attestation chains, policy composition |
| 1.0.0 | 2026-09-30 | GVS 0.2 ratified extension, semver-stable interfaces, multi-tenant primitives |

## Why this matters commercially

Every Cachola Tech client beyond solo-developer scale is going to need RLS on their assets. Without RLS, the offering is "you and your laptop". With RLS, the offering is "your firm and your auditor and your vendor and your client, each with the right slice."

Packaging this as `@batiste-aidk/rls` rather than as ad-hoc Apps Script per-agency means:

- The next agency we onboard reuses the same primitives.
- The same primitives work on the next non-agency vertical (law firm, consultancy, fund admin).
- The same primitives work for Cachola Tech itself when it grows beyond solo.
- The discipline is independently auditable as a npm package, not as a custom script per client.
