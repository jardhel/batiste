# Business Continuity & ICT Resilience Policy

**Owner:** Security Lead · **Version:** 0.1.0 · **Effective:** 2026-04-20
**Maps to:** ISO/IEC 27001:2022 A.5.29-30, A.8.14; SOC 2 A1.2; DORA Art. 11; NIS2 Art. 21(2)(c)(f); GDPR Art. 32(1)(c).

## 1. Scope

Continuity of the Batiste product (the code, the mesh it runs in) and of Cachola Tech's engineering operations.

## 2. Objectives

| Asset | RPO | RTO |
|---|---|---|
| Audit ledger | 0 (append-only, synced) | 5 minutes (read-only standby) |
| Source repository | 24 h (mirrors) | 1 h |
| Release signing key | n/a (recoverable from custodians) | 24 h |
| CI pipeline | 24 h | 4 h |

## 3. Resilience mechanisms

- **Kill switch.** Structural isolation primitive; covers "ability to isolate affected systems" in DORA Art. 11(2)(f).
- **Audit ledger replication.** WAL shipping to a read-only standby node.
- **Multi-region code mirror.** GitHub primary + Codeberg mirror + local tarball archive.
- **Offline build recipe.** `pnpm install --offline` path documented; dependency tarballs archived per release.

## 4. Testing

- Quarterly kill-switch drill.
- Semi-annual tabletop: "source repository hosted provider outage", "release-signing custodian unreachable", "national CSIRT contact change", and similar scenarios.
- Annual full restoration test: restore a ledger + codebase into a clean environment within the RTO.

## 5. Crisis communications

Escalation tree in the incident runbook. Keep at least two independent communication channels (email, Signal, phone) so that a compromise of one does not break coordination.

## 6. DORA resilience additions

For customers that are DORA-scope financial entities:

- Threat-Led Penetration Testing (Art. 26) supported via documented TLPT harness guidance.
- Concentration risk review annually (see vendor policy).
- Exit plans from critical ICT providers tested annually.

## 7. Evidence

- Drill reports (`compliance/drills/`).
- Restoration test logs.
- Risk register snapshots per year.
