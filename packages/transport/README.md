# @batiste-aidk/transport

Secure HTTP gateway for Batiste MCP servers. Native Node.js — zero HTTP framework dependencies.

Features: TLS, rate limiting, session management, IP allowlist, CORS, and a rolling latency histogram exposed at `GET /metrics`.

## Start a Gateway

```typescript
import { startGateway } from '@batiste-aidk/transport';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

const gateway = await startGateway(
  () => new Server({ name: 'my-node', version: '1.0' }, { capabilities: { tools: {} } }),
  {
    port: 4001,
    security: {
      tls: { enabled: false },
      rateLimit: { requestsPerMinute: 60, burstSize: 10 },
      ipAllowList: ['127.0.0.1'],
    },
    maxConcurrentSessions: 10,
  }
);

console.log(`Gateway on port ${gateway.port}`);

// Live metrics
const metrics = gateway.metrics.summary();
// { p50, p95, p99, mean, min, max, reliability, sampleCount, windowMs }

await gateway.close();
```

## Performance Tracker

Every MCP request is timed. `PerformanceTracker` maintains a 1-hour rolling window and computes percentiles on demand using linear interpolation.

```typescript
import { PerformanceTracker } from '@batiste-aidk/transport';

const tracker = new PerformanceTracker(3_600_000); // 1h window
tracker.record(42, true);   // 42ms, success
tracker.record(180, false); // 180ms, error

console.log(tracker.p50);        // median latency
console.log(tracker.p95);        // 95th percentile
console.log(tracker.reliability); // success ratio [0, 1]
console.log(tracker.summary());  // full PerformanceMetrics object
```

## Endpoints

| `POST /mcp` | New MCP session |
| `GET /mcp` | SSE stream (existing session) |
| `DELETE /mcp` | Close session |
| `GET /health` | `{ status, sessions, uptime }` |
| `GET /metrics` | Live performance snapshot |

## Security

- **Rate limiting** — token bucket per client IP
- **Session limits** — configurable max concurrent sessions
- **IP allowlist** — optional hard block for non-listed IPs
- **Body size limit** — reject oversized payloads before parsing
- **Per-session server** — each MCP session gets a fresh `Server` instance, no shared state
