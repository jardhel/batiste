# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 1.0.x | yes |
| 0.1.x (beta) | no (upgrade to 1.0.x) |

Security fixes are released as patch versions on the supported minor. Older minors receive security fixes only for critical severity for 90 days after the next minor is released.

## Reporting a vulnerability

Please report vulnerabilities privately — **do not** open public GitHub issues for security reports.

**Email:** `security@cachola.tech`
**PGP:** see `compliance/security-pgp-key.asc` (fingerprint published in release notes).
**Response SLA:**
- Acknowledgement within 2 business days.
- Triage and initial severity within 5 business days.
- Fix or mitigation for critical findings within 30 days; others per our [Incident Response policy](./compliance/policies/incident-response-policy.md).

When reporting, please include:

- Batiste version (git SHA or release tag).
- Environment (OS, Node version, deployment preset).
- Reproduction steps and, if possible, a minimal proof of concept.
- The impact you observed or expect.

## Safe harbour

Good-faith research conducted under this policy is welcome. We will not pursue legal action against researchers who:

- Give us a reasonable opportunity to investigate and fix before public disclosure.
- Do not access, modify, or exfiltrate data beyond what is strictly necessary to demonstrate the issue.
- Do not degrade availability of the service.
- Do not publish data belonging to others.

We will credit reporters on request once a fix is released, unless they prefer anonymity.

## Scope

In scope:

- Source code in this repository and signed release artefacts published under the `jardhel/batiste` GitHub org.
- Default deployment presets shipped by the project.

Out of scope (please do not test):

- Third-party services not under our control.
- Social engineering of Cachola Tech employees or customers.
- Physical attacks against any facility.
- Denial-of-service testing without explicit written permission.

## Coordinated disclosure

Our default window is 90 days from initial report to public disclosure. The window may be extended by mutual agreement (e.g., if a fix requires downstream coordination). CVE identifiers are requested for any confirmed vulnerability with a CVSS v3.1 base score ≥ 4.0.

## Supply chain

- Releases are signed with [sigstore / cosign](https://www.sigstore.dev/). Signature verification is documented in `docs/verify-release.md`.
- CycloneDX SBOMs are attached to every release (`sbom.cdx.json`).
- Dependency policy and vulnerability handling are in [`compliance/policies/vendor-management-policy.md`](./compliance/policies/vendor-management-policy.md) and [`compliance/policies/change-management-policy.md`](./compliance/policies/change-management-policy.md).

## Hall of fame

Credits for reported issues appear in `SECURITY-HALL-OF-FAME.md` once the first credited report lands.
