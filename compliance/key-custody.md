# Key Custody Register

**Owner:** Security Lead · **Version:** 0.1.0 · **Last reviewed:** 2026-04-20
**Maps to:** ISO 27001 A.8.24; SOC 2 CC6.1; NIS2 Art. 21(2)(h); DORA Art. 9(4)(e); GDPR Art. 32(1)(a).

> This register tracks every cryptographic key that protects Batiste production or release-engineering. Keys themselves are **not** recorded here — only fingerprints, custodians, storage locations, rotation schedules and the evidence trail. Private key material never leaves its intended hardware.

## Custody model

- Production signing keys live in the **customer's** HSM. Cachola Tech does not see them.
- Release engineering keys (for shipping Batiste artefacts) live on hardware tokens held by named individuals under dual-control.
- Ephemeral workload keys (JWT signing per node) are generated at node start and rotated every 15 minutes (default).

## Register

| # | Key purpose | Algorithm | Location | Primary custodian | Backup custodian | Fingerprint / key ID | Rotation | Last rotated | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| K1 | Release signing — git tags | Ed25519 | YubiKey #A (primary), YubiKey #B (backup) | J. Cachola | (Security Lead delegate) | `<to-populate-before-v1.0.0>` | yearly, on custodian change | — | `compliance/signing/K1.history.md` |
| K2 | Release artefact signing — cosign (sigstore) | Ed25519 (cosign) | Hardware token, OIDC to GitHub org | J. Cachola | (Security Lead delegate) | `<to-populate>` | yearly | — | Sigstore transparency log |
| K3 | Ledger export manifest signing (customer side) | Ed25519 | customer HSM | customer CISO | customer deputy | customer-managed | customer-defined | — | customer evidence trail |
| K4 | mTLS CA (reference deployment) | ECDSA P-256 | customer HSM | customer | customer | customer-managed | yearly | — | customer PKI |
| K5 | JWT node signing (runtime, ephemeral) | Ed25519 | in-process | n/a (ephemeral) | n/a | rotated per process | every 15 min | — | ledger `key_rotated` entries |

## Generation procedure

- K1/K2 generated at key ceremony with two attendees; ceremony recorded in `compliance/signing/ceremony-<date>.md`.
- Keys bound to hardware; no software backup of private material.
- Public keys published in `compliance/signing/public-keys.md`.

## Rotation procedure

1. Generate new key (ceremony).
2. Add new public key to trust anchors (release notes, `compliance/signing/public-keys.md`).
3. Sign with both old and new for one release for downstream verifier compatibility.
4. Revoke old key after the overlap.
5. Update this register.

## Compromise procedure

If a key is suspected compromised:

1. Fire the kill switch (for runtime keys) — see `runbooks/kill-switch.md`.
2. Revoke key in trust anchors (publish revocation).
3. Rotate immediately.
4. Investigate root cause; post-mortem per incident runbook.

## Evidence retention

Retain signed ceremony notes, rotation logs, and the public-key archive for 10 years. Private key material, if ever backed up (should not be), is held under FIPS 140-2 Level 3 equivalents.
