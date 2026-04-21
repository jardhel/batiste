---
title: "Eixo 8 — DD UX as Product (Scaffold)"
status: draft
owner: jardhel
date: 2026-04-15
depends_on:
  - eixo1_honesty
  - eixo2_bugs
  - eixo3_security
  - eixo4_docs
  - eixo5_code_quality
  - eixo6_licensing
  - eixo7_observability
thesis_ref: project_dd_as_product.md
---

# Eixo 8 — Due-Diligence UX as Product

> The DD journey is not a sales-ops chore. It is the single highest-signal
> surface the enterprise buyer ever touches. Because Batiste cannot name
> customers (secret-weapon positioning), **the DD experience IS the social
> proof**. This document scaffolds the DD surface as a first-class product.

This scaffold intentionally produces **no code**. Its job is to enumerate
artifacts, owners, formats, and commitments so Eixos 1–7 can feed them.

---

## 0. Decisions Already Made (Inputs from User)

| # | Decision | Answer | Status |
|---|---|---|---|
| D1 | SBOM + license report fully public (no gating) | **YES** | Final |
| D2 | DD SLA breach pays 5% annual-contract discount | **YES** | Pending Eixo 7 legal review |

Both decisions are baked into this scaffold and treated as non-negotiable
unless legal overrides D2.

---

## 1. Content Inventory — What the DD Portal Must Host

The portal lives at `dd.batiste.network` (subdomain of marketing site).
Every artifact is:

- **versioned** by git commit hash of the repo it was generated against
- **signed** (minisign / cosign) so buyer can verify authenticity offline
- **timestamped** with RFC 3161 TSA countersignature
- **downloadable** as the authoritative source of truth (no "request access" forms)

Gating rules:

| Tier | Requires | Artifacts |
|---|---|---|
| Public | none | SBOM, license report, threat model summary, architecture overview, compliance one-pagers, DD SLA, exit story, sandbox image |
| NDA | click-through NDA (HelloSign, <60 s) | Full threat model with attack trees, detailed control mappings, pen-test report, vuln status, runbooks |
| Paid pilot | signed MSA | Multi-tenant isolation deep dive, incident post-mortems, key ceremony video |

### 1.1 Tree

```
dd.batiste.network/
├── index.html                                  (landing — 5 links, no fluff)
├── /public/
│   ├── sbom/
│   │   ├── batiste-<version>-<commit>.spdx.json
│   │   ├── batiste-<version>-<commit>.cdx.json          (CycloneDX 1.5)
│   │   ├── batiste-<version>-<commit>.sbom.sig          (cosign)
│   │   └── diff/ (SBOM diffs between releases)
│   ├── licenses/
│   │   ├── license-report.html                         (human readable)
│   │   ├── license-report.json                         (machine readable)
│   │   ├── license-inventory.csv                       (one row per dependency)
│   │   ├── copyleft-exposure.md                        (GPL/AGPL transitive scan)
│   │   └── attribution-notices/                        (NOTICE files per dep)
│   ├── threat-model/
│   │   ├── summary.md                                  (2 pages; STRIDE table)
│   │   ├── trust-boundaries.svg                        (generated from ARCHITECTURE.md)
│   │   └── assumptions.md
│   ├── architecture/
│   │   ├── overview.svg                                (the README diagram)
│   │   ├── middleware-chain.svg                        (Scope→Auth→Audit)
│   │   ├── marketplace-routing.svg
│   │   └── deployment-topologies.md                    (air-gapped / on-prem / VPC-peered)
│   ├── compliance/
│   │   ├── soc2.md                                     (one-pager)
│   │   ├── iso27001.md
│   │   ├── hipaa.md
│   │   ├── nist-800-53.md
│   │   ├── gdpr.md
│   │   └── matrix.csv                                  (control × package × evidence)
│   ├── sla/
│   │   ├── dd-response-sla.md
│   │   ├── sla-history.json                            (our own breach record)
│   │   └── breach-refund-terms.md                      (the 5% clause)
│   ├── exit-story.md
│   └── sandbox/
│       ├── docker-compose.yml
│       ├── README.md
│       └── sample-data/
├── /nda/                                               (behind click-through)
│   ├── threat-model-full.pdf
│   ├── control-mappings/
│   │   ├── soc2-cc6.csv                                (Logical Access)
│   │   ├── soc2-cc7.csv                                (System Operations)
│   │   ├── iso27001-A.5-A.18.csv
│   │   ├── hipaa-technical-safeguards.csv
│   │   ├── nist-800-53-rev5.csv
│   │   └── gdpr-art-5-32.csv
│   ├── pen-test/
│   │   ├── latest-report.pdf
│   │   ├── executive-summary.md
│   │   └── remediation-tracker.csv
│   ├── vulnerability-status/
│   │   ├── open-cves.json
│   │   ├── dependency-scan.sarif                       (trivy + osv-scanner combined)
│   │   ├── slo.md                                      (triage within 24h critical / 7d high)
│   │   └── historical-cves.csv
│   ├── runbooks/
│   │   ├── incident-response.md
│   │   ├── key-rotation.md
│   │   ├── kill-switch-activation.md
│   │   ├── audit-ledger-recovery.md
│   │   ├── on-call-rotation.md
│   │   └── backup-and-dr.md
│   └── questionnaires/
│       ├── sig-lite-2026.xlsx
│       ├── sig-core-2026.xlsx
│       ├── caiq-v4.0.2.xlsx
│       ├── vsa-full.xlsx
│       └── hecvat-full.xlsx
├── /playground/                                        (see §8)
└── /status/                                            (live governance dashboard)
    ├── kill-switch-latency.json                        (rolling p50/p95/p99)
    ├── scope-denials-per-sec.json
    ├── audit-writes-per-sec.json
    └── uptime.json
```

### 1.2 Artifact Specifications

**SBOM (PUBLIC).** SPDX 2.3 JSON + CycloneDX 1.5 JSON. Generated from
`pnpm-lock.yaml` via `@cyclonedx/cyclonedx-npm`. Regenerated on every tag.
Includes transitive dependencies with license, PURL, checksum. Published
at a stable URL per release. No auth. No email wall. This is the first
place a buyer's AppSec team goes — any friction kills us.

**License report (PUBLIC).** Generated via `license-checker-rseidelsohn`
against `node_modules/` after `pnpm install --frozen-lockfile`. Flags
copyleft transitives (GPL/AGPL/LGPL/MPL/EPL) explicitly with a
"copyleft-exposure.md" companion. All NOTICE files concatenated.

**Threat model.** STRIDE-per-component against the 10 packages listed in
`ARCHITECTURE.md`. Attack trees for the three zero-trust layers (Scope,
Auth, Audit). Explicit assumptions (on-prem, operator-trusted, SQLite
file ACLs enforced, JWT signing key stored outside filesystem reach of
agents).

**Control mappings.** One CSV per framework. Columns:
`control_id, control_title, batiste_package, source_file, test_file, status, evidence_url`.
Example row: `CC6.1, "Logical access controls", @batiste-aidk/scope,
packages/scope/src/access-policy.ts, packages/scope/src/__tests__/access-policy.test.ts,
implemented, https://github.com/jardhel/batiste/blob/<sha>/packages/scope/src/access-policy.ts`.

**Architecture diagrams.** SVG, generated deterministically from
`ARCHITECTURE.md` + source, not hand-drawn. Each diagram shows
`data-commit-hash` in the corner.

**Data flow.** Explicit Sankey: *caller → gateway → scope → auth →
audit → handler → SQLite WAL → response*. Annotated with: where data
leaves process boundary (answer: never, on-prem). Where keys live.
Where PII could theoretically appear (tool inputs, audit ledger — both
under customer control).

**Vulnerability status.** `osv-scanner` + `trivy fs` + `npm audit`
fused into a single SARIF, published weekly. Open CVEs counted by
severity. SLA: critical 24h, high 7d, medium 30d, low next quarterly.

**Sandbox instructions.** See §3.

**Runbooks.** Plain markdown. Each ≤ 2 pages. Written for a buyer's
on-call engineer, not a Batiste dev.

---

## 2. Pre-Answered Questionnaire Inventory

Goal: when a buyer sends any of these, we reply with the filled workbook
in **≤ 24 h**, not 3 weeks. All answers are maintained in a canonical
"answer bank" (`/nda/questionnaires/answer-bank.yaml`) so each workbook
is assembled from the same source of truth — no drift between SIG and
CAIQ answers for the same underlying control.

| # | Name | Publisher | Typical Qs | Canonical Source | Effort to Pre-Answer (today) |
|---|---|---|---|---|---|
| 2.1 | SIG Lite 2026 | Shared Assessments | ~150 | sharedassessments.org (member download) | **3 eng-days** — mostly maps to existing answers; add 40 AI-specific |
| 2.2 | SIG Core 2026 | Shared Assessments | ~800–1200 | sharedassessments.org | **12 eng-days** — drafted across 2 sprints; reuse SIG Lite |
| 2.3 | CAIQ v4.0.2 | Cloud Security Alliance (CSA) | ~261 | cloudsecurityalliance.org/star (free) | **4 eng-days** — maps ~90 % to SIG Core |
| 2.4 | VSA Full 2026 | Shared Assessments | ~250 | sharedassessments.org | **3 eng-days** — subset of SIG Core |
| 2.5 | HECVAT Full 3.05 | EDUCAUSE | ~265 | educause.edu/hecvat (free) | **4 eng-days** — edu-flavored but maps to SIG Core |

### 2.1 SIG Lite 2026

- **What it is.** The most common starter questionnaire at Fortune 1000 procurement gates. Covers 18 Shared Assessments domains at tier-1 depth.
- **Typical question count.** ~150 (2026 rev).
- **Canonical source.** sharedassessments.org member portal; buyer usually sends the workbook, we return completed. Non-members can be forwarded a blank by the buyer.
- **Realistic effort today.** 3 engineering days. ~60 % of questions answerable directly from our ARCHITECTURE.md + the three middleware layers. Gaps: formal access review cadence, HR background-check policy (we have 1 employee — answer honestly), business continuity drill cadence.
- **Publish cadence.** Refresh quarterly or on any `packages/audit`, `packages/auth`, `packages/scope` API change.

### 2.2 SIG Core 2026

- **What it is.** The deep version of SIG. Required by financial services, healthcare, and regulated public-sector buyers.
- **Typical question count.** ~800–1200 depending on scoping.
- **Canonical source.** Shared Assessments member workbook.
- **Realistic effort today.** 12 engineering days. Most weight sits in: vendor management (~100 Qs — we have a short sub-processor list), app sec (~150 Qs — directly answerable from our zero-trust chain), privacy (~80 Qs — on-prem deployment simplifies), BC/DR (~60 Qs — we need to write our DR runbook before answering honestly).
- **Dependency.** Blocks on Eixo 7 observability delivering MTTR metrics.

### 2.3 CAIQ v4.0.2

- **What it is.** Cloud Security Alliance's Consensus Assessment Initiative Questionnaire. Free and open. Required for CSA STAR listing.
- **Typical question count.** ~261.
- **Canonical source.** cloudsecurityalliance.org/star/registry — free download of blank workbook. We submit completed to CSA STAR Level 1 (self-assessment) and publish on dd portal.
- **Realistic effort today.** 4 engineering days. ~90 % reuse from SIG Core answer bank. CSA STAR Level 1 submission itself is free and takes ~2 days of paperwork.
- **Win.** STAR Level 1 listing is a checkbox procurement often asks for — having it pre-done removes a gate.

### 2.4 VSA Full 2026

- **What it is.** Vendor Security Alliance standard assessment. Popular with mid-market and tech-forward enterprises.
- **Typical question count.** ~250.
- **Canonical source.** Shared Assessments (VSA is now under SA).
- **Realistic effort today.** 3 engineering days. Near-total overlap with SIG Core answer bank.

### 2.5 HECVAT Full 3.05

- **What it is.** Higher Education Community Vendor Assessment Toolkit. EDUCAUSE standard. Required for any university procurement.
- **Typical question count.** ~265.
- **Canonical source.** educause.edu/hecvat — free download.
- **Realistic effort today.** 4 engineering days. Edu-specific sections on FERPA and accessibility (WCAG) need original answers; the rest reuses SIG Core.
- **Note.** Not urgent for our initial enterprise ICP (financial + healthcare) but trivial to pre-answer given the reuse, so we do it.

### 2.6 Answer Bank Mechanics

Single YAML file, one answer per control ID. Each workbook generator
script (`scripts/dd/render-sig.ts`, `render-caiq.ts`, etc.) maps
workbook rows to answer-bank IDs and emits a filled XLSX. This is the
forcing function that prevents drift — if the answer to "do you encrypt
audit logs at rest" changes, it changes in exactly one place.

---

## 3. Reproducible Sandbox Spec — `docker compose up batiste-dd-demo`

A single command stands up a **complete, fully-featured Batiste instance
with seeded data**, running on the buyer's laptop, in < 60 seconds.

### 3.1 Components

| Service | Image | Port | Purpose |
|---|---|---|---|
| `batiste-marketplace` | `batiste/marketplace:<version>` | 8080 | Node registry + routing + billing HTTP API |
| `batiste-node-code` | `batiste/node-code:<version>` | 4001 | Code analysis MCP node (10 tools) |
| `batiste-node-connectors` | `batiste/node-connectors:<version>` | 4002 | PDF + CSV MCP node |
| `batiste-node-rogue` | `batiste/node-rogue:<version>` | 4003 | Intentionally misbehaving node (for playground §8) |
| `batiste-web` | `batiste/web:<version>` | 3000 | Dashboard UI |
| `batiste-seed` | `batiste/seed:<version>` | — | One-shot: issues demo JWTs, seeds audit history, registers nodes |

All services are **air-gapped** by default (`network_mode: internal`)
except the dashboard port published to host. No egress. Buyer can
verify with `docker network inspect`.

### 3.2 Seeded Data

- 1 000 synthetic audit-ledger rows spanning 30 days (realistic distribution of allow/deny/error)
- 50 synthetic billing records across 3 sessions
- 5 pre-issued JWT tokens with distinct scope claims:
  - `demo-admin` — wildcard
  - `demo-analyst` — `code/*` tools, no filesystem write
  - `demo-pdf` — `parse_pdf` only
  - `demo-revoked` — issued then revoked (shows kill-switch path)
  - `demo-expired` — expired 1h ago (shows auth denial path)
- 3 sample PDFs + 2 CSVs in `./sample-data/` mounted into the connectors node
- 1 pre-configured access policy denying `**/*.env`, `**/*.secret`, `**/.ssh/**`

### 3.3 Done Criteria

A sandbox run is considered healthy when **all** of the following pass
in `docker compose exec batiste-seed batiste dd-check`:

1. `GET http://localhost:8080/health` returns 200 within 10 s of `up`
2. `GET http://localhost:8080/nodes` lists 3 registered nodes, all `online`
3. `GET http://localhost:3000` serves the dashboard
4. `batiste connect --capability ast_analysis --token demo-analyst` routes and executes a tool call
5. Audit ledger row count ≥ 1001 after step 4
6. `batiste kill-switch activate && batiste connect --capability ast_analysis` returns `killed` within 1 ms
7. `batiste kill-switch reset` clears the lock
8. `curl http://localhost:8080/metrics` returns p50/p95/p99 latency JSON
9. Scope denial: attempting `parse_pdf /secrets/.env` returns `denied_by_scope` and appears in audit ledger with `decision=deny`
10. Tamper detection: SQL-editing an audit row then running `batiste audit verify` returns `tamper_detected`

Each check maps to one playground scenario (§8) so a buyer can reproduce
the DD claims with their own eyes.

### 3.4 Reset

`docker compose down -v && docker compose up` always produces a
byte-identical starting state (seed is deterministic; no random keys —
all demo JWTs use a pinned signing key checked into the seed image).
This is the "reproducible" in reproducible sandbox.

---

## 4. Compliance One-Pager Outlines

Each is exactly one side of US Letter. Buyer's GRC team reads these in
the first five minutes; they decide whether to keep going.

### 4.1 SOC 2 One-Pager

1. **Trust Services Criteria in scope:** Security (common criteria), Availability, Confidentiality, Processing Integrity. Privacy handled separately under GDPR.
2. **Controls map table** — 4 rows: CC6 (Logical Access) → `@batiste-aidk/scope` + `@batiste-aidk/auth`; CC7 (System Operations) → `@batiste-aidk/audit` + kill switch; CC8 (Change Management) → Git + release process; A1 (Availability) → marketplace routing EMA + `pruneStale()`.
3. **Evidence locations** — pointer to `/nda/control-mappings/soc2-cc6.csv` and `soc2-cc7.csv`.
4. **Current state** — Type I report target Q3 2026; Type II Q1 2027. Today: self-attested; independent observability (Eixo 7) already bakes in evidence capture.
5. **What we ask the buyer to accept pre-SOC2** — self-attestation + reproducible sandbox + observable kill-switch latency in lieu of auditor report until Q3 2026.

### 4.2 ISO 27001 One-Pager

1. **Scope statement** — the 10 packages in `packages/` and the marketplace gateway.
2. **Annex A coverage table** — A.5 (Information Security Policies), A.8 (Asset Management), A.9 (Access Control: mapped to scope + auth), A.10 (Cryptography: JWT RS256/HS256 + TLS via `tls-manager.ts`), A.12 (Operations), A.14 (System Acquisition/Dev), A.16 (Incident Mgmt), A.17 (BC), A.18 (Compliance).
3. **SoA (Statement of Applicability)** — pointer to `/nda/control-mappings/iso27001-A.5-A.18.csv`; every A control has status `implemented | compensating | not-applicable` with justification.
4. **ISMS status** — scope documented; policies drafted; internal audit scheduled Q2 2026; certification target Q4 2026.
5. **Residual risk statement** — single-vendor risk (us) acknowledged; on-prem deployment materially reduces supply-chain exposure.

### 4.3 HIPAA One-Pager

1. **Position.** Batiste is a business-associate-capable platform. On-prem deployment means Batiste-the-company does not process PHI; the covered entity / BA deploying Batiste does.
2. **Technical Safeguards § 164.312 mapping:**
   - (a)(1) Access Control → `@batiste-aidk/scope` + `@batiste-aidk/auth`
   - (a)(2)(i) Unique User ID → JWT `sub` claim
   - (a)(2)(iii) Automatic Logoff → session expiry in `token-verifier.ts`
   - (a)(2)(iv) Encryption/Decryption → at-rest via OS FDE + TLS in transit
   - (b) Audit Controls → append-only ledger in `@batiste-aidk/audit`
   - (c)(1) Integrity → ledger hash-chain (Eixo 3 scope)
   - (d) Person/Entity Authentication → JWT signature verification
   - (e)(1) Transmission Security → TLS 1.3 via `tls-manager.ts`
3. **BAA template.** Published at `/public/compliance/hipaa-baa-template.md`. Signable as-is when Batiste SaaS tier launches (Q4 2026). For on-prem today: no BAA required because we are not a BA.
4. **What a covered entity still owns.** PHI minimisation in tool inputs, audit log retention policy, access-review cadence, incident-response integration.

### 4.4 NIST 800-53 Rev 5 One-Pager

1. **Baseline.** Moderate baseline. We publish the full control matrix.
2. **Control family map:**
   - AC (Access Control) → scope + auth packages
   - AU (Audit & Accountability) → audit package (append-only, WAL, deterministic write order)
   - SC (System & Communications Protection) → transport package (TLS, rate-limit, request-validator)
   - SI (System & Information Integrity) → vulnerability management SLA + `@batiste-aidk/audit` tamper detection
   - IA (Identification & Authentication) → JWT via auth package
   - CM (Configuration Management) → Git + signed releases
3. **Assessment status.** Self-assessment complete. Third-party assessment after SOC 2 Type II.
4. **FedRAMP trajectory.** Not today. Low baseline achievable if the customer deploys into a FedRAMP-Moderate enclave (we are the subsystem, not the boundary).

### 4.5 GDPR One-Pager

1. **Role.** Batiste-the-company is **not** a processor for customer data. Customer deploys on-prem; no personal data flows to us. Batiste-the-vendor is a processor only for support telemetry if the customer opts in (default: off).
2. **Article map:**
   - Art. 5 (Principles) → data minimisation by design: agent calls only log metadata unless operator opts in to payload logging
   - Art. 25 (Privacy by Design) → the zero-trust chain IS the privacy-by-design control
   - Art. 30 (Records of Processing) → audit ledger satisfies this when enabled
   - Art. 32 (Security of Processing) → scope + auth + audit + TLS + kill switch
   - Art. 33/34 (Breach Notification) → 24h internal SLA; 72h regulator notification if Batiste-the-company is ever in scope
   - Art. 35 (DPIA) → template provided at `/public/compliance/gdpr-dpia-template.md`
3. **Data subject rights.** On-prem means DSRs are the deployer's responsibility; the audit ledger has erasure tooling (`batiste audit erase --subject <id> --justification <text>`) that preserves a tombstoned hash for integrity.
4. **SCCs/DPF.** N/A for on-prem. For the future SaaS tier: EU data stays in eu-west (Amsterdam); SCCs module 2 attached to MSA.
5. **DPO contact.** dpo@batiste.network (jardhel wears this hat until headcount > 10).

---

## 5. DD SLA Proposal (Published, Refund-Backed)

Every stage has a **published response time** with a **5% annual-contract
discount refund** if we miss. See D2 in §0.

### 5.1 Stage SLAs

| # | Stage | Industry Baseline | Batiste SLA | Speed-Up |
|---|---|---|---|---|
| 1 | NDA turnaround (buyer signs click-through) | 3–5 business days via legal | **< 10 minutes** (self-serve, HelloSign, counter-signed automatically) | 200–500× |
| 2 | Standard questionnaire returned (SIG Lite / CAIQ / VSA / HECVAT) | 3 weeks | **24 hours** | 21× |
| 3 | SIG Core returned | 4–6 weeks | **5 business days** | 4–6× |
| 4 | Architecture call scheduled | 2 weeks | **within 3 business days**; delivered within **7** | ~2× |
| 5 | Sandbox handed over | 1–4 weeks (custom env provisioning) | **immediate** (`docker compose up`) + office hours within 2 business days | 5–20× |
| 6 | Pen-test report shared (under NDA) | 1–2 weeks | **immediate** (pre-staged in `/nda/pen-test/latest-report.pdf`) | 5–10× |
| 7 | Custom control-mapping deltas | 2–4 weeks | **5 business days** | 4–8× |
| 8 | Red-team / adversarial test request | 4–8 weeks | scoped within **3 business days**; executed within **10** | 4–8× |
| 9 | MSA/DPA/BAA redlines returned | 2 weeks | **3 business days** | 3–5× |
| 10 | Decision window (from first buyer contact to "go/no-go" ready) | 3–6 months | **≤ 6 weeks** with cooperating buyer | 2–4× |

"Industry baseline" is drawn from SecurityScorecard 2025 vendor
assessment benchmarks and Shared Assessments 2024 market survey; we
publish the citations at `/public/sla/benchmarks.md`.

### 5.2 Refund Commitment (D2)

**Clause language (draft, pending Eixo 7 legal review):**

> If Batiste misses any published DD-stage SLA (§5.1) during the
> pre-contract phase and the buyer proceeds to sign an annual
> contract within 90 days thereafter, the first annual contract
> value is reduced by 5 % per distinct SLA breach, capped at 15 %
> total. Breaches are logged publicly (aggregated, anonymised) at
> `/public/sla/sla-history.json`. Force-majeure exclusions: buyer
> unresponsiveness > 3 business days pauses the clock.

This refund is **not** a goodwill gesture. It is a pricing mechanism
that forces Batiste internally to treat DD as a product SLA, not a
sales courtesy. The public breach log is the forcing function: if it
ever shows consistent misses, it proves the feature is not real.

### 5.3 Operational Backstop

Each SLA has a single DRI (Designated Responsible Individual) listed
internally. Today: jardhel for all. Escalation path: when headcount > 3,
the SLA map must have a named alternate before any stage crosses one
person. This is a condition of D2 being sustainable.

### 5.4 Out of Scope

- No SLA on whether a buyer closes — only on our response behaviour.
- No SLA on questions that require customer answers first (e.g. we cannot scope a red-team without their target list).

---

## 6. Exit Story Outline

Exit is a feature, not a disaster. We publish it upfront because
refusing-to-exit-cleanly is a buyer's #1 lock-in anxiety.

### 6.1 Data Export Formats

| Data Class | Native Format | Export Formats | Tooling |
|---|---|---|---|
| Audit ledger | SQLite WAL | NDJSON, CSV, Parquet | `batiste audit export --format <fmt> --since <ts>` |
| Billing records | SQLite WAL | NDJSON, CSV, standard CUR-like CSV | `batiste billing export` |
| Node registry | SQLite WAL | JSON, YAML | `batiste marketplace export` |
| Access policy | TS source | JSON, OPA rego (future) | `batiste scope export` |
| JWT signing keys | JWK | JWKS | `batiste auth export-keys` |
| Task database | SQLite WAL | JSON | `batiste tasks export` |

Every export is **cryptographically signable** so the buyer can prove
authenticity post-migration.

### 6.2 Retention Controls

- Audit ledger retention is 100 % customer-configured — there is no cloud side to retain anything.
- Per-table retention policies set via `batiste audit retention set --days <n>`; default unbounded.
- Legal hold flag (`hold: true`) on a row freezes it against retention reaper.
- Erasure tooling (`batiste audit erase --subject <id>`) preserves a tombstone hash for GDPR Art. 17 vs integrity balance.

### 6.3 Contract Exit Terms

Published at `/public/exit-story.md`:

1. **No surprise fees.** Termination-for-convenience allowed with 30 days notice after year 1.
2. **Data return within 14 days** of termination in all formats listed in §6.1.
3. **Cooperation clause** — Batiste engineering supports a competing-tool migration path for 30 days post-termination at no charge.
4. **Key material destruction** — signing keys destroyed on request with a signed certificate of destruction.
5. **Source escrow option** — for annual contracts ≥ €100k, Batiste deposits source + build instructions with an agreed escrow agent (Iron Mountain / Lloyds Escrow); release triggers include Batiste-entity dissolution.
6. **Open license fallback** — if Batiste as a commercial entity ceases trading for 180 days, the source converts to Apache-2.0 (the "dead-man" clause — Eixo 6 deliverable).

### 6.4 Re-DD Upgrade Flow (returning buyer)

When a buyer who previously DD'd Batiste returns after a new major
release:

1. They land on `/dd/diff?from=<prev-commit>&to=<current-commit>`.
2. Auto-rendered diff shows: new packages, SBOM delta, license-report delta, new/retired controls, new questionnaire revisions, new CVEs fixed.
3. Their previously-signed NDA is honoured automatically.
4. "What changed since you last looked" one-pager generated on the fly.
5. Only un-reviewed artifacts require new attestation — **no re-DD of the whole platform**.

This closes the loop: DD is not a one-shot; it is a subscription to
trust signal. The diff view is the payoff.

---

## 7. Deliverables Requested from Other Eixos (Forcing Function)

Each DD artifact has exactly one owning Eixo. These are numbered so
Eixo leads can cite request IDs in their own work plans.

### 7.1 From Eixo 1 — Honesty

- **E1-DD-01.** Honest capability statement: what Batiste does NOT do yet (no SSO, no SAML, no multi-tenant until Q3 2026, no SOC 2 report until Q3 2026). One page. Linked from every compliance one-pager. Blocks §4.
- **E1-DD-02.** Roadmap with dated commitments for every "planned" control. Blocks §4.1–4.4.
- **E1-DD-03.** Disclosure of the headcount reality (today: solo founder; therefore HR-style controls are compensating) so buyers read our SIG/CAIQ answers in context. Blocks §2.1.
- **E1-DD-04.** Honest statement on test coverage quality (446 tests is the headline — honest statement on what is NOT covered). Blocks §1 threat model assumptions.

### 7.2 From Eixo 2 — Bugs

- **E2-DD-05.** Public bug bounty or responsible-disclosure policy + `/security.txt`. Blocks §1 public tier.
- **E2-DD-06.** Open issue snapshot in the SBOM release — known defects, severity, planned fix version. Blocks §1 vuln-status.
- **E2-DD-07.** Published MTTR for severity-1 bugs (last 4 releases). Blocks §5 SLA credibility (we cannot promise 24h DD response if our own bug MTTR is months).

### 7.3 From Eixo 3 — Security

- **E3-DD-08.** Threat model artifact (STRIDE-per-component). Blocks §1.2 threat model.
- **E3-DD-09.** Pen-test report (external firm; scoping doc → report → remediation tracker). Blocks NDA-tier content.
- **E3-DD-10.** Cryptographic review sign-off on JWT key handling, kill-switch atomicity, and audit ledger integrity. Blocks §4 control mappings.
- **E3-DD-11.** Tamper-evident audit ledger design doc (hash chain over rows). Blocks §3.3 done-criterion #10 and §8 Scenario 4.
- **E3-DD-12.** Key management runbook (generation, rotation, revocation, HSM roadmap). Blocks §1.2 runbooks.

### 7.4 From Eixo 4 — Docs

- **E4-DD-13.** Architecture diagrams auto-generated from `ARCHITECTURE.md` + source. Blocks §1 architecture/.
- **E4-DD-14.** Every one-pager in §4 rendered from a single template with the same structure. Blocks §4.
- **E4-DD-15.** Docs site versioned per release, permalinks stable. Blocks §6.4 re-DD diff view.
- **E4-DD-16.** Annotated code tours (literate-programming style) for the three security-critical paths: scope enforce, JWT verify, kill switch. Blocks §8 Scenario 7.
- **E4-DD-17.** Runbooks (§1 tree `/nda/runbooks/`). Blocks §1.

### 7.5 From Eixo 5 — Code Quality

- **E5-DD-18.** Static-analysis baseline (eslint, tsc strict, semgrep rules) published in SARIF. Blocks NDA-tier vulnerability-status/.
- **E5-DD-19.** Dependency-freshness SLO (no dependency > 180 days out of date without justification file). Blocks §1 SBOM hygiene.
- **E5-DD-20.** Deterministic build verification (byte-identical builds from same commit on two machines). Blocks §1 signature integrity claim.
- **E5-DD-21.** Test-coverage per package, per release, on the DD portal. Blocks §2 SIG Core reuse claim.

### 7.6 From Eixo 6 — Licensing

- **E6-DD-22.** Public SBOM generator + signing pipeline (SPDX + CycloneDX + cosign). Blocks §1 `/public/sbom/`.
- **E6-DD-23.** Public license report + copyleft exposure analysis. Blocks §1 `/public/licenses/`.
- **E6-DD-24.** Contributor License Agreement (CLA) + DCO choice documented. Blocks §4.2 ISO Annex A.15.
- **E6-DD-25.** Source-escrow / dead-man Apache-2.0 clause legal draft. Blocks §6.3 item 5–6.
- **E6-DD-26.** NOTICE aggregation per release. Blocks §1 attribution-notices/.

### 7.7 From Eixo 7 — Observability

- **E7-DD-27.** Live governance dashboard endpoints: kill-switch latency, scope denials/sec, audit writes/sec, gateway p50/p95/p99. Blocks §1 `/status/`.
- **E7-DD-28.** Self-monitoring of the DD SLA itself — the breach log at `/public/sla/sla-history.json`. Blocks §5.2 refund clause enforceability.
- **E7-DD-29.** Observability runbook: which signals prove which control; how to reproduce each claim. Blocks §8 all scenarios.
- **E7-DD-30.** Internal DORA-like metrics (change lead time, deployment frequency, MTTR) published aggregated. Blocks §2 SIG Core BC/DR answers.
- **E7-DD-31.** Legal review of D2 refund clause. **Explicit blocker on §5.2.**

---

## 8. Experiential DD Playground — Scenarios

The playground is the sandbox (§3) with a pre-built script menu. Each
scenario is a buyer-driven experiment the buyer runs themselves to
**verify** a Batiste claim — not to be shown by us.

Format: *Setup* → *Action* → *Expected outcome* → *What it proves*.

### Scenario 1 — Try to read a denied file

- **Setup.** Sandbox up. Default access policy denies `**/*.env`.
- **Action.**
  ```bash
  batiste connect --capability file_read --token demo-admin \
    --args '{"path":"/workspace/.env"}'
  ```
- **Expected outcome.** `{"status":"denied_by_scope","reason":"path matches deny pattern **/*.env","decidedAt":"<ts>"}`. Row written to audit ledger with `decision=deny`.
- **What it proves.** Scope enforcement happens *before* the handler — no handler-level bug could ever leak a denied path. AST-level, not regex.

### Scenario 2 — Trigger the kill switch

- **Setup.** Sandbox up; start `batiste status --watch` in a second terminal.
- **Action.**
  ```bash
  # First call: expect success
  batiste connect --capability ast_analysis --token demo-admin
  # Activate kill switch
  batiste kill-switch activate --reason "buyer-test"
  # Retry: expect sub-millisecond denial
  batiste connect --capability ast_analysis --token demo-admin
  ```
- **Expected outcome.** Second call returns `{"status":"killed","latencyMs":<1}`. Status dashboard shows denials/sec spike immediately.
- **What it proves.** Kill-switch atomicity is real, sub-ms, affects ALL nodes (not just one). The "< 1 ms" claim in README is reproducible.

### Scenario 3 — Export and verify the audit log

- **Setup.** Sandbox up with seeded 1000 audit rows.
- **Action.**
  ```bash
  batiste audit export --format ndjson > audit.ndjson
  batiste audit verify --input audit.ndjson
  sha256sum audit.ndjson  # compare to published hash in the sandbox README
  ```
- **Expected outcome.** `verify: OK — 1000 rows, hash chain intact, no gaps`. Byte-for-byte export determinism.
- **What it proves.** Audit export is trustworthy and offline-verifiable. Exit story §6.1 is real.

### Scenario 4 — Tamper with the ledger, watch detection

- **Setup.** Sandbox up.
- **Action.**
  ```bash
  # Edit a row directly (buyer does this themselves — proves we cannot cheat)
  docker compose exec batiste-marketplace sqlite3 /data/audit.db \
    "UPDATE audit_log SET decision='allow' WHERE id=42;"
  batiste audit verify
  ```
- **Expected outcome.** `verify: TAMPER DETECTED at row 42 — hash chain broken between rows 41 and 42`.
- **What it proves.** The ledger is tamper-evident (depends on E3-DD-11). If an insider (or us) silently edits history, the verify tool screams.

### Scenario 5 — Revoked-token rejection path

- **Setup.** Sandbox up. `demo-revoked` token seeded.
- **Action.**
  ```bash
  batiste connect --capability ast_analysis --token demo-revoked
  ```
- **Expected outcome.** `{"status":"denied_by_auth","reason":"token revoked at <ts>"}`. Row in audit ledger.
- **What it proves.** Revocation is honoured at every call site, not merely token-issue time. Claim: "JWT verified on every call" is real.

### Scenario 6 — Rogue-node routing isolation

- **Setup.** Sandbox up with `batiste-node-rogue` running. Rogue node advertises `ast_analysis` capability but returns junk (flips the reliability EMA down).
- **Action.**
  ```bash
  for i in {1..50}; do batiste connect --capability ast_analysis --token demo-admin; done
  batiste marketplace nodes --capability ast_analysis
  ```
- **Expected outcome.** Rogue node's `reliability` score visibly drops; routing automatically prefers the healthy code node. After 60 s of rogue silence, rogue is marked `offline` via `pruneStale()`.
- **What it proves.** Routing algorithm has real feedback — a misbehaving node cannot dominate traffic. README claim "reliability × 0.50" weighting is observable.

### Scenario 7 — Code tour of the security path

- **Setup.** Browser open to `dd.batiste.network/playground/tour/scope-enforce`.
- **Action.** Step through the annotated walk of `packages/scope/src/access-policy.ts` → `file-matcher.ts` → the middleware chain order.
- **Expected outcome.** Every check in the scope path is linked to the test file that proves it (`packages/scope/src/__tests__/*.test.ts`). Each step cites a README/ARCHITECTURE.md claim and shows the line that delivers it.
- **What it proves.** The zero-trust claim is not marketing — it is traceable to code, and the code is traceable to tests. Buyer AppSec is convinced in 10 minutes of reading.

### Scenario 8 — Expired-token probe

- **Setup.** Sandbox up. `demo-expired` token in seeded tokens.
- **Action.**
  ```bash
  batiste connect --capability ast_analysis --token demo-expired
  ```
- **Expected outcome.** `{"status":"denied_by_auth","reason":"token expired at <ts>"}`. No handler execution. Audit row with `decision=deny`, `reason=auth_expired`, `durationMs` reflecting only auth-layer cost.
- **What it proves.** Expiry honoured at verification time (no stale-token grace). Ties off the auth layer behaviour §4.3 HIPAA § 164.312(a)(2)(iii).

---

## 9. Portal Information Architecture (5-click rule)

Every DD task completes in ≤ 5 clicks from `dd.batiste.network`:

| Task | Path |
|---|---|
| Get SBOM | Home → SBOM (1) |
| Get SIG Lite answers | Home → Questionnaires → SIG Lite → Download (3) |
| Start sandbox | Home → Sandbox → Copy command (2) |
| Read threat model summary | Home → Threat Model (1) |
| Sign NDA then grab full threat model | Home → Full Threat Model → Sign → Download (3) |
| Schedule arch call | Home → Book Arch Call (2) |
| Read exit story | Home → Exit (1) |
| Verify DD SLA history | Home → SLA → History (2) |
| Run playground scenario 4 | Home → Playground → Scenario 4 → Run (3) |

No account creation. No "contact sales". No drip-marketing email capture.

---

## 10. Operating Cadence

| Cadence | Artifact | Owner |
|---|---|---|
| On every tag | SBOM, license report, signed checksums, SARIF, architecture diagrams, SLA-history append | Release pipeline |
| Weekly | Vulnerability-status refresh, dependency-freshness report | Security on-call |
| Monthly | Questionnaire answer-bank review; runbook drills | DD DRI |
| Quarterly | Pen-test delta; threat model review; ISO internal audit | Security on-call |
| Annually | Full SIG Core refresh; CAIQ resubmission; STAR renewal | DD DRI |

---

## 11. Metrics We Publish About the DD Surface Itself

The DD portal is a product; we measure it.

| Metric | Target |
|---|---|
| Time from buyer first visit to SBOM download | < 30 s |
| Time from buyer first visit to sandbox running | < 5 min |
| Questionnaire-return median | < 20 h (SLA 24 h) |
| DD SLA breach rate | < 2 % per quarter; reported publicly |
| Re-DD delta acceptance rate (returning buyer accepts diff-only review) | > 80 % |
| Buyer-reported DD NPS (post-decision, anonymous) | ≥ 50 |

All of these are public at `/public/sla/dd-product-metrics.json`,
refreshed monthly. Breach rate > 5 % two quarters in a row auto-opens a
post-mortem publication — another forcing function.

---

## 12. Anti-Patterns Explicitly Avoided

1. **"Contact sales for our security package."** No. Public tier answers 80 % of DD.
2. **"Here is a 300-page SOC 2 report — good luck."** No. One-pagers in §4 with pointers.
3. **Self-congratulatory case studies.** Violates the no-disclosure rule and replaces signal with vibes.
4. **Gating the SBOM behind email.** D1 forbids.
5. **A sandbox that needs our cloud account to run.** No. Docker on the buyer's laptop or nothing.
6. **Unsigned artifacts.** Every downloadable is signed; every download page shows the public key.
7. **Private breach history.** D2 + §5.2 require public, aggregated breach log.
8. **Logo walls.** We have none by policy; DD UX replaces them.

---

## 13. What "Done" Looks Like for Eixo 8

Eixo 8 is shippable when:

- [ ] All artifacts in §1 exist at the published URLs with valid signatures.
- [ ] §2 workbooks fill from the single answer bank; SIG Lite, CAIQ, VSA, HECVAT pre-answered.
- [ ] `docker compose up batiste-dd-demo` passes the §3.3 ten done-criteria from a cold laptop.
- [ ] §4 one-pagers rendered, peer-reviewed.
- [ ] §5 SLA published with D2 clause legally signed-off (Eixo 7 E7-DD-31).
- [ ] §6 exit story published.
- [ ] All 31 requests in §7 have a named owner and a date.
- [ ] §8 eight scenarios runnable from the playground menu.
- [ ] §11 metrics endpoint live.

Eixo 8 is **never** done-done — it is a standing product surface. The
checklist above is "v1 shipped." Afterwards: cadence in §10 owns it.

---

## 14. Open Questions Resolved in This Pass

| # | Question | Resolution |
|---|---|---|
| OQ-1 | Should SBOM + license report be gated by NDA? | **No** — fully public (D1). |
| OQ-2 | Should a DD SLA miss trigger a refund? | **Yes** — 5 % per breach, 15 % cap, pending Eixo 7 legal review (D2). |

## 15. Open Questions Still Open

| # | Question | Resolver |
|---|---|---|
| OQ-3 | Will SOC 2 Type I engagement start in Q2 or Q3 2026? | jardhel + auditor quote |
| OQ-4 | Which pen-test firm for first engagement? | Eixo 3 lead |
| OQ-5 | Source escrow agent choice (Iron Mountain vs Lloyds)? | Eixo 6 legal review |
| OQ-6 | Do we self-host the DD portal or use a static-site provider that meets the air-gap story? | Eixo 7 observability infra design |
| OQ-7 | What is the earliest quarter we can honestly publish first SIG Core completion with signed attestation? | DD DRI, conditional on E7-DD-30 |

---

*End of Eixo 8 scaffold. No code was modified. Feeds back into Eixos 1–7 as §7 numbered requests.*
