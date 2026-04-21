# Cryptography Policy

**Owner:** Security Lead · **Version:** 0.1.0 · **Effective:** 2026-04-20
**Maps to:** ISO/IEC 27001:2022 A.8.24; SOC 2 CC6.1, CC6.6; NIS2 Art. 21(2)(h); DORA Art. 9(4)(e); GDPR Art. 32(1)(a).

## 1. Approved algorithms

| Purpose | Algorithm | Rationale |
|---|---|---|
| JWT signing | Ed25519 (primary), RS256 (fallback) | Fast, small signatures, widely supported |
| Ledger hash-chain | BLAKE3 | High throughput, 256-bit security |
| File integrity manifests | SHA-256 | Mandated by most audit guidance |
| Symmetric encryption (at rest) | AES-256-GCM | AEAD, resists nonce misuse if nonces rotated |
| Password hashing (not our default) | Argon2id with customer-tuned parameters | |
| TLS | TLS 1.3 only; TLS 1.2 with AEAD ciphers for legacy | |

Deprecated / prohibited: MD5, SHA-1 (except certain legacy protocols), RSA < 2048, DSA, ECB mode, TLS < 1.2.

## 2. Key management

- Production signing keys live in the customer's HSM (YubiHSM, AWS CloudHSM, Azure Dedicated HSM, or equivalent).
- Engineering signing keys (for releases) live on hardware tokens held by named individuals under dual-control.
- Keys rotate:
  - JWT signing keys: every 90 days, or immediately on suspected compromise.
  - TLS certificates: per certificate policy, minimum yearly.
  - Release signing keys: yearly, or on key-custodian change.
- Every rotation writes a `key_rotated` ledger entry with the public-key fingerprint (private material never recorded).

## 3. Randomness

`crypto.randomBytes()` from Node's built-in `crypto` (libcrypto). We do not implement our own PRNG. Seed entropy is inherited from the OS.

## 4. TLS posture

- mTLS between gateway and nodes in the default reference deployment.
- HSTS max-age ≥ 63072000 on web dashboard.
- OCSP stapling when external CAs are used.

## 5. Forbidden patterns

- Hand-rolled crypto.
- Reusing a nonce with the same key.
- Logging key material, full credentials, or secrets. CI has `trufflehog`-style pre-commit hook; violations fail the build.

## 6. Evidence

- Key custody register (`compliance/key-custody.md`).
- Rotation ledger entries.
- Annual cryptography-inventory review filed at `compliance/crypto-reviews/YYYY.md`.
