---
name: Eixo 6 — Licensing Hygiene
owner: jardhel
status: Draft v1 (investigation + proposal — no code or manifest changes)
depends_on: eixo8_dd_ux_scaffold.md §7.6
obligations:
  - E6-DD-22 public SBOM generator + signing pipeline (SPDX + CycloneDX + cosign)
  - E6-DD-23 public license report + copyleft exposure analysis
  - E6-DD-24 CLA/DCO choice documented
  - E6-DD-25 source-escrow + dead-man Apache-2.0 clause legal draft
  - E6-DD-26 NOTICE aggregation per release
cross_ref:
  - project_dd_as_product.md (DD-as-moat thesis)
  - D1 from Eixo 8: SBOM + license report are PUBLIC (no gating)
---

# Eixo 6 — Licensing Hygiene

> **One-line thesis.** Batiste wins DD on signal, not on lawyers. Every licence
> decision must reduce the time a buyer's Legal/AppSec team needs to say *yes*,
> while preserving the secret-weapon moat that the code is not competitor-
> redistributable. This report produces an inventory, an exposure analysis, and
> a concrete plan to fulfil E6-DD-22 through E6-DD-26.

This is an **investigation + proposal** document. It does not modify source
code, `package.json` files, or introduce new tooling. Execution is left to the
follow-up PRs enumerated in §11.

---

## 0. Summary of findings

- **Licence inventory.** All identified direct runtime dependencies resolve to
  **MIT** except `typescript` (Apache-2.0). Permissive family ≈ 100 % of the
  inspected direct + sampled transitive surface.
- **Copyleft exposure.** **No GPL / AGPL / LGPL / MPL / EPL / CDDL licences
  observed** across direct deps and a broad sample of transitives. No `COPYING`
  files or `LICENSE.GPL*`-style files anywhere under `node_modules/`.
  Two items need resolution (see §1.5): `spawndamnit@3.0.1` declares SPDX
  `"SEE LICENSE IN LICENSE"` (the actual `LICENSE` file text is MIT), and no
  full top-to-leaf scan has yet been done — the lockfile contains ~353 package
  entries but our Read/Grep sweep covered roughly 50 directly and by sampling.
  Honest posture: **"no copyleft found in the scanned surface; full SPDX scan
  blocks §2 before public release"**.
- **Workspace licence declarations.** 9 of 10 `packages/*` manifests declare
  `"license": "MIT"`, but **two packages declare `"UNLICENSED"`**
  (`@batiste-aidk/cli`, `@batiste-aidk/marketplace`) and **`packages/web/`
  has no `package.json` at all**. This is inconsistent and will block SBOM
  signing because the aggregator cannot classify these workspace packages.
- **Top-level repository.** Root `package.json` is `private: true` and has
  **no `license` field**; the README badge says `UNLICENSED`; there is **no
  root `LICENSE` file and no `NOTICE` file**. This is the load-bearing gap.
- **Recommendation (summary of §4).** Adopt **Business Source Licence 1.1
  (BSL) with a 3-year Apache-2.0 change date and a "non-production
  redistribution / non-competitor use" Additional Use Grant** at the
  repository root; keep the ten workspace packages at `MIT` to remain
  publishable to npm and embeddable by customers in their own code; add the
  dead-man Apache-2.0 clause (§10) as a contractual overlay, and a DCO
  (not a CLA) for contributor hygiene. This gives: auditable-for-DD, publish-
  to-npm-viable, non-repackagable-by-AWS, and a credible "code outlives the
  entity" story — the four moats DD buyers actually ask about.

---

## 1. Dependency licence inventory

### 1.1 Methodology

- Walked every `package.json` under `packages/*` and at the repo root.
- For each direct and `devDependencies` entry, read the resolved version's
  `package.json` inside `node_modules/.pnpm/<name>@<version>/node_modules/<name>/`.
- Grepped `"license"` on each, and opened any hit that was not a recognisable
  SPDX expression.
- For `pdf-parse@1.1.4` and `spawndamnit@3.0.1`, which had non-SPDX `license`
  strings in one pass, opened the in-tree `LICENSE` file to confirm the actual
  terms.
- Did **not** run `license-checker` or `cyclonedx-npm` (those are §5
  tasks). Totals below therefore reflect the sampled set, not the full ~353
  transitive closure from the lockfile. The full scan is E6-DD-22/23.

### 1.2 Workspace-internal dependency edges

All `@batiste-aidk/*` inter-package links are `workspace:*` protocol — they
do not introduce external licence obligations. Recorded for completeness.

### 1.3 Root-level devDependencies (top-level `package.json`)

| Package | Version range | Resolved | Licence | SPDX source |
|---|---|---|---|---|
| `@changesets/cli` | ^2.27.0 | 2.29.8 | MIT | `package.json` `"license": "MIT"` |
| `prettier` | ^3.2.0 | 3.8.1 | MIT | `package.json` |
| `turbo` | ^2.0.0 | 2.8.1 | MIT | `package.json` |
| `typescript` | ^5.4.0 | 5.9.3 | Apache-2.0 | `package.json` |

### 1.4 Per-package direct dependencies

**`@batiste-aidk/aidk`**

| Package | Version | Licence |
|---|---|---|
| `@batiste-aidk/core` (workspace) | link | internal |
| `@batiste-aidk/transport` (workspace) | link | internal |
| `@batiste-aidk/auth` (workspace) | link | internal |
| `@batiste-aidk/scope` (workspace) | link | internal |
| `@batiste-aidk/audit` (workspace) | link | internal |
| `zod` | 3.25.76 | MIT |
| `@types/node` (dev) | 20.19.30 | MIT |
| `vitest` (dev) | 2.1.9 | MIT |
| `typescript` (peer) | 5.9.3 | Apache-2.0 |

**`@batiste-aidk/audit`**

| Package | Version | Licence |
|---|---|---|
| `@batiste-aidk/core` | link | internal |
| `better-sqlite3` | 11.10.0 | MIT |
| `zod` | 3.25.76 | MIT |
| `@types/better-sqlite3` (dev) | 7.6.13 | MIT |
| `@types/node` (dev) | 20.19.30 | MIT |
| `vitest` (dev) | 2.1.9 | MIT |
| `typescript` (peer) | 5.9.3 | Apache-2.0 |

**`@batiste-aidk/auth`**

| Package | Version | Licence |
|---|---|---|
| `@batiste-aidk/core` | link | internal |
| `better-sqlite3` | 11.10.0 | MIT |
| `jose` | 6.1.3 | MIT |
| `zod` | 3.25.76 | MIT |
| `@types/better-sqlite3` (dev) | 7.6.13 | MIT |
| `@types/node` (dev) | 20.19.30 | MIT |
| `vitest` (dev) | 2.1.9 | MIT |
| `typescript` (peer) | 5.9.3 | Apache-2.0 |

**`@batiste-aidk/cli`**

| Package | Version | Licence |
|---|---|---|
| `@batiste-aidk/aidk` | link | internal |
| `@batiste-aidk/audit` | link | internal |
| `@batiste-aidk/marketplace` | link | internal |
| `@batiste-aidk/transport` | link | internal |
| `commander` | 12.1.0 | MIT |
| `zod` | 3.25.76 | MIT |
| `@types/node` (dev) | 20.19.30 | MIT |
| `vitest` (dev) | 2.1.9 | MIT |
| `typescript` (peer) | 5.9.3 | Apache-2.0 |

**`@batiste-aidk/code`**

| Package | Version | Licence |
|---|---|---|
| `@batiste-aidk/core` | link | internal |
| `fast-glob` | 3.3.3 | MIT |
| `ignore` | 5.3.2 | MIT |
| `micromatch` | 4.0.8 | MIT |
| `tree-sitter` | 0.21.1 | MIT |
| `tree-sitter-python` | 0.21.0 | MIT |
| `tree-sitter-typescript` | 0.21.2 | MIT |
| `zod` | 3.25.76 | MIT |
| `@types/micromatch` (dev) | 4.0.10 | MIT |
| `@types/node` (dev) | 20.19.30 | MIT |
| `vitest` (dev) | 2.1.9 | MIT |
| `typescript` (peer) | 5.9.3 | Apache-2.0 |

**`@batiste-aidk/connectors`**

| Package | Version | Licence |
|---|---|---|
| `pdf-parse` | 1.1.4 | MIT |
| `zod` | 3.25.76 | MIT |
| `@types/node` (dev) | 20.19.30 | MIT |
| `@types/pdf-parse` (dev) | 1.1.5 | MIT |
| `vitest` (dev) | 2.1.9 | MIT |
| `typescript` (peer) | 5.9.3 | Apache-2.0 |

**`@batiste-aidk/core`**

| Package | Version | Licence |
|---|---|---|
| `@modelcontextprotocol/sdk` | 1.27.1 | MIT |
| `better-sqlite3` | 11.10.0 | MIT |
| `zod` | 3.25.76 | MIT |
| `@types/better-sqlite3` (dev) | 7.6.13 | MIT |
| `@types/node` (dev) | 20.19.30 | MIT |
| `vitest` (dev) | 2.1.9 | MIT |
| `typescript` (peer) | 5.9.3 | Apache-2.0 |

**`@batiste-aidk/marketplace`**

| Package | Version | Licence |
|---|---|---|
| `better-sqlite3` | 11.10.0 | MIT |
| `zod` | 3.25.76 | MIT |
| `@types/better-sqlite3` (dev) | 7.6.13 | MIT |
| `@types/node` (dev) | 20.19.30 | MIT |
| `vitest` (dev) | 2.1.9 | MIT |
| `typescript` (peer) | 5.9.3 | Apache-2.0 |

**`@batiste-aidk/scope`**

| Package | Version | Licence |
|---|---|---|
| `@batiste-aidk/core` | link | internal |
| `micromatch` | 4.0.8 | MIT |
| `zod` | 3.25.76 | MIT |
| `@types/micromatch` (dev) | 4.0.10 | MIT |
| `@types/node` (dev) | 20.19.30 | MIT |
| `vitest` (dev) | 2.1.9 | MIT |
| `typescript` (peer) | 5.9.3 | Apache-2.0 |

**`@batiste-aidk/transport`**

| Package | Version | Licence |
|---|---|---|
| `@batiste-aidk/core` | link | internal |
| `@modelcontextprotocol/sdk` | 1.27.1 | MIT |
| `zod` | 3.25.76 | MIT |
| `@types/node` (dev) | 20.19.30 | MIT |
| `vitest` (dev) | 2.1.9 | MIT |
| `typescript` (peer) | 5.9.3 | Apache-2.0 |

**`@batiste-aidk/web`** — **no `package.json`** (pure static HTML/CSS/JS
under `packages/web/`). Licence implicitly whatever the repo root says; since
the root says nothing, the dashboard code is currently under "all rights
reserved by default". Flagged in §3.

**`examples/investor-demo`** (`@batiste-aidk/investor-demo`, private)

| Package | Version | Licence |
|---|---|---|
| `@types/node` (dev) | 20.19.30 | MIT |
| `tsx` (dev) | ^4.7.0 | (needs-resolution — not inspected; `tsx` is published as MIT per upstream, but was not in this pnpm store snapshot) |

### 1.5 Transitive licence spot-check

The following transitives were inspected directly. Every entry below resolved
to a permissive OSI licence. None are copyleft.

| Package@version | Licence | Family |
|---|---|---|
| `ansi-colors@4.1.3` | MIT | permissive |
| `assertion-error@2.0.1` | MIT | permissive |
| `better-sqlite3@11.10.0` | MIT | permissive |
| `bindings@1.5.0` | MIT | permissive |
| `bytes@3.1.2` | MIT | permissive |
| `cac@6.7.14` | MIT | permissive |
| `chai@5.3.3` | MIT | permissive |
| `check-error@2.1.3` | MIT | permissive |
| `ci-info@3.9.0` | MIT | permissive |
| `content-type@1.0.5` | MIT | permissive |
| `debug@4.4.3` | MIT | permissive |
| `deep-eql@5.0.2` | MIT | permissive |
| `enquirer@2.4.1` | MIT | permissive |
| `es-module-lexer@1.7.0` | MIT | permissive |
| `estree-walker@3.0.3` | MIT | permissive |
| `expect-type@1.3.0` | Apache-2.0 | permissive |
| `fast-glob@3.3.3` | MIT | permissive |
| `fastq@1.20.1` | — (inferred ISC) | permissive (needs-confirm) |
| `fs-extra@7.0.1` | MIT | permissive |
| `fsevents@2.3.3` | MIT | permissive |
| `glob-parent@5.1.2` | ISC | permissive |
| `http-errors@2.0.1` | MIT | permissive |
| `jose@6.1.3` | MIT | permissive |
| `loupe@3.2.1` | MIT | permissive |
| `magic-string@0.30.21` | MIT | permissive |
| `merge2@1.4.1` | MIT | permissive |
| `micromatch@4.0.8` | MIT | permissive |
| `mri@1.2.0` | MIT | permissive |
| `nanoid@3.3.11` | MIT | permissive |
| `node-addon-api@8.5.0` | MIT | permissive |
| `node-gyp-build@4.8.4` | MIT | permissive |
| `p-limit@2.3.0` | MIT | permissive |
| `package-manager-detector@0.2.11` | MIT | permissive |
| `pathe@1.1.2` | MIT | permissive |
| `pathval@2.0.1` | MIT | permissive |
| `picocolors@1.1.1` | ISC | permissive |
| `postcss@8.5.6` | MIT | permissive |
| `prebuild-install@7.1.3` | MIT | permissive |
| `prettier@3.8.1` | MIT | permissive |
| `raw-body@3.0.2` | MIT | permissive |
| `rc@1.2.8` | (BSD-2-Clause OR MIT OR Apache-2.0) | permissive (triple) |
| `resolve-from@5.0.0` | MIT | permissive |
| `rollup@4.57.1` | MIT | permissive |
| `semver@7.7.3` | ISC | permissive |
| `simple-get@4.0.1` | MIT | permissive |
| `spawndamnit@3.0.1` | "SEE LICENSE IN LICENSE" (text = MIT) | **needs-resolution (SPDX string is non-standard)** |
| `std-env@3.10.0` | MIT | permissive |
| `tar-fs@2.1.4` | MIT | permissive |
| `term-size@2.2.1` | MIT | permissive |
| `tinybench@2.9.0` | MIT | permissive |
| `tinyexec@0.3.2` | MIT | permissive |
| `tinypool@1.1.1` | MIT | permissive |
| `tinyrainbow@1.2.0` | MIT | permissive |
| `tree-sitter@0.21.1` | MIT | permissive |
| `tree-sitter-python@0.21.0` | MIT | permissive |
| `tree-sitter-typescript@0.21.2` | MIT | permissive |
| `tunnel-agent@0.6.0` | Apache-2.0 | permissive |
| `turbo@2.8.1` | MIT | permissive |
| `typescript@5.9.3` | Apache-2.0 | permissive |
| `undici-types@6.21.0` | MIT | permissive |
| `vite@5.4.21` | MIT | permissive |
| `vite-node@2.1.9` | MIT | permissive |
| `vitest@2.1.9` | MIT | permissive |
| `why-is-node-running@2.3.0` | MIT | permissive |
| `zod@3.25.76` | MIT | permissive |

**Not yet inspected, flagged needs-resolution for the first SBOM run:**
remaining ~220 transitive `node_modules/.pnpm/*` entries, almost all of
which are small utilities from the ecosystem that empirically resolve to
MIT/ISC/BSD/Apache. The automated scanner (§6) is responsible for the
closed-loop verification. **Do not let that finding creep into the public
release claim until §6 has run once end-to-end.**

### 1.6 Rollup by family (inspected surface only)

| Family | Count (≈) | % |
|---|---|---|
| MIT | 60 | ~89 % |
| ISC | 4 | ~6 % |
| Apache-2.0 | 3 | ~4 % |
| BSD-2-Clause / BSD-3-Clause | 0 direct; `rc` dual-listed | — |
| Dual/triple-licensed with permissive option | 1 (`rc`) | — |
| Non-SPDX, resolves to MIT | 1 (`spawndamnit`) | — |
| **Copyleft (GPL/AGPL/LGPL/MPL/EPL/CDDL/CPL)** | **0** | **0 %** |

---

## 2. Copyleft exposure analysis

### 2.1 Findings

**No copyleft licences observed in the scanned surface.**

Evidence supporting the claim:

- Grepped `"license"` across all inspected `node_modules/.pnpm/*/node_modules/*/package.json`:
  zero hits for `GPL`, `AGPL`, `LGPL`, `MPL`, `EPL`, `CDDL`, or `CPL`.
- Glob-searched for filenames that typically accompany copyleft distributions
  (`COPYING`, `LICENSE.GPL*`, `LICENSE-GPL*`, `GPL-*`): **zero matches**.
- Tree-sitter native bindings (`tree-sitter`, `tree-sitter-python`,
  `tree-sitter-typescript`) — the parent C project is MIT; the npm bindings
  we resolved are MIT. No libstdc++ static linking issue (these are loaded
  dynamically as Node N-API modules).
- `better-sqlite3` wraps upstream SQLite, which is **Public Domain**;
  npm distribution is MIT. Not copyleft.
- `jose` (JWT library) is MIT.

### 2.2 Severity

**Current severity: None observed. Unverified surface: medium until §6 runs.**

The gap between "scanned sample" and "full lockfile closure" is the only
honest risk. Given that 100 % of the inspected packages are permissive and
none of the top-level deps pull in known copyleft families, the residual
probability of a hidden GPL dependency in the unscanned tail is low but not
zero. **Release-blocker:** run the automated license scanner (§6) against
`pnpm install --frozen-lockfile` output once before any public SBOM
publication, and treat any non-permissive hit as a Sev-1.

### 2.3 Mitigations if a future copyleft dep appears

If a transitive ever resolves to GPL/AGPL/LGPL:

1. **LGPL** — tolerable if dynamically linked (Node's require boundary is
   generally considered sufficient; document the boundary in an ADR).
   Mitigation: keep it dynamically linked; concatenate the LGPL NOTICE.
2. **GPL (non-L)** — *escalate immediately*. Not compatible with BSL
   source-available distribution under most interpretations. Replace.
3. **AGPL** — *replace without delay*. Network-use copyleft breaks the
   on-premise zero-trust positioning ("code never leaves your network" loses
   force if the code itself forces you to publish derivatives).
4. **MPL-2.0** — file-level copyleft. Tolerable with careful isolation but
   adds friction. Prefer replacement if feasible.

### 2.4 Standing copyleft policy (proposed)

> **Policy:** Batiste and all `@batiste-aidk/*` packages accept dependencies
> licensed under any OSI-approved permissive licence (MIT, ISC, BSD-2,
> BSD-3, Apache-2.0, 0BSD, CC0, Unlicense, Zlib, Python-2.0). LGPL is
> permitted with a recorded ADR justifying the dynamic-linking boundary.
> GPL, AGPL, MPL, EPL, CDDL, and CPL dependencies are disallowed without
> explicit Eixo 6 sign-off.

Implementation: a pre-commit or CI check that parses
`license-checker-rseidelsohn --json` and fails on any licence not in the
allow-list. Blocks on E6-DD-22.

---

## 3. Workspace package licence declarations — audit

### 3.1 Current state

| Workspace | Manifest present? | `license` field | Notes |
|---|---|---|---|
| root `/package.json` | yes | **none** + `private: true` | README badge says `UNLICENSED`; no root `LICENSE` file |
| `packages/aidk` | yes | `MIT` | OK |
| `packages/audit` | yes | `MIT` | OK |
| `packages/auth` | yes | `MIT` | OK |
| `packages/cli` | yes | **`UNLICENSED`** | inconsistent with README + siblings |
| `packages/code` | yes | `MIT` | OK |
| `packages/connectors` | yes | `MIT` | comment "Proprietary connectors" in description; mismatch with MIT |
| `packages/core` | yes | `MIT` | OK |
| `packages/marketplace` | yes | **`UNLICENSED`** | inconsistent with siblings |
| `packages/scope` | yes | `MIT` | OK |
| `packages/transport` | yes | `MIT` | OK |
| `packages/web` | **missing** | n/a | static assets only; SBOM cannot classify |

### 3.2 Problems this creates for DD

1. **Mixed signal.** A buyer's AppSec team scanning
   `npm view @batiste-aidk/cli license` sees `UNLICENSED` while
   `npm view @batiste-aidk/core license` sees `MIT`. Their auditor will
   either flag inconsistency or conservatively treat all of Batiste as
   `UNLICENSED`, losing the "auditable-for-DD" win.
2. **npm publish blocked / ambiguous.** `UNLICENSED` is valid SPDX-like but
   downstream automated tooling (Snyk, FOSSA, Dependabot) categorises it as
   "proprietary" and refuses to summarise dependents.
3. **SBOM classification.** A CycloneDX 1.5 aggregator emits `"licenses":
   []` for `UNLICENSED` packages, which triggers manual review gates at
   many F500 buyers.
4. **`packages/web` has no manifest**, so it is silently excluded from the
   SBOM, which makes the SBOM incomplete for a package the customer
   actually runs.

### 3.3 Proposed target state (pending §4 strategy sign-off)

| Workspace | Proposed licence | Rationale |
|---|---|---|
| root | `BUSL-1.1` (with `additional_use_grant` + `change_date` headers) | See §4 |
| `packages/*` (all 11) | `MIT` | Must be publishable to npm; must be embeddable by customers; MIT is the lowest-friction answer and matches the "tool-level primitives are open" posture |
| `packages/web` | add a `package.json` declaring `MIT` and `"private": true` (or publishable as `@batiste-aidk/web`) | Fixes SBOM gap |

Rationale for the split: the *assembled product* is BSL (commercial
redistribution restricted), but each *primitive* is MIT so that embedding
Batiste primitives in a customer's own internal infrastructure is
frictionless. This is the same split used by HashiCorp (Terraform BSL,
libraries MIT) and Sentry (Sentry BSL, SDKs MIT).

---

## 4. Licence-strategy proposal

### 4.1 Goal (from the DD-as-product thesis)

Three non-negotiables:

1. **Enterprise legal can say yes in under an hour.** A buyer's paralegal
   must recognise the licence family on sight.
2. **The code is auditable for DD.** Source must be visible; the SBOM must
   be verifiable; the artefact chain must sign.
3. **Not competitor-repackagable.** A hyperscaler cannot take Batiste,
   rename it, and host it as a managed service. This is the "secret-weapon
   positioning" load-bearing requirement.

### 4.2 Options considered

| Option | Enterprise-friendly? | Competitor-proof? | DD-auditable? | Verdict |
|---|---|---|---|---|
| A. Pure Apache-2.0 | Yes | **No** (AWS precedent) | Yes | Rejected — loses moat |
| B. Pure proprietary EULA (closed source) | Mixed (legal OK, AppSec hates it) | Yes | **No** — blocks DD | Rejected — kills social proof |
| C. AGPL-3.0 | **No** (most Fortune 500 ban AGPL) | Yes | Yes | Rejected — enterprise veto |
| D. Elastic Licence v2 | Mostly | Yes | Yes | Candidate but unmaintained SPDX ID; signals "unfinished" |
| E. SSPL | Mostly | Yes | Yes | **Rejected** — OSI-rejected; AppSec red flag |
| F. BSL 1.1 (Business Source Licence) + change date | Yes (well-known) | Yes | Yes | **Recommended** |
| G. Fair-code / Sustainable-use | Mixed (niche) | Yes | Yes | Too unfamiliar; adds friction |

### 4.3 Recommendation: BSL 1.1, change date +3 years, Apache-2.0 conversion

**Headers for the root `LICENSE` file:**

- **Licensor:** Batiste B.V. (Eindhoven, Netherlands).
- **Licensed Work:** Batiste ≤ v1.x (the marketplace, CLI, dashboard —
  everything under the repo root *except* the `packages/*` directories
  released under MIT).
- **Additional Use Grant:** *You may use the Licensed Work in production
  provided your use does not consist of offering the Licensed Work, or a
  derivative of it, to third parties as a hosted or managed service that
  provides users with features or functionality substantially similar to
  those offered by Batiste B.V.'s own commercial offering.*
- **Change Date:** three years after each release's publication.
- **Change Licence:** Apache-2.0.

**Per-package licences (inside `packages/*`):** MIT.

### 4.4 Why BSL specifically

- **Recognised.** HashiCorp (Terraform, Vault 2023+), MariaDB, Sentry,
  CockroachDB, Couchbase, Vercel (Next.js analytics) — BSL is now the
  dominant source-available licence. An F500 paralegal has seen it.
- **Auditable.** Source is public. DD teams can read every line, SBOM, and
  build script.
- **Competitor-proof for three years.** AWS cannot relist Batiste as
  `AWS Batiste` during the window that Batiste B.V. is establishing the
  market — the Additional Use Grant prohibits it.
- **Dead-man friendly.** The Change Date automatically converts old
  versions to Apache-2.0 without requiring human intervention. If the
  entity dissolves mid-cycle, the newest unconverted code still has a
  pre-published conversion horizon, which is enough substrate for the §10
  clause to land.
- **Npm-compatible at the primitive level.** `packages/*` stay MIT, so
  they publish to npm with no surprises; the BSL layer only applies to the
  orchestrator (CLI + dashboard + marketplace service).

### 4.5 Tradeoffs and honest disclosure in DD

- BSL is **not OSI-approved**. Must be disclosed on the DD portal
  one-pager so AppSec does not get surprised. Recommended copy:
  > *"Batiste is source-available under BSL 1.1 with a three-year
  > Apache-2.0 change horizon. Individual `@batiste-aidk/*` packages are
  > MIT. We chose this model to give enterprise customers full audit
  > rights while preventing uncontracted competitor redistribution during
  > the commercial window."*
- Some conservative procurement playbooks will still ask for Apache-2.0.
  Fallback: point them at the Change Date roadmap and the source-escrow
  §9. In practice this is a 10-minute conversation, not a deal-killer.

### 4.6 What this forces us to change (not done in this doc)

- Add root `LICENSE` file with the BSL 1.1 text and the fields in §4.3.
- Flip `packages/cli` and `packages/marketplace` from `UNLICENSED` to `MIT`
  (or to BSL-1.1 if the decision is to classify them as "part of the
  orchestrator" rather than "a primitive"). Proposed: keep them MIT for
  npm publishing consistency; the BSL applies to the *repo as a deployable
  product*, not the individual `npm` artifacts.
- Update the README badge from `UNLICENSED` to
  `BSL-1.1 (packages: MIT)`.
- Update `CONTRIBUTING.md` to reference the DCO (§8).

---

## 5. SBOM generator — implementation plan (E6-DD-22)

### 5.1 Target artefacts (per release)

Published to `dd.batiste.network/public/sbom/`:

```
batiste-<version>-<commit>.spdx.json        (SPDX 2.3)
batiste-<version>-<commit>.cdx.json         (CycloneDX 1.5)
batiste-<version>-<commit>.sbom.sig         (cosign signature)
batiste-<version>-<commit>.spdx.sha256
batiste-<version>-<commit>.cdx.sha256
diff/<prev-commit>..<commit>.md             (human-readable delta)
```

### 5.2 Tool selection

| Format | Tool | Version | Justification |
|---|---|---|---|
| CycloneDX 1.5 | `@cyclonedx/cyclonedx-npm` | `^2.x` | Official OWASP tool; pnpm-aware; emits 1.5 natively; active maintenance |
| SPDX 2.3 | `@cyclonedx/cyclonedx-npm` (via `--output-format spdx`) **OR** `@microsoft/sbom-tool` | latest | `spdx-sbom-generator` (KusariInc) is semi-maintained; prefer Microsoft's `sbom-tool` for SPDX 2.3 JSON if a second tool is acceptable |
| License enumeration | `license-checker-rseidelsohn` | `^4.x` | Fork of Davis's `license-checker`; handles pnpm `node_modules/.pnpm/` layout correctly |
| Signing | `cosign` (Sigstore) | `^2.x` | Industry standard; keyless flow works in GitHub Actions OIDC |

Do **not** adopt `syft` at this stage: it's excellent but adds a Go
toolchain dependency and our build is pure Node. Revisit if we ever ship
non-Node components.

### 5.3 Build-hook placement

Two hooks, in order:

1. **`pnpm build` post-step** (local, non-signing). Runs the generators
   into `./build/sbom/` so developers and CI see the SBOM at every build.
   No signing yet. Time budget: < 5 s.
2. **Release pipeline** (`.github/workflows/release.yml`, gated on tag
   push matching `v*`). Regenerates, signs, and publishes to the DD
   portal bucket. The tag commit is the canonical `<commit>` in the file
   name. Artefacts are also attached to the GitHub Release.

Do **not** run signing on every push to `main` — keyless cosign via OIDC
generates a new entry in the public transparency log every call, and
noise on Rekor dilutes the signal of "a real release happened here".

### 5.4 Cosign key strategy

Two modes, on a sliding maturity curve:

| Phase | Mode | Rationale |
|---|---|---|
| v0.x (now through v1.0-beta) | **Sigstore keyless** (`cosign sign-blob --oidc-issuer https://token.actions.githubusercontent.com ...`) | No key management burden; every signature is provably tied to a GitHub Actions run on the `jardhel/batiste` repo; the transparency-log entry itself is the trust anchor. Cheapest way to get E6-DD-22 shipped. |
| v1.0+ | **Long-lived key pair** held in a YubiKey + a 1Password emergency-vault backup | Enterprise DD teams frequently want a pinned public key they can mirror. Long-lived key lets the DD portal display a single `batiste-release.pub` that buyers can cache. The keyless history stays as fallback verification. |

For E6-DD-22 initial shipment, start with **keyless** and document the
`v1.0` migration on the SBOM roadmap page of the DD portal.

### 5.5 Release pipeline (outline — no code yet)

```yaml
# .github/workflows/release.yml (sketch — to be written, not written here)
on: { push: { tags: ['v*'] } }
permissions: { id-token: write, contents: write }
jobs:
  sbom:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: npx @cyclonedx/cyclonedx-npm --output-format json \
               --output-file batiste-$GITHUB_SHA.cdx.json
      - run: npx @cyclonedx/cyclonedx-npm --spec-version 1.5 \
               --output-format xml --output-file batiste-$GITHUB_SHA.cdx.xml
      - run: npx @microsoft/sbom-tool generate -pn batiste -pv $TAG \
               -b . -m ./build/sbom -ps "Batiste B.V."
      - uses: sigstore/cosign-installer@v3
      - run: cosign sign-blob --yes build/sbom/*.json \
               --output-signature build/sbom/sbom.sig \
               --output-certificate build/sbom/sbom.pem
      - run: aws s3 sync build/sbom/ s3://dd-batiste-network/public/sbom/
      - uses: softprops/action-gh-release@v2
        with: { files: build/sbom/* }
```

### 5.6 Verification instructions (published on DD portal)

```
cosign verify-blob \
  --certificate batiste-<ver>-<sha>.sbom.pem \
  --signature batiste-<ver>-<sha>.sbom.sig \
  --certificate-identity-regexp "https://github.com/jardhel/batiste/.*" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  batiste-<ver>-<sha>.cdx.json
```

Ships as a one-liner on `/public/sbom/index.html`.

---

## 6. License report (HTML + JSON) — implementation plan (E6-DD-23)

### 6.1 Tool

`license-checker-rseidelsohn` (fork of `license-checker` with active
maintenance and pnpm support). Runs against the installed
`node_modules/` tree after `pnpm install --frozen-lockfile`.

### 6.2 Output schema (JSON)

```jsonc
{
  "schema": "batiste-license-report/1",
  "generated_at": "2026-04-15T00:00:00Z",
  "commit": "<git sha>",
  "version": "<semver>",
  "policy": {
    "allowed": ["MIT","ISC","BSD-2-Clause","BSD-3-Clause","Apache-2.0","0BSD","CC0-1.0","Unlicense","Zlib","Python-2.0"],
    "review_required": ["LGPL-*","MPL-*"],
    "forbidden": ["GPL-*","AGPL-*","EPL-*","CDDL-*","CPL-*","SSPL-*","Commons Clause"]
  },
  "summary": { "total": 0, "allowed": 0, "review_required": 0, "forbidden": 0, "unknown": 0 },
  "packages": [
    {
      "name": "zod",
      "version": "3.25.76",
      "spdx": "MIT",
      "url": "https://github.com/colinhacks/zod",
      "copyright": "Colin McDonnell",
      "license_file_sha256": "…",
      "pulled_in_by": ["@batiste-aidk/core","@batiste-aidk/auth", "..."],
      "direct": false,
      "policy_verdict": "allowed"
    }
  ],
  "copyleft_exposure": {
    "count": 0,
    "items": []
  }
}
```

### 6.3 Output artefacts

- `license-report.json` (schema above) — the machine-readable truth.
- `license-report.html` — rendered via a tiny `ejs` template (no React) so
  the page is static, accessible, and indexable.
- `license-inventory.csv` — one row per package, for buyer-side pivot tables.
- `copyleft-exposure.md` — human-readable drill-down of anything in
  `review_required` or `forbidden`. **Empty file still published**, with
  the literal phrase *"No copyleft dependencies at this release."* —
  explicit negatives are more trustworthy than missing files.
- `attribution-notices/` directory — see §7.

### 6.4 Where it lives in the build

Same release workflow as SBOM (§5.5). Published under
`dd.batiste.network/public/licenses/`. Each release also updates
`/public/licenses/history.json` appending
`{version, commit, ts, counts}` for the DD "re-DD diff" flow in §6.4 of
the Eixo 8 scaffold.

### 6.5 CI policy gate

In PR workflow: fail the build if `license-report.json.summary.forbidden`
> 0, or if any `packages[].policy_verdict === "unknown"`. The signal is
blunt and loud: you cannot merge a PR that introduces an un-resolved
licence.

---

## 7. NOTICE file aggregation (E6-DD-26)

### 7.1 Current state

**No `NOTICE` file exists** anywhere in the repository (neither at root
nor per package). This is acceptable today because no direct dependency
is Apache-2.0 with mandatory NOTICE content **except** `typescript` (and
its NOTICE is propagated through its own distribution, not embedded in
us at build time). However, as soon as Batiste publishes:

- a signed SBOM claim ("we reproduce every upstream attribution"), or
- binaries that bundle other Apache-2.0 code (a future single-binary
  release via `@vercel/ncc` or similar),

a `NOTICE` file becomes legally required. It also becomes morally
required for DD credibility — "we aggregate notices automatically" is a
small-but-telling signal.

### 7.2 Proposal

Per-release, auto-aggregated, published alongside the SBOM:

```
/public/licenses/attribution-notices/
├── NOTICE.txt        (aggregated, human-readable)
├── NOTICE.json       (machine-readable, one entry per dep)
└── by-package/
    ├── typescript-5.9.3.NOTICE
    ├── expect-type-1.3.0.NOTICE
    └── ...
```

### 7.3 Generator (sketch — to be written)

```
# scripts/generate-notice.js (pseudo)
for each pkg in license-report.json.packages:
  if pkg has NOTICE file in its tarball:
    copy to by-package/<name>-<ver>.NOTICE
  collect copyright line from LICENSE file
emit NOTICE.txt =
  "Batiste <ver> includes third-party software covered by the
   following attributions. Full per-package notices: see by-package/."
  + concatenated copyright lines, deduplicated, alphabetised.
```

No new npm dependency needed — `license-checker-rseidelsohn` already
surfaces `licenseFile` paths; a ~50-line Node script is enough.

### 7.4 Root `NOTICE` file (one-time, hand-written)

Per Apache-2.0 § 4(d) convention, the project also publishes its *own*
root `NOTICE`:

```
Batiste
Copyright (c) 2025–present Batiste B.V. (Eindhoven, Netherlands)

This product includes software developed by the Batiste contributors
under the Business Source Licence 1.1 (see LICENSE) with individual
@batiste-aidk/* packages under the MIT Licence (see each package's
LICENSE file).

Third-party attributions: see /public/licenses/attribution-notices/.
```

Committed at repo root alongside the root `LICENSE`.

---

## 8. CLA vs DCO — decision (E6-DD-24)

### 8.1 Summary recommendation

**Adopt DCO (Developer Certificate of Origin). Do not adopt a CLA today.**
Revisit in 18 months if the relicensing scenario described in §8.5
becomes a live decision.

### 8.2 Comparison

| Dimension | DCO | CLA |
|---|---|---|
| Contributor friction | Very low (`git commit -s`) | Medium-high (sign an agreement, often via CLA-bot + e-signature) |
| Enables future relicensing | **No** — each contributor keeps copyright | **Yes** — the assignee can relicense |
| Legal weight | Per-commit attestation of origin | Contract |
| DD story | "We track origin per commit; auditable in git log" | "We hold relicensing rights" |
| Precedent | Linux kernel, Docker, GitLab, Chef | Google, Meta, Apache Foundation |
| Signal to contributors | "We're a pragmatic OSS-style project" | "We're a company accumulating rights" |

### 8.3 Why DCO is the right call now

1. **BSL already gives Batiste B.V. the commercial moat.** Relicensing
   rights (the main CLA win) matter only if we want to take the code
   closed, which is the opposite of the DD-as-moat strategy.
2. **Contributors respond to DCO positively and to CLAs with suspicion.**
   Given Batiste is at *v0.1.0-beta* with solo maintainership, losing
   even one contributor to "why do I have to sign a thing" is expensive.
3. **DCO is compatible with the source-escrow / dead-man clause (§9–§10)**
   because the escrow releases the code *as-is under Apache-2.0*, and
   every contributor has already attested (via DCO) that they had the
   right to submit their patch under the inbound licence. The downstream
   relicensing under Apache-2.0 in the conversion event is permitted by
   both BSL's own change-date mechanism and by standard inbound=outbound
   OSS theory.
4. **Cheaper to set up.** Enable `github/dco` App on the repo; add a
   single paragraph to `CONTRIBUTING.md`; done.

### 8.4 Implementation

Update `CONTRIBUTING.md` (future PR):

```
## Developer Certificate of Origin

By making a contribution to Batiste, you certify that the contribution is
your original creation or that you have the right to submit it under the
project's inbound licence. We enforce this via the Developer Certificate
of Origin 1.1 (https://developercertificate.org/). Every commit must be
signed off:

    git commit -s -m "feat: ..."

PRs with unsigned commits will be blocked by CI (github/dco bot).
```

### 8.5 When to revisit (CLA migration trigger)

Only consider a CLA if:

- Batiste B.V. needs to offer the code under a **third** licence (e.g.,
  Apache-2.0 for a specific government deployment) before the BSL change
  date, and that licence is not compatible with inbound=outbound DCO
  assumption, AND
- The contributor pool has grown enough (> 20 external committers) that
  individually requesting re-licensing grants is impractical.

If both hold, migrate to DCO+CLA-dual (DCO remains for small fixes; CLA
required for non-trivial contributions over a threshold line count). Do
not remove the DCO path — contributor-friendly signalling.

---

## 9. Source-escrow legal draft — outline (E6-DD-25, part 1)

### 9.1 Why source escrow at all

Enterprise buyers of infrastructure software fear the vendor-death
scenario: vendor dissolves, support evaporates, customer is stranded
with critical internal systems running on unmaintained code. Source
escrow is the standard pre-contractual answer. For Batiste, it also
reinforces the DD-as-product story: *"you can keep running Batiste even
if Batiste itself does not exist"*.

### 9.2 Agent selection — Iron Mountain vs Lloyds Escrow

| Dimension | Iron Mountain Digital Records | Lloyds Escrow (NCC Group) |
|---|---|---|
| Global reach | US + EU + APAC | UK-led, EU presence strong |
| Cost (per year, single deposit) | ≈ $2 500 – $5 000 | ≈ £1 500 – £3 500 |
| Release-verification rigour | Good; optional tested-build verification +cost | Industry-leading; standard includes build verification |
| Brand recognition by F500 procurement | Very high | Very high (esp. UK/EU/insurance) |
| Integrates with cloud artefact repos | Yes (S3, Azure Blob pull) | Yes |
| Netherlands entity support | Yes via EU office | Yes via Manchester HQ |

**Recommendation:** **NCC Group / Lloyds Escrow** for year-1. Rationale:
Batiste B.V. is an EU entity; NCC's build-verification service is
standard (not a premium add-on); UK/EU insurance-industry familiarity is
disproportionately useful for the target buyer profile; pricing is lower
at the smaller deposit sizes Batiste will use initially. Migrate to Iron
Mountain only if a specific US Fortune 500 buyer demands it.

### 9.3 Trigger conditions (release events)

The escrow shall release the deposited package to the listed
Beneficiaries on the earliest of:

1. **Entity dissolution.** Batiste B.V. is liquidated, struck off, or
   filed for bankruptcy protection that is not rescinded within 60 days.
2. **Assignment-for-benefit-of-creditors / comparable non-bankruptcy
   insolvency** lasting > 90 days.
3. **Acquisition without a successor support commitment.** Batiste B.V.
   is acquired and the acquirer, within 30 days of closing, does not
   assume in writing the support obligations of the active MSAs.
4. **Support SLA breach** lasting > 90 consecutive days for Severity-1
   issues defined in the MSA.
5. **Published release cadence failure.** No new release signed under the
   cosign key chain (§5.4) for > 12 months, combined with no public
   communication from Batiste B.V., combined with unanswered MSA support
   tickets > 45 days.

Each of (1)–(5) is independently sufficient. The Escrow Agent performs
the factual check; Beneficiaries do not self-certify.

### 9.4 Release format (what actually gets shipped)

One gzipped tarball, signed both by Batiste's cosign key and by the
Escrow Agent's release key, containing:

```
batiste-escrow-release-<trigger-date>/
├── source/
│   ├── <git-bundle-of-main-branch-up-to-trigger-commit>
│   ├── <git-bundle-of-release-branches>
├── build/
│   ├── pnpm-lockfile-frozen.yaml
│   ├── reproducible-build.md   (step-by-step instructions)
│   ├── build.sh                (tested periodically by Escrow Agent)
├── signing-keys/
│   ├── cosign-private-key.enc  (encrypted with the Beneficiary's public key)
│   ├── cosign-public-key.pub
├── docs/
│   ├── ARCHITECTURE.md, README.md, CONTRIBUTING.md, HISTORY.md
│   ├── dd-portal-snapshot/     (mirror of dd.batiste.network at trigger)
│   └── runbooks/
└── legal/
    ├── release-notice.md       (human-readable summary of why release fired)
    └── apache-2.0-grant.md     (§10 conversion clause, auto-invoked)
```

### 9.5 Beneficiary scope

Two classes, declared in each MSA:

- **Class A — named enterprise licensee.** Receives a *confidential*
  copy under the MSA's ongoing confidentiality terms; may use
  internally, not redistribute.
- **Class B — the public.** On release-event class (1)–(3), the repo is
  simultaneously relicensed under Apache-2.0 via the §10 clause, and the
  escrow bundle is published to a pre-arranged GitHub mirror
  (see §10.4). Class B does not receive private signing keys; those go
  only to Class A.

### 9.6 Deposit cadence

- **Minimum:** quarterly.
- **Automatic:** on every tag `v*` push, CI re-uploads the deposit
  bundle to the escrow agent via their pull-from-S3 integration; a
  monthly Agent-side audit confirms integrity.

### 9.7 Annual verification

Every 12 months, the Escrow Agent runs the build from the deposit on a
clean environment, compares the resulting binaries to the signed
release artefacts by sha256, and issues a Verification Certificate to
each Beneficiary. If verification fails, Batiste B.V. has 30 days to
remedy before the deposit is flagged "non-releasable" — which itself
constitutes a support SLA breach under §9.3(4).

### 9.8 Costs

Budget model (year 1, pre-Series-A):

- NCC deposit + storage fee: ~£3 000/year.
- Annual build-verification service: ~£2 000/year.
- Per-customer beneficiary add-on: ~£200/customer/year (passed through
  as a line-item in the MSA).

Total ~£5 000–£10 000/year. Material to a seed-stage entity but
recoverable from a single enterprise MSA. Positioning in §5.2 of the
DD scaffold ("annual contracts ≥ €100k") covers this easily.

---

## 10. Dead-man Apache-2.0 conversion clause — draft (E6-DD-25, part 2)

### 10.1 Goal

Legally binding, mechanistically automatic: *if Batiste B.V. ceases
trading for 180 consecutive days, the source converts to Apache-2.0*.
This is the belt-and-braces to the BSL's own 3-year change date — it
handles the pathological case where the entity dies *before* a release's
change date arrives.

### 10.2 Plain-language clause (to be included in both the root
`LICENSE-BATISTE-ADDENDUM.md` and in every MSA)

> **Dead-Man Apache-2.0 Conversion Clause.**
>
> If Batiste B.V. (the "Licensor") ceases commercial operations for a
> continuous period of one hundred and eighty (180) days — evidenced by
> (i) no active employees or contractors, (ii) no public release,
> security advisory, or support response for 180 days, and (iii) no
> written notice from the Licensor describing an interim operating
> arrangement — then, effective the 181st day, all versions of the
> Licensed Work previously distributed under the Business Source
> Licence 1.1 shall automatically convert to the Apache Licence,
> Version 2.0. This conversion is perpetual, irrevocable, and requires
> no further action by the Licensor or any beneficiary. The determination
> of the 180-day period shall be made, in the first instance, by the
> Trustee (as defined in the Source-Escrow Deed), whose published
> Notice of Conversion shall be conclusive absent manifest error.

### 10.3 Trustee model

A **Trustee** — a named law firm (candidate: Stibbe N.V. in Amsterdam,
given Batiste B.V. is an NL entity) — holds three duties:

1. Maintain a heartbeat check against Batiste B.V.'s Chamber of Commerce
   (KvK) registration, public release cadence, and DD SLA log.
2. On 180 days of silence, publish a **Notice of Conversion** on a
   public page (`trustee.batiste.network/notice` fails over to the
   firm's own website).
3. Instruct the Escrow Agent (§9) to trigger release and to publish the
   Apache-2.0 relicence notice to the pre-arranged GitHub mirror.

Annual Trustee retainer: ~€2 000. Cheap insurance for a big DD signal.

### 10.4 Automated GitHub action fallback

Belt-and-braces in case the Trustee is slow:

```yaml
# .github/workflows/heartbeat.yml (to be written, lives on a mirror repo
# at github.com/batiste-foundation/heartbeat)
on: { schedule: [{ cron: '0 8 * * *' }] }
jobs:
  check:
    steps:
      - run: |
          LAST=$(curl -s https://batiste.network/heartbeat.json | jq -r .last_iso)
          DAYS=$(( ( $(date +%s) - $(date -d "$LAST" +%s) ) / 86400 ))
          if [ $DAYS -gt 180 ]; then
            gh release create deadman-$DAYS --notes-file dead-man-trigger.md
            # the release action then publishes the relicence notice
          fi
```

The `heartbeat.json` is a static file the live Batiste org updates in
every release workflow. Stops updating when the org is dead. The mirror
repo lives under a separately-controlled `batiste-foundation` GitHub
organisation whose admin key is held by the Trustee. Independent path.

### 10.5 Prior art cited on the DD portal

- **Sentry** — BSL 1.1 with 3-year Apache-2.0 change, widely accepted.
- **HashiCorp / Terraform** — BSL 1.1 (post-2023). The same template.
- **MariaDB BSL** — originator of the BSL model, accepted in EU
  procurement.
- **Eclipse Foundation** projects — precedent for Trustee-style
  relicensing mechanisms.

Citing these on the DD one-pager shortcuts the "is BSL real" conversation.

### 10.6 Edge cases and honest disclosure

- **What if the Trustee dies too?** The BSL's own 3-year change date
  remains in force and releases Apache-2.0 on its normal schedule.
  Customers still get the code, just slower. Disclose this in the DD
  portal's licence one-pager.
- **What if a buyer wants Apache-2.0 immediately?** They can negotiate a
  *named-licensee Apache-2.0 grant* as an MSA addendum for an up-front
  fee. The default stays BSL for everyone else.
- **What if Batiste is acquired?** The clause binds successors by
  standard contract-assignment rules; disclose clearly that the 180-day
  trigger resets on a *bona fide* acquisition with support commitment.
  This is a feature, not a bug: acquirers who want to kill the project
  cannot run out the clock by paying one employee to answer tickets.

---

## 11. Deliverables, owners, and follow-up PRs

The following work items are **not** performed in this report. They are
enumerated here so the reader can track Eixo 6 completion against the
commitments in `eixo8_dd_ux_scaffold.md` §7.6.

| # | Item | Blocks | Owner | Scope |
|---|---|---|---|---|
| 1 | Add root `LICENSE` (BSL-1.1, fields per §4.3) | §4 | jardhel | single file |
| 2 | Add root `NOTICE` (§7.4) | §7 | jardhel | single file |
| 3 | Flip `packages/cli` and `packages/marketplace` `license` field from `UNLICENSED` to `MIT` | §3 | jardhel | 2 package.json lines |
| 4 | Add `packages/web/package.json` with `license: "MIT"` (and `private: true` if not publishable) | §3 | jardhel | 1 new file |
| 5 | Update README badge from `UNLICENSED` to `BSL-1.1 (packages: MIT)` | §3, §4 | jardhel | one badge |
| 6 | Update `CONTRIBUTING.md` with DCO section (§8.4) | §8 | jardhel | one section |
| 7 | Enable `github/dco` App on `jardhel/batiste` | §8 | jardhel | repo setting |
| 8 | Write `scripts/generate-sbom.sh` (§5.5 skeleton) | E6-DD-22 | jardhel | new script |
| 9 | Write `.github/workflows/release.yml` (§5.5 sketch) | E6-DD-22 | jardhel | new workflow |
| 10 | Add `license-checker-rseidelsohn` as a devDep; write `scripts/generate-license-report.mjs` to emit the §6.2 schema | E6-DD-23 | jardhel | one devDep + one script |
| 11 | Add PR-time CI gate that fails on `forbidden` licences (§6.5) | §2, E6-DD-23 | jardhel | workflow step |
| 12 | Write `scripts/generate-notice.mjs` (§7.3) | E6-DD-26 | jardhel | one script |
| 13 | Commission BSL-1.1 language review from Stibbe N.V. (NL counsel) | §4 | jardhel | legal retainer |
| 14 | Commission source-escrow deed from NCC Group (§9) | E6-DD-25 | jardhel | contract |
| 15 | Commission Trustee retainer + heartbeat mirror repo (§10) | E6-DD-25 | jardhel | contract + repo |
| 16 | Run full `license-checker` against frozen lockfile and resolve residual `needs-resolution` entries (e.g., `spawndamnit`, `fastq`, and the ~220 unsampled transitives) | §1.5, §2 | jardhel | one report cycle |
| 17 | Publish DD portal pages `/public/sbom/`, `/public/licenses/`, `/public/licenses/attribution-notices/` | E6-DD-22/23/26 | jardhel | coordinated with Eixo 8 |

### 11.1 Sequencing

```
(16) full scanner run  ──►  (1)(2)(3)(4)(5)  ──►  (10)(11)(12)(8)(9)  ──►  (17)
                                         │
                                         └──► (6)(7)  (DCO, parallel)
                                         └──► (13)(14)(15)  (legal, parallel)
```

Critical path: **(16) must pass before any public artefact is shipped**
(otherwise the first release could emit a public SBOM containing a
forbidden licence and the DD signal inverts). Legal work (13–15) runs
in parallel and is the long-pole; start it immediately.

---

## 12. Residual questions for future resolution

- **OQ-6-1** — Should `@batiste-aidk/connectors` remain MIT or move to
  BSL? Its description says *"Proprietary connectors"*, which contradicts
  the MIT field. Two options: (a) keep MIT for the CSV tooling and
  isolate "proprietary" PDF extraction into a separate closed package;
  (b) move the whole `connectors` package under BSL. Recommend (a).
- **OQ-6-2** — Do we want a formal "Contributor Code of Conduct"
  (Contributor Covenant 2.1)? Currently `CONTRIBUTING.md` has a prose
  paragraph only. Not blocking DD, but a DD question at some buyers.
- **OQ-6-3** — Do we self-host the cosign public key material on
  `dd.batiste.network`, or also cross-publish to Sigstore's TUF root +
  Rekor? Recommend: both, with the self-hosted copy being the primary
  canonical link and Rekor as the transparency backstop.
- **OQ-6-4** — Does the BSL's Additional Use Grant scope correctly for
  the marketplace gateway use-case? Needs Stibbe review (item 13) to
  confirm "managed service substantially similar to" does not
  accidentally block legitimate customer deployments of the on-premise
  marketplace to their own users. First draft language proposed in §4.3
  is intentionally narrow; counsel may tighten further.
- **OQ-6-5** — Do we support a paid Apache-2.0-now upgrade path for
  customers who cannot accept BSL? See §10.6. Pricing model TBD; not
  blocking v0.1.0-beta.

---

## 13. Honest caveats

- The dependency inventory in §1 is based on `Read`/`Grep` sampling of
  ~50+ transitives out of ~281 pnpm-store entries (lockfile reports
  353 packages with platform-variant duplication). The claim
  "no copyleft observed" is strictly limited to the scanned surface;
  the full scan (item 16 in §11) is a release-blocker and must be run
  before publishing the first public SBOM.
- `spawndamnit@3.0.1` declares the non-standard SPDX string
  `"SEE LICENSE IN LICENSE"`. Inspecting the `LICENSE` file shows
  verbatim MIT. The scanner must emit `MIT` for this package with a
  note, or downstream tooling will flag it `unknown`.
- `pdf-parse@1.1.4` currently resolves to MIT, but the npm package has
  historically had spotty metadata. Pin carefully in future upgrades
  and re-scan on every bump.
- `typescript` is Apache-2.0, which imposes the NOTICE propagation duty
  the moment we ship any artefact that embeds TS source (we do not
  today — TS is build-time only — but a future `batiste --bundle`
  single-binary would flip this).
- The BSL + dead-man model has strong prior art but has never been
  tested in Dutch court. The Stibbe review (item 13) must explicitly
  confirm enforceability under NL law, not only under the standard
  New York / Delaware templates most BSL examples use.

---

*End of Eixo 6 deliverable.*
