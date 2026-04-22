<div align="center">

<img src="./assets/logo.png" width="120" alt="Batiste" />

# BATISTE

### The Autonomous Agent Compute Marketplace

[![License](https://img.shields.io/badge/license-UNLICENSED-green.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D9.0.0-orange)](https://pnpm.io)
[![Build](https://img.shields.io/badge/build-passing-brightgreen)](#)
[![Tests](https://img.shields.io/badge/tests-446%20passing-brightgreen)](#)
[![Release](https://img.shields.io/badge/release-v1.2.0--alpha.1-brightgreen)](https://github.com/jardhel/batiste/releases/tag/v1.2.0-alpha.1)
[![GVS](https://img.shields.io/badge/GVS-0.1--draft-blue)](./specs/gvs-0.1.md)
[![AI Vendor Shield](https://img.shields.io/badge/v2%20thesis-AI%20Vendor%20Shield-blueviolet)](./CHANGELOG.md#120-alpha1--2026-04-22)
[![Audit-Ready](https://img.shields.io/badge/audit--ready-yes-2E7D32)](./compliance/README.md)
[![Runs in Cowork](https://img.shields.io/badge/runs%20in-Cowork-000)](./docs/COWORK.md)
[![GDPR](https://img.shields.io/badge/GDPR-ready-2E7D32)](./compliance/policies/data-protection-policy.md)
[![EU AI Act](https://img.shields.io/badge/EU%20AI%20Act-ready-2E7D32)](./compliance/frameworks/eu-ai-act-annex-iv.md)
[![NIS2](https://img.shields.io/badge/NIS2-Art.21%20mapped-2E7D32)](./compliance/frameworks/nis2-art21-measures.md)
[![DORA](https://img.shields.io/badge/DORA-mapped-2E7D32)](./compliance/frameworks/dora-ict-risk.md)
[![SOC 2](https://img.shields.io/badge/SOC%202-TSC%20mapped-2E7D32)](./compliance/frameworks/soc2-tsc-mapping.md)
[![ISO 27001](https://img.shields.io/badge/ISO%2027001-Annex%20A-2E7D32)](./compliance/frameworks/iso27001-annex-a.md)

**Zero-trust infrastructure for AI agents. Route, bill, audit, and kill-switch every agent call — on your own network, with zero cloud dependencies.**

[Quick Start](#quick-start) · [Architecture](#architecture) · [CLI](#cli) · [Packages](#packages) · [Our Story](./HISTORY.md) · [Contributing](./CONTRIBUTING.md)

---

![Batiste Dashboard](./packages/web/screenshots/02-metrics.png)

</div>

---

## Why Batiste

Enterprise AI projects die in pilot for the same four reasons every time: no audit trail, no access control, no cost visibility, and no way to shut everything down instantly. Batiste is the **developer-experience layer** that removes all four blockers — a production-grade **cli-tool** and compute marketplace that gives your AI agents the same governance guarantees you'd expect from any other enterprise system.

Every tool call is path-scoped, verified by JWT, billed per compute cycle, and written to an append-only ledger. The kill switch revokes everything in under 1ms. Nothing leaves your network.

Think of it as the **automation** backbone for agentic workflows — the invisible sous-chef that orchestrates, audits, and routes without ever cluttering the workspace.

---

## Quick Start

**Prerequisites:** Node.js ≥ 20, pnpm ≥ 9

**Step 1 — Clone and install**

```bash
git clone https://github.com/jardhel/batiste.git
cd batiste
pnpm install
```

**Step 2 — Build all packages**

```bash
pnpm build
```

**Step 3 — Run the live demo**

```bash
npx tsx examples/investor-demo/run.ts
```

That's it. A marketplace starts, three AI nodes register, ten routed calls execute, a billing report generates, and the kill switch fires — all in-process, no cloud account needed.

---

## Demo

> ![Batiste Hero](./packages/web/screenshots/01-hero.png)
> *The Batiste dashboard — dark terminal aesthetic, live metrics, marketplace node grid.*

> ![Batiste Audit Feed](./packages/web/screenshots/04-audit.png)
> *Agent Activity feed with real-time audit trail and Emergency Kill Switch.*

---

## Architecture

Batiste is a **monorepo** of composable packages. Every agent call passes through a strict three-layer zero-trust chain before reaching the handler:

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
| **Scope** | Glob-based path enforcement — deny-listed patterns never reach the handler · AST-level enforcement landing via `@batiste-aidk/graph` |
| **Auth** | JWT verification — expired or tampered tokens rejected before execution |
| **Audit** | Append-only SQLite WAL write — every call, result, and timing recorded permanently |

---

## Packages

| Package | Description |
|---|---|
| [`@batiste-aidk/marketplace`](./packages/marketplace) | Node registry · capability routing · per-cycle billing |
| [`@batiste-aidk/transport`](./packages/transport) | Secure StreamableHTTP gateway · session management · `PerformanceTracker` |
| [`@batiste-aidk/connectors`](./packages/connectors) | **Proprietary connectors** — PDF extraction + RFC 4180 CSV/ETL as MCP tools |
| [`@batiste-aidk/code`](./packages/code) | 13 MCP tools: AST analysis · TDD · AutoFix · LSP · codebase summarisation · context budgeting · **GVS vault validate / index** |
| [`@batiste-aidk/gvs`](./packages/gvs) | **[GVS 0.1](./specs/gvs-0.1.md) reference implementation** — loader and validator for Governance Vault Specification |
| [`@batiste-aidk/memory`](./packages/memory) | **Firm Memory (F5, v2 scaffold)** — private prompt + fact store; the firm's IP lives here, never in a public repo |
| [`@batiste-aidk/audit`](./packages/audit) | Append-only audit ledger · KillSwitch · SessionMonitor |
| [`@batiste-aidk/auth`](./packages/auth) | JWT token issuance and verification |
| [`@batiste-aidk/scope`](./packages/scope) | Path-based access policy enforcement (glob deny-lists, depth caps) |
| [`@batiste-aidk/web`](./packages/web) | Dashboard UI — live metrics, audit feed, kill switch (HTML/CSS/JS, no framework) |
| [`@batiste-aidk/aidk`](./packages/aidk) | `createNode()` factory — composes all zero-trust layers |
| [`@batiste-aidk/cli`](./packages/cli) | `batiste` binary — full **cli-tool** for node and marketplace management |
| [`@batiste-aidk/core`](./packages/core) | Shared MCP primitives · agent orchestration · prompt registry |

---

## CLI

The `batiste` **cli-tool** covers the full **developer-experience** lifecycle:

```bash
# Start a node (local / network / enterprise preset)
batiste node start --preset network --port 4001 --label "Code Analyzer"

# Publish it to the marketplace
batiste node publish \
  --name "Code Analyzer" \
  --endpoint http://localhost:4001 \
  --capabilities ast_analysis,tdd,autofix \
  --price 0.001

# Route to the best available node for a capability
batiste connect --capability ast_analysis

# Live gateway health + p50/p95/p99 latency metrics
batiste status --watch

# Follow the audit ledger in real time
batiste audit tail --follow

# Validate a GVS 0.1 governance vault (spec: ./specs/gvs-0.1.md)
batiste vault validate ./obs_vault/my-firm
batiste vault index ./obs_vault/my-firm --axis decision
```

---

## Key Features

- **Zero-trust by default** — Scope, Auth, and Audit are the call path, not optional middleware
- **On-premise** — zero cloud dependencies; runs fully air-gapped
- **Proprietary connectors** — PDF extraction and CSV/ETL as native MCP tools; data never leaves your network
- **Path-scoped enforcement** — glob deny-lists evaluated before the handler; no bypass · AST-level scope landing via `@batiste-aidk/graph`
- **Kill switch** — revoke all agent access across all nodes in < 1ms
- **Per-cycle billing** — every compute cycle tracked and reportable per session
- **Live metrics** — rolling 1h p50/p95/p99 latency histogram exposed at `GET /metrics`
- **446 tests** — Vitest, real SQLite `:memory:`, no mocks

---

## Moats

**Zero-Trust Architecture** — security is structural, not configurable. An agent that bypasses the middleware chain cannot exist in the protocol.

**Proprietary Connectors** — PDF and CSV/ETL run inside your network. The data never touches a third-party API.

**Path-Scoped Access** — policies evaluated before any handler runs. Glob deny-lists, depth caps, symbol-type filters. AST-level enforcement landing via `@batiste-aidk/graph`.

**Verified Creator Pool** — node reliability scored via rolling EMA. Underperforming nodes are deprioritised automatically.

---

## Technology

- **Runtime** — Node.js 20+ · TypeScript 5 · ESM (NodeNext)
- **Monorepo** — pnpm workspaces · Turborepo
- **Protocol** — Model Context Protocol (MCP) · StreamableHTTP transport
- **Storage** — SQLite WAL mode (audit, billing, registry, tasks)
- **Testing** — Vitest · 446 tests · no mocks

---

## Roadmap

| Quarter | Milestone |
|---|---|
| Q1 2026 *(now)* | Seed + Alpha — marketplace core, CLI, public beta |
| Q2 2026 | Public Mainnet V1 — open node registry, creator dashboard |
| Q3 2026 | Enterprise Auth — SSO, SAML, multi-tenant scoping |
| Q4 2026 | Global Scale — geo-routing, SLA tiers, compliance exports |

---

## Compliance & Audit-Ready

Batiste is designed for regulated environments from day one. The air-gapped on-prem posture means data never leaves the customer's network, and every agent action is captured in a tamper-evident ledger ready for auditor inspection.

The [`compliance/`](./compliance) folder is the data room: master index, technical control mapping, policies, runbooks, and framework-specific documents (GDPR, EU AI Act, NIS2, DORA, SOC 2, ISO 27001). The single document an auditor will ask for first is [`compliance/mappings/batiste-to-controls.md`](./compliance/mappings/batiste-to-controls.md) — every Batiste feature matched to every control ID it satisfies. Start with [`compliance/README.md`](./compliance/README.md) for the guided tour.

---

## Dogfooding — Batiste dentro do Cowork

O servidor MCP do `@batiste-aidk/code` é carregado como conector do Claude Desktop em **Cowork mode**: toda chamada agentica do nosso próprio dev loop (AST, TDD, AutoFix, codebase summarise) passa pelo caminho zero-trust Scope → Auth → Audit do próprio Batiste. Instale em um comando com `bash scripts/install-cowork.sh` — detalhes em [`docs/COWORK.md`](./docs/COWORK.md).

---

## Our Story

Batiste grew out of **[seu-claude](https://github.com/jardhel/seu-claude)** — a local RAG MCP server that gave Claude Code semantic awareness of codebases. The insight that a single specialised node could make an AI assistant dramatically more capable led directly to the question: *what happens when you have a network of them?*

The full origin story — the problem, the naming, the vision — is in **[HISTORY.md](./HISTORY.md)**.

---

## Contributing

We welcome contributions of all kinds. See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines on how to get started, open issues, and submit pull requests.

---

## Company

**Batiste** — Eindhoven, Netherlands
jardhel@cachola.tech · [batiste.network](https://batiste.network)

> *"The best infrastructure is the kind you forget is there — until you need it."*
