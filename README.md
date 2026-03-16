# Batiste

**The Autonomous Agent Compute Marketplace.**

Batiste is zero-trust infrastructure for AI agents: a marketplace where nodes offer specialised capabilities, clients route to the best node, and every call is billed per cycle, scoped per token, and written to an append-only audit ledger — all without any cloud dependency.

Named after the legendary sous-chef who anticipates what the kitchen needs before anyone asks. Batiste never clutters the workspace. It is already three steps ahead.

```
npx tsx examples/investor-demo/run.ts
```

```
  BATISTE  ·  Autonomous Agent Compute Marketplace

  Phase 1  Marketplace Boot Sequence
  › Initialising Batiste Protocol…           ✓
  › Starting Marketplace Gateway…            ✓  http://localhost:59300
  › Opening Audit Ledger…                    ✓  SQLite WAL mode active

  Phase 3  Zero-Trust Routing  (10 calls)
  [ 1/10]  ast_analysis    Analyse src/auth/middleware.ts       38ms  ✓  → Code Analyzer
  [ 2/10]  pdf_parse       Extract clauses from NDA.pdf         32ms  ✓  → Doc Intelligence
  ...

  Phase 7  Emergency Kill Switch
  ✓  All 3 nodes offline in 0ms
  ✓  Verification: 0 nodes online (expected: 0)

  Demo Complete  —  Batiste is production-ready
  10/10        routed API calls succeeded
  $0.031       billed across 22 compute cycles
  <1ms         kill switch revocation latency
  0            external services required
```

---

## Why Batiste

Every serious AI deployment eventually needs the same five things:

| Problem | Batiste answer |
|---|---|
| Which node should handle this call? | Marketplace routing — scored by latency, reliability, price |
| How do I bill per-use? | PricingMeter — per-cycle ledger with session reports |
| Who called what, and when? | AuditLedger — append-only SQLite WAL, tamper-evident |
| How do I revoke access instantly? | KillSwitch — single call, zero lingering sessions |
| How do I trust the code a node executes? | AST-level scope enforcement via TreeSitter |

None of these require a cloud account. Batiste runs entirely on-premise or in a private VPC.

---

## Packages

| Package | Purpose | Key exports |
|---|---|---|
| [`@batiste/marketplace`](./packages/marketplace) | Node registry · routing · billing | `startMarketplace()`, `NodeRegistry`, `RoutingLayer`, `PricingMeter` |
| [`@batiste/transport`](./packages/transport) | Secure HTTP gateway · session management · metrics | `startGateway()`, `PerformanceTracker` |
| [`@batiste/connectors`](./packages/connectors) | PDF extraction · CSV/ETL | `PdfParser`, `CsvEtl`, MCP tools |
| [`@batiste/code`](./packages/code) | AST analysis · TDD · AutoFix · LSP | 10 MCP tools |
| [`@batiste/audit`](./packages/audit) | Append-only audit ledger · kill switch | `AuditLedger`, `KillSwitch`, `SessionMonitor` |
| [`@batiste/auth`](./packages/auth) | JWT token issuance and verification | `TokenIssuer`, `TokenVerifier` |
| [`@batiste/scope`](./packages/scope) | AST-level access policy enforcement | `AccessPolicyEngine`, `ScopedHandler` |
| [`@batiste/aidk`](./packages/aidk) | Node factory — composes all layers | `createNode()` |
| [`@batiste/cli`](./packages/cli) | `batiste` command-line interface | `batiste node start/publish/list`, `connect`, `status`, `audit tail` |
| [`@batiste/core`](./packages/core) | Shared MCP primitives · orchestration | `createMcpServer()`, `AgentOrchestrator` |

---

## Architecture

```
  ┌─────────────────────────────────────────────────────┐
  │                   Marketplace                        │
  │  NodeRegistry ──► NodeDiscovery ──► RoutingLayer     │
  │       │                                    │         │
  │  PricingMeter ◄── BillingRecord ◄──────────┘         │
  └────────────────────────┬────────────────────────────┘
                           │  POST /route
                 ┌─────────▼──────────┐
                 │   SecureGateway    │  StreamableHTTP
                 │  (PerformanceTracker)│  p50 / p95 / p99
                 └─────────┬──────────┘
                           │
              ┌────────────▼────────────┐
              │     createNode()        │  @batiste/aidk
              │  Scope → Auth → Audit   │  zero-trust chain
              └────────────┬────────────┘
                           │
          ┌────────────────┼─────────────────┐
          ▼                ▼                 ▼
   Code Analyzer    Doc Intelligence   Compliance Guard
   AST · TDD        PDF · CSV · ETL    Audit · SOC2
   AutoFix · LSP    Data lake          Kill switch
```

Every tool call passes through three middleware layers in order:

1. **Scope** — AST-level path enforcement. Deny-listed patterns never reach the handler.
2. **Auth** — JWT verification. Expired or tampered tokens are rejected before execution.
3. **Audit** — Append-only write to SQLite WAL. Every call, result, and timing recorded.

---

## Quickstart

```bash
# Prerequisites: Node 20+, pnpm 9+
pnpm install
pnpm build

# Run the full investor demo (no external services needed)
npx tsx examples/investor-demo/run.ts

# Start a node
batiste node start --preset network --port 4001 --label "My Node"

# Register it in the marketplace
batiste node publish \
  --name "My Node" \
  --endpoint http://localhost:4001 \
  --capabilities ast_analysis,tdd \
  --price 0.001

# Route to the best node for a capability
batiste connect --capability ast_analysis

# Watch live metrics
batiste status --watch
```

---

## CLI

```
batiste node start        Start a node (local / network / enterprise preset)
batiste node publish      Register a node in the marketplace
batiste node list         List marketplace nodes with latency table
batiste connect           Route to the best node for a capability
batiste status [--watch]  Show gateway health + p50/p95/p99 metrics
batiste audit tail [-f]   Tail the audit ledger (follow mode)
batiste config            View / update ~/.batiste/config.json
```

---

## Moats

**Zero-Trust Architecture** — Scope, Auth, and Audit are not optional add-ons. They are the call path. An agent that bypasses the middleware chain cannot exist.

**Proprietary Connectors** — PDF extraction and CSV/ETL are built-in MCP tools, not wrappers around third-party SaaS. The data never leaves the network.

**AST-Level Scope** — Access policies are enforced at the Abstract Syntax Tree level via TreeSitter. No regex. No path traversal bypass. Every access is bounded.

**Verified Creator Pool** — Nodes declare capabilities. The marketplace scores reliability using a rolling exponential moving average. Unreliable nodes are deprioritised automatically.

---

## Technology

- **Runtime**: Node.js 20+ · TypeScript 5 · ESM (NodeNext)
- **Monorepo**: pnpm workspaces · Turborepo
- **Protocol**: Model Context Protocol (MCP) — StreamableHTTP transport
- **Storage**: SQLite WAL mode throughout (audit, billing, registry, tasks)
- **Testing**: Vitest — 150+ tests across all packages
- **Zero cloud deps**: every package runs fully offline

---

## Roadmap

| Quarter | Milestone |
|---|---|
| Q1 2026 *(now)* | Seed + Alpha — marketplace core, CLI, investor demo |
| Q2 2026 | Public Mainnet V1 — open node registry, creator dashboard |
| Q3 2026 | Enterprise Auth — SSO, SAML, multi-tenant scoping |
| Q4 2026 | Global Scale — geo-routing, SLA tiers, compliance exports |

---

## Company

**Batiste** — Eindhoven, Netherlands
investors@batiste.network · [batiste.network](https://batiste.network)

> *"The best infrastructure is the kind you forget is there — until you need it."*
