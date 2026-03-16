# @batiste/marketplace

The core of the Batiste compute marketplace. Registers nodes, routes requests to the best candidate, and tracks per-cycle billing — all backed by SQLite WAL with zero cloud dependencies.

## Concepts

| Class | Role |
|---|---|
| `NodeRegistry` | Persistent node catalog. Register, unregister, heartbeat, EMA latency/reliability tracking. |
| `NodeDiscovery` | Capability/tag/price-filtered search. Sorted: online first → reliability ↓ → latency ↑. |
| `RoutingLayer` | Composite scoring: reliability 50% · latency 30% · price 15% · tag bonus 5%. |
| `PricingMeter` | Per-cycle billing ledger. Session-level reports with totals. |
| `MarketplaceGateway` | Native Node.js HTTP REST API. No framework. |

## Quick Start

```typescript
import { startMarketplace } from '@batiste/marketplace';

const marketplace = await startMarketplace({ port: 3100 });

// Register a node
const res = await fetch('http://localhost:3100/nodes/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Code Analyzer',
    capabilities: ['ast_analysis', 'tdd'],
    endpoint: 'http://localhost:4001',
    pricePerCycle: 0.001,
    creatorId: 'my-team',
    tags: ['code'],
  }),
});

// Route to the best node
const route = await fetch('http://localhost:3100/route', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ capability: 'ast_analysis' }),
});
const { node, score } = await route.json();

// Record billing
await fetch('http://localhost:3100/billing/record', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sessionId: 'sess-1', nodeId: node.id, cyclesUsed: 3 }),
});

// Get billing report
const report = await fetch(`http://localhost:3100/billing/sess-1`).then(r => r.json());
console.log(report.totalCost); // 0.003

await marketplace.close();
```

## Routing Algorithm

Score = reliability × 0.50 − normLatency × 0.30 − normPrice × 0.15 + tagBonus × 0.05

Latency and reliability are updated per-call using an Exponential Moving Average (α=0.3 for latency, α=0.1 for reliability). Nodes silent for 60s are automatically marked offline.

## API

| `POST /nodes/register` | Register a node |
| `GET /nodes` | List nodes (`?capability=` `?status=`) |
| `DELETE /nodes/:id` | Unregister |
| `POST /nodes/:id/heartbeat` | Keep-alive |
| `POST /route` | Get best node for a capability |
| `POST /billing/record` | Record compute cycles |
| `GET /billing/:sessionId` | Billing report |
| `GET /health` | Health check |

## In-process Usage

```typescript
import { NodeRegistry, NodeDiscovery, RoutingLayer } from '@batiste/marketplace';

const registry = new NodeRegistry(':memory:');
const discovery = new NodeDiscovery(registry);
const router = new RoutingLayer(discovery);

const node = registry.register({ name: 'test', capabilities: ['echo'], ... });
const result = router.route({ capability: 'echo' });
```
