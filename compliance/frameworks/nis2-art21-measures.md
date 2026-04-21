# NIS2 Art. 21 — Cybersecurity Risk-Management Measures

> The ten measures listed in Art. 21(2), how Batiste implements them, and where the evidence lives.

| # | Art. 21(2) measure | Batiste implementation | Evidence |
|---|---|---|---|
| a | Policies on risk analysis and information-system security | ISMS policy + this compliance pack | `policies/information-security-policy.md` |
| b | Incident handling | Runbook + quarterly drills | `runbooks/incident-response.md`, `policies/incident-response-policy.md` |
| c | Business continuity, backup, crisis management | Ledger replication, kill switch, tabletop exercises | `policies/business-continuity-policy.md`, `runbooks/kill-switch.md` |
| d | Supply-chain security | Vendor register, SBOMs, signed releases, dependency pinning | `policies/vendor-management-policy.md`, SBOM per release |
| e | Security in network and information systems acquisition, development and maintenance (incl. vulnerability handling and disclosure) | SDL: PR review, CI gates, `security.md`, SBOM, signed releases, VDP | `policies/change-management-policy.md`, `/SECURITY.md` |
| f | Policies and procedures to assess effectiveness of cybersecurity risk-management measures | KPI review, drill reports, quarterly access review | `compliance/drills/`, `compliance/access-reviews/` |
| g | Basic cyber hygiene practices and cybersecurity training | Onboarding training + annual literacy module | HR records |
| h | Policies and procedures regarding the use of cryptography and, where appropriate, encryption | Cryptography policy | `policies/cryptography-policy.md` |
| i | Human resources security, access control policies, and asset management | HR security statements + access control policy + asset register | `policies/access-control-policy.md`, `policies/information-security-policy.md` §4 |
| j | The use of multi-factor authentication or continuous authentication solutions, secured voice, video and text communications, and secured emergency communication systems within the entity, where appropriate | SSO + MFA for engineering; hardware keys for signing; mTLS on gateway | `policies/access-control-policy.md` §§2,7 |

## Art. 23 — Reporting

Handled in the incident runbook (§3 of [`../runbooks/incident-response.md`](../runbooks/incident-response.md)): 24 h early warning, 72 h incident notification, 1 month final report.

## Article-by-article audit crosswalk

- Art. 20 (governance): Management accountability — CEO approves ISMS (§4 of information-security policy).
- Art. 21(1) (proportionality): The register of risks notes residual risk justification.
- Art. 21(3) (management-body approval of measures): Evidence in the compliance-pack changelog (signed off by CEO).
- Art. 21(4) (implementation of corrective measures): Post-mortem action items tracked to close.
