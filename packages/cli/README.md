# @batiste-aidk/cli

The `batiste` command-line interface. Manage nodes, the marketplace, audit logs, and gateway metrics from your terminal.

## Install

```bash
# In the monorepo (built from source)
pnpm build
node packages/cli/bin/batiste.js --help

# Or link globally
pnpm --filter @batiste-aidk/cli link --global
batiste --help
```

## Commands

### `batiste node start`

Start a Batiste node in the foreground.

```bash
batiste node start --preset network --port 4001 --label "Code Analyzer"
batiste node start --preset local                    # stdio mode
batiste node start --preset enterprise --port 4001   # with audit + kill switch
```

### `batiste node publish`

Register a running node in the marketplace.

```bash
batiste node publish \
  --name "Code Analyzer" \
  --endpoint http://localhost:4001 \
  --capabilities ast_analysis,tdd,autofix \
  --price 0.001 \
  --tags code,analysis
```

### `batiste node list`

List marketplace nodes with latency and reliability.

```bash
batiste node list
batiste node list --capability ast_analysis
batiste node list --status online
```

### `batiste connect`

Route to the best available node for a capability.

```bash
batiste connect --capability ast_analysis
batiste connect --capability pdf_parse --max-price 0.005 --tags premium
```

Prints the MCP endpoint URL ready to paste into your client config.

### `batiste status`

Show gateway health and live performance metrics.

```bash
batiste status
batiste status --gateway http://localhost:4001 --watch   # refresh every 5s
```

Output includes p50/p95/p99 latency, reliability, session count, and uptime.

### `batiste audit tail`

Tail the audit ledger.

```bash
batiste audit tail
batiste audit tail --limit 50
batiste audit tail --follow                     # poll for new entries
batiste audit tail --tool ast_analysis          # filter by tool
batiste audit tail --result denied              # filter by outcome
```

### `batiste config`

View and update `~/.batiste/config.json`.

```bash
batiste config
batiste config --marketplace http://prod.batiste.network
batiste config --gateway http://gw.example.com
batiste config --creator-id my-team
```

### `batiste who`

```bash
batiste who
#   BATISTE · Autonomous Agent Compute Marketplace
#   The invisible sous-chef that runs your AI stack.
#   Eindhoven, Netherlands
```

## Config file

`~/.batiste/config.json` — created on first `batiste config` run:

```json
{
  "marketplaceUrl": "http://localhost:3100",
  "gatewayUrl": "http://localhost:3000",
  "creatorId": "default",
  "defaultAuditDb": "~/.batiste/audit.db"
}
```
