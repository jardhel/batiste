# Change Management Policy

**Owner:** Engineering Lead · **Version:** 0.1.0 · **Effective:** 2026-04-20
**Maps to:** ISO/IEC 27001:2022 A.8.32, A.8.9; SOC 2 CC8.1; NIS2 Art. 21(2)(e); DORA Art. 9(4)(f).

## 1. Statements

- No change reaches a release branch without a pull request.
- No pull request merges without at least one independent reviewer who did not author the change (ISO separation-of-duties).
- Tests (`pnpm test`), lint (`pnpm lint`), and type-check (`pnpm typecheck`) must pass in CI.
- Security-sensitive changes (auth, scope, audit, kill switch, cryptography) require a review from someone on the Security Lead's delegate list.
- Every release is signed and ships with an SBOM.
- Changelog updated for every customer-visible change.

## 2. Release train

- `main` — always releasable.
- `release/x.y` — long-lived stabilisation branch for support.
- Tagged releases are signed with the release key; artefacts uploaded to GitHub Releases.
- Hotfix process: branch off the latest release, minimal diff, full CI, signed.

## 3. Rollback

Documented rollback for every migration. Database migrations include reverse scripts tested in CI. Runtime changes are feature-flagged when behaviour is risky; flags default off.

## 4. Emergency changes

Emergencies (SEV-0 / SEV-1 hotfix) bypass the normal queue but not the reviewer requirement. Security Lead can approve asynchronously; the ticket records it. Post-mortem addresses "why did we need an emergency change".

## 5. Evidence

- PR history on GitHub.
- Signed release artefacts.
- SBOMs (`sbom.cdx.json`) per release.
- Changelog.
- CI logs retained 6 months.
