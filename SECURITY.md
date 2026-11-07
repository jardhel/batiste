# Security Policy

Vulnerabilidade de seguranca e tratada como SEV0 neste projeto.

## Supported versions

| Version | Supported |
|---|---|
| `main` (HEAD) | yes |
| 1.2.x (pre-release, `v1.2.0-alpha.*`) | yes |
| 1.1.x | security fixes only (critical and high) |
| 1.0.x and older, 0.x (beta) | no (upgrade) |

Security fixes ship as patch versions on the supported line. A fix for a critical issue may also be backported to the previous minor for 90 days.

## Reporting a vulnerability

Report privately. **Do not** open public issues, pull requests or discussions for security reports.

1. Preferred: GitHub private vulnerability reporting, at <https://github.com/jardhel/batiste/security/advisories/new>.
2. Alternative: email `jardhel@cachola.tech` with subject `[batiste security]`.

Please include: version (git SHA or release tag), environment (OS, Node version, deployment preset), reproduction steps or a minimal proof of concept, and the impact you observed or expect.

## Response SLA

Counted from a confirmed report. Acknowledgement happens within 2 business days; remediation targets by severity (CVSS v3.1 / v4):

| Severity | Fix or mitigation target |
|---|---|
| Critical (9.0-10.0) | same day |
| High (7.0-8.9) | within 72 hours |
| Moderate (4.0-6.9) | within 14 days |
| Low (< 4.0) | next regular release |

The same targets apply to vulnerable dependencies reported by Dependabot, OSV-Scanner, `pnpm audit` or CodeQL. If a fix upstream does not exist, we ship a mitigation (pin, override, feature off) inside the target and track the upstream fix.

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
- CI/CD configuration (`.github/`) and every package under `packages/`.
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
