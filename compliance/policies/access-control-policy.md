# Access Control Policy

**Owner:** Security Lead · **Version:** 0.1.0 · **Effective:** 2026-04-20
**Maps to:** ISO/IEC 27001:2022 A.5.15-18, A.8.2-8; SOC 2 CC6.1-CC6.8; NIS2 Art. 21(2)(i); DORA Art. 9.

## 1. Principles

- Least privilege. Each identity gets the minimum scope required.
- Default deny. Anything not explicitly permitted is denied.
- Separation of duties. The person who authors a change is not the person who approves the release.
- Revocation is instantaneous. Kill switch + key rotation are rehearsed.

## 2. Identity types

| Identity | Purpose | Authentication | Lifecycle |
|---|---|---|---|
| Human engineer | Write code, review PRs | SSO + hardware MFA | Joiner-mover-leaver within 1 business day |
| Release signer | Sign releases | Hardware security key, dual-control | Rotated yearly |
| Service — node | Represent a Batiste node in the mesh | JWT issued by Auth service | TTL 15 min, auto-rotate |
| Service — connector | Execute a specific connector tool | JWT with capability scope | Per invocation |
| External auditor | Read evidence packs | Time-boxed signed URL or physical handover | One-time |

## 3. Authorisation model

Authorisation = Scope × Auth, enforced in code by `createNode()`.

- **Scope:** the glob / AST deny-list and capability filter in `packages/scope/src/policy.ts`.
- **Auth:** JWT with `sub`, `cap` (capability array), `aud` (node ID), `exp`, `iat`.
- **Audit:** every authorisation decision (allow, deny, expire) is a ledger entry.

## 4. Capability taxonomy (initial set)

| Capability | Effect | Default grantees |
|---|---|---|
| `code:read` | AST read + symbol lookup | node operators |
| `code:write` | AutoFix, write-through edits | restricted, requires dual-approval |
| `tdd:run` | Run test suites | node operators |
| `doc:read` | PDF/CSV read via connectors | node operators |
| `billing:read` | Read PricingMeter | tenant admins |
| `audit:read` | Read audit ledger | security team |
| `audit:export` | Produce evidence packs | security team, time-boxed |
| `admin:kill` | Fire the kill switch | Security Lead, on-call SRE |

## 5. Joiner-mover-leaver

On joining, each human gets:

- SSO account with MFA enforced.
- Laptop with MDM, full-disk encryption, screen-lock ≤ 5 min.
- Access to the GitHub org under a role matching their function.
- Security & AI Act literacy training before first code review.

On leaving, within 1 business day:

- SSO disabled.
- All tokens revoked (`batiste auth revoke --owner <id>`).
- Laptop returned or remote-wiped.
- Any Batiste signing role transferred.

## 6. Review

Quarterly access review. Security Lead confirms current identities and capabilities against HR records. Findings close within 14 days.

## 7. Remote access

- No direct SSH to production nodes (customer-managed anyway in the air-gapped model).
- Engineering laptops access internal systems over WireGuard with device posture check.

## 8. Evidence

- Ledger entries: `auth_issued`, `auth_revoked`, `auth_failure`, `scope_violation`.
- Quarterly access-review reports stored in `compliance/access-reviews/YYYY-QN.md`.
- SSO provider logs retained 180 days.
