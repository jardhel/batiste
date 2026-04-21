# Batiste Architecture

Technical reference for the Batiste Autonomous Agent Compute Marketplace.

---

## Package Dependency Graph

```
@batiste-aidk/cli
  ├── @batiste-aidk/aidk
  │     ├── @batiste-aidk/core
  │     ├── @batiste-aidk/transport
  │     ├── @batiste-aidk/auth
  │     ├── @batiste-aidk/scope
  │     └── @batiste-aidk/audit
  ├── @batiste-aidk/marketplace
  └── @batiste-aidk/transport

@batiste-aidk/marketplace     (no workspace deps)
@batiste-aidk/connectors      (no workspace deps)
@batiste-aidk/transport
  └── @batiste-aidk/core
```

Packages at the bottom of the graph (`@batiste-aidk/marketplace`, `@batiste-aidk/connectors`) are intentionally zero-dependency within the monorepo. They can be published and used standalone.

---

## Zero-Trust Middleware Chain

Every tool call through `createNode()` passes through three layers in strict order. Each layer wraps the one beneath it — if any layer rejects, execution stops and the result is logged.

```
Incoming tool call
       │
       ▼
┌──────────────┐
│    Scope     │  AccessPolicyEngine (glob via micromatch)
│              │  — Checks path patterns against policy
│              │  — Denies **/*.env, **/*.secret, **/.ssh/** by default
│              │  — Enforces maxDepth on directory traversal
│              │  — AST-level enforcement landing via @batiste-aidk/graph
└──────┬───────┘
       │ pass
       ▼
┌──────────────┐
│     Auth     │  TokenVerifier (JWT HS256; RS256 on roadmap)
│              │  — Verifies signature and expiry
│              │  — Checks tool scope claim
│              │  — Header: Authorization: Bearer <jwt>
└──────┬───────┘
       │ pass
       ▼
┌──────────────┐
│    Audit     │  AuditedToolHandler
│              │  — KillSwitch gate (atomic bool check)
│              │  — Executes handler, measures durationMs
│              │  — Appends to SQLite WAL ledger
└──────┬───────┘
       │
       ▼
  ToolHandler (user-provided)
```

### SQLite WAL Pattern

Every stateful package (`@batiste-aidk/audit`, `@batiste-aidk/marketplace`, `@batiste-aidk/auth`) opens its own SQLite database in WAL mode:

```typescript
this.db = new Database(dbPath);
this.db.pragma('journal_mode = WAL');
```

WAL mode enables concurrent reads while a write is in progress — critical for audit logging during high-throughput routing.

---

## Marketplace Routing Algorithm

`RoutingLayer.route()` selects the optimal node for a request using a composite score:

```
score = reliability × 0.50
      - normalisedLatency × 0.30
      - normalisedPrice × 0.15
      + tagBonus × 0.05
```

Where:
- `reliability` — rolling EMA of success rate, α = 0.1
- `normalisedLatency` — (latency − min) / (max − min) across candidates
- `normalisedPrice` — (price − min) / (max − min) across candidates
- `tagBonus` — 1 if node has any preferred tag, else 0

Latency and reliability are updated per-call:

```typescript
// Exponential Moving Average — latency (α=0.3, fast-converging)
next_lat = 0.3 × sample + 0.7 × prev

// Exponential Moving Average — reliability (α=0.1, slow decay)
next_rel = 0.1 × (success ? 1 : 0) + 0.9 × prev
```

Nodes not seen within 60 seconds are automatically marked `offline` via `pruneStale()`.

---

## Performance Tracker

`PerformanceTracker` maintains an in-memory ring of `LatencySample` objects over a rolling window (default: 1 hour). Percentiles are computed on-demand using linear interpolation:

```typescript
percentile(p: number): number | null {
  const data = snapshot().map(s => s.latencyMs).sort((a, b) => a - b);
  const rank = (p / 100) * (data.length - 1);
  const lower = Math.floor(rank);
  return data[lower] * (1 - frac) + data[upper] * frac;
}
```

The gateway exposes `GET /metrics` returning a live JSON snapshot. The `GatewayHandle.metrics` property provides in-process access for marketplace-to-transport wiring.

---

## MCP Protocol Integration

Batiste nodes implement the [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) over StreamableHTTP transport. The protocol supports:

- **Tools** — callable functions with typed input/output schemas
- **Prompts** — reusable prompt templates (static + dynamic registration)
- **Sessions** — stateful connections with per-session token scoping

Each gateway session creates a fresh `Server` instance (factory pattern) to prevent cross-session state leakage:

```typescript
// One Server per session — zero shared state
const createServer = () => createMcpServer({ name, tools, handler });
startGateway(createServer, config);
```

---

## Marketplace HTTP API

The `MarketplaceGateway` exposes a REST API (native Node.js `http`, no framework):

| Method | Path | Description |
|---|---|---|
| `POST` | `/nodes/register` | Register a new node |
| `GET` | `/nodes` | List nodes (`?capability=` `?status=`) |
| `DELETE` | `/nodes/:id` | Unregister a node |
| `POST` | `/nodes/:id/heartbeat` | Keep-alive ping |
| `POST` | `/route` | Get best node for a capability |
| `POST` | `/billing/record` | Record compute cycles |
| `GET` | `/billing/:sessionId` | Billing report for a session |
| `GET` | `/health` | Health check |

---

## Connector Architecture

`@batiste-aidk/connectors` exposes three MCP tools:

| Tool | Implementation | Notes |
|---|---|---|
| `parse_pdf` | `pdf-parse` (CJS) via `createRequire` shim | Extracts text, page count, metadata |
| `query_csv` | RFC 4180 parser (zero deps) | Filtering, projection, limit, type inference |
| `csv_stats` | Same parser | min/max/mean/sum/nullCount per column |

The CJS interop pattern used for `pdf-parse`:

```typescript
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
```

---

## Testing Strategy

| Layer | Strategy |
|---|---|
| Unit | Pure functions — output utilities, routing algorithm, percentile math |
| Integration | In-process SQLite `:memory:` — registry, audit ledger, billing |
| HTTP integration | `port: 0` (OS-assigned) — full gateway and marketplace API |
| End-to-end | `examples/investor-demo/run.ts` — all layers live |

All tests use Vitest with `testTimeout: 15_000`. No mocks for storage — real SQLite `:memory:` throughout.

---

## Monorepo Structure

```
batiste/
├── packages/
│   ├── aidk/           Node factory (createNode)
│   ├── audit/          Audit ledger + kill switch
│   ├── auth/           JWT token issuer + verifier
│   ├── cli/            batiste CLI binary
│   ├── code/           Code analysis MCP server
│   ├── connectors/     PDF + CSV MCP connectors
│   ├── core/           Shared MCP primitives + orchestration
│   ├── marketplace/    Node registry, routing, billing
│   ├── scope/          Path-based access policy (glob deny-lists)
│   ├── web/            Dashboard UI (HTML/CSS/JS, no framework)
│   ├── transport/      Secure HTTP gateway + metrics
│   └── web/            Dashboard UI (HTML/CSS/JS)
├── examples/
│   ├── investor-demo/  End-to-end showcase
│   ├── local-node/     Local stdio node
│   └── remote-agent/   Remote gateway agent
└── ARCHITECTURE.md
```
