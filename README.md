<div align="center">

<img src="./assets/logo.png" width="120" alt="Batiste" />

# Batiste

Zero-trust runtime for AI agents — route, authorise, audit, and kill-switch every tool call on your own network.

[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D9.0.0-orange)](https://pnpm.io)
[![License: open-core](https://img.shields.io/badge/license-open--core-blue)](#license)

[Quick start](#quick-start) · [Architecture](#architecture) · [CLI](#cli) · [Packages](#packages) · [History](./HISTORY.md) · [Contributing](./CONTRIBUTING.md)

</div>

---

## What Batiste is

Agent pilots stall on the same operational gaps: there is no record of what an agent did, no enforced limit on what it can touch, and no fast way to stop it. Batiste sits between your agents and your tools and closes those gaps at the protocol level. Every tool call is scoped to an explicit path policy, verified against a JWT, and written to an append-only ledger before it reaches a handler — every action **on the record before it runs**, an attestation made before the act rather than a log written after. A kill switch revokes access across every node. The runtime runs on your own infrastructure with no required cloud dependency.

Batiste speaks the Model Context Protocol, so existing MCP tools and clients plug in without rewrites. It is the operational layer the Cachola Tech verticals are built on; the name is a nod to a sous-chef who keeps a kitchen running while the head chef decides what to cook.

---

## Quick start

**Prerequisites:** Node.js ≥ 20, pnpm ≥ 9

```bash
git clone https://github.com/jardhel/batiste.git
cd batiste
pnpm install
pnpm build
npx tsx examples/investor-demo/run.ts
```

The demo runs entirely in-process with no cloud account: a marketplace starts, nodes register, calls route through the zero-trust chain, a billing report is produced, and the kill switch fires.

---

## Architecture

Batiste is a pnpm monorepo. Every agent call passes through three enforcement layers — scope, auth, audit — before it reaches a handler.

```
  ┌─────────────────────────────────────────────────────┐
  │              Marketplace Gateway                     │
  │  NodeRegistry ──► NodeDiscovery ──► RoutingLayer     │
  │       │                                    │         │
  │  PricingMeter ◄── BillingRecord ◄──────────┘         │
  └────────────────────────┬────────────────────────────┘
                           │  POST /route
                 ┌─────────▼──────────┐
                 │   SecureGateway    │  StreamableHTTP
                 │  PerformanceTracker│  p50 / p95 / p99
                 └─────────┬──────────┘
                           │
              ┌────────────▼────────────┐
              │     createNode()        │
              │  Scope → Auth → Audit   │  zero-trust chain
              └────────────┬────────────┘
                           │
          ┌────────────────┼──────────────────┐
          ▼                ▼                  ▼
   Code Analyzer    Doc Intelligence   Compliance Guard
   AST · TDD · LSP  PDF · CSV · ETL    Audit · Kill Switch
```

| Layer | What it does |
|---|---|
| Scope | Glob path policy enforced before the handler runs; deny-listed patterns are rejected outright. AST-level scoping is landing via `@batiste-aidk/graph`. |
| Auth | JWT verification; expired or tampered tokens are rejected before execution. |
| Audit | Append-only SQLite write (WAL); every call, result, and timing is recorded. |

Details are in [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Packages

Batiste is open-core: the runtime primitives are MIT, and a small set of orchestration and marketplace packages are source-available under a proprietary licence. See [License](#license). Where this is heading: [docs/ROADMAP.md](./docs/ROADMAP.md) — every "shipped" entry carries its verification command.

| Package | Licence | Description |
|---|---|---|
| [`@batiste-aidk/aidk`](./packages/aidk) | MIT | `createNode()` factory — composes the scope/auth/audit chain |
| [`@batiste-aidk/scope`](./packages/scope) | MIT | Path-based access policy (glob deny-lists, depth caps) |
| [`@batiste-aidk/auth`](./packages/auth) | MIT | JWT issuance and verification |
| [`@batiste-aidk/audit`](./packages/audit) | MIT | Append-only ledger · KillSwitch · SessionMonitor |
| [`@batiste-aidk/transport`](./packages/transport) | MIT | StreamableHTTP gateway · session management · `PerformanceTracker` |
| [`@batiste-aidk/connectors`](./packages/connectors) | MIT | PDF extraction and RFC 4180 CSV/ETL exposed as MCP tools |
| [`@batiste-aidk/code`](./packages/code) | MIT | Code-intelligence MCP tools — AST analysis, TDD, AutoFix, LSP, codebase summarisation, GVS vault validate/index |
| [`@batiste-aidk/graph`](./packages/graph) | MIT | Call-graph and symbol-graph analysis |
| [`@batiste-aidk/gvs`](./packages/gvs) | MIT | [GVS 0.1](./specs/gvs-0.1.md) reference loader and validator |
| [`@batiste-aidk/core`](./packages/core) | MIT | Shared MCP primitives, orchestration, prompt registry |
| [`@batiste-aidk/memory`](./packages/memory) | MIT | Firm Memory store — private prompt and fact store kept out of public repos |
| [`@batiste-aidk/rls`](./packages/rls) | MIT | Row-level scoping primitives |
| [`@batiste-aidk/sign`](./packages/sign) | MIT | Signing utilities for audit artefacts |
| [`@batiste-aidk/marketplace`](./packages/marketplace) | proprietary | Node registry, capability routing, per-cycle billing |
| [`@batiste-aidk/parallel`](./packages/parallel) | proprietary | Parallel task planning and execution |
| [`@batiste-aidk/cli`](./packages/cli) | proprietary | `batiste` binary for node and marketplace management |
| [`@batiste-aidk/atrium`](./packages/atrium) | proprietary | Orchestration surface |
| [`@batiste-aidk/repo-hygiene`](./packages/repo-hygiene) | proprietary | Repo-hygiene gate (git-clean, no-dup-hash, canonical layout) |

Run `grep -h '"license"' packages/*/package.json | sort | uniq -c` to see the split.

---

## CLI

The `batiste` binary drives the node and marketplace lifecycle:

```bash
# Start a node (local / network / enterprise preset)
batiste node start --preset network --port 4001 --label "Code Analyzer"

# Publish it to the marketplace
batiste node publish \
  --name "Code Analyzer" \
  --endpoint http://localhost:4001 \
  --capabilities ast_analysis,tdd,autofix \
  --price 0.001

# Route to a node for a capability
batiste connect --capability ast_analysis

# Gateway health and p50/p95/p99 latency
batiste status --watch

# Follow the audit ledger
batiste audit tail --follow

# Validate a GVS 0.1 governance vault (spec: ./specs/gvs-0.1.md)
batiste vault validate ./obs_vault/my-firm
batiste vault index ./obs_vault/my-firm --axis decision
```

---

## What it gives you

- Scope, auth, and audit are the call path, not optional middleware — a call that skips them does not reach a handler.
- Runs on your own infrastructure with no required cloud dependency.
- PDF and CSV/ETL extraction run as in-network MCP tools, so document content stays on your side.
- A kill switch revokes session access across nodes (`@batiste-aidk/audit`, `KillSwitch`).
- Per-cycle billing recorded per session.
- A rolling-window p50/p95/p99 latency histogram is exposed at `GET /metrics`.
- 438 tests across the runtime packages run on real SQLite (`:memory:`) with no mocks.

---

## Technology

- Node.js 20+, TypeScript 5, ESM (NodeNext)
- pnpm workspaces, Turborepo
- Model Context Protocol with StreamableHTTP transport
- SQLite (WAL) for audit, billing, registry, and tasks
- Vitest

---

## Compliance

Batiste targets regulated deployments. The on-prem posture keeps data inside the customer network, and the append-only ledger gives an auditor a record of every agent action. The [`compliance/`](./compliance) folder holds the control mappings, policies, and framework documents (GDPR, EU AI Act, NIS2, DORA, SOC 2, ISO 27001) as drafted reference material; start at [`compliance/README.md`](./compliance/README.md) and [`compliance/mappings/batiste-to-controls.md`](./compliance/mappings/batiste-to-controls.md). These map features to controls — they are not third-party certifications.

---

## Dogfooding

The `@batiste-aidk/code` MCP server is loaded as a connector in our own development loop in Cowork mode, so AST, TDD, AutoFix, and codebase-summarise calls run through the same scope/auth/audit chain. Install with `bash scripts/install-cowork.sh`; details in [`docs/COWORK.md`](./docs/COWORK.md).

Beyond the dev loop, Batiste's discipline gates run against Cachola Tech's own public products (Astrus, Mermaid, Argus) — and they fail builds, not just warn:

- **`@batiste-aidk/deploy-lineage`** refuses any deploy whose source is untracked or has uncommitted changes, and stamps the commit SHA on the release. Caught a live page being served from an unversioned local folder.
- **`@batiste-aidk/dfam-preflight`** gates 3D-print STLs before they reach a print partner (flat bottom, overhang, bed-fit). Caught an enclosure that would have printed needing supports.
- **`@batiste-aidk/ui-consistency`** gates landing↔app chrome per product (favicon, fonts, language switch). Caught brand drift between a marketing page and its app.
- **`@batiste-aidk/repo-hygiene`** keeps the tree clean and rejects stale derived artifacts.
- The launch program itself is tracked in an append-only `@batiste-aidk/audit` `TaskLog`, not a third-party tracker.

Honest scope: these are the discipline and audit gates. Running the verticals fully on the Batiste request runtime is in progress, not shipped — the gates are what is verifiable today.

---

## License

Open-core. The runtime primitive packages are MIT-licensed (per-package `package.json`); the marketplace, parallel-execution, CLI, atrium, and repo-hygiene packages are source-available under a proprietary licence. Each package declares its own `license` field. Third-party dependency notices are reproduced in [NOTICE](./NOTICE).

---

## Company

Batiste is built by Cachola Tech in Eindhoven, Netherlands.
jardhel@cachola.tech · [cachola.tech](https://cachola.tech)
