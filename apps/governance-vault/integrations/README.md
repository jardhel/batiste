# Integrations — Trello & Asana

Two connectors at v0.1: **Trello** and **Asana**. Both are **opt-in** (set the `*_INTEGRATION_ENABLED` flag in `00_config.gs`). Both are **metadata-only by default** — they ledger event metadata (board id, card id, action, actor, timestamp), not payload bodies. PII routing requires explicit `gvs-pii` label on the source card/task.

## What problem does the integration solve

Agencies live operationally in Trello or Asana, but those tools have **no audit trail of state changes that compliance can read**. Adding the connector means:

- Every card move, every status change, every assignment is recorded in the agency's ledger.
- When the client compliance asks "show me the lifecycle of campaign Y", the answer is `grep <campaign-slug> .audit/document-audit.jsonl` — sequence reconstructed.
- When a card is tagged PII, an encrypted note appears in `05 Memory/` automatically — the gestora doesn't have to remember to copy.

## Two flavors per tool

Each tool has two integration patterns:

1. **Webhook → Apps Script (recommended for v0.1)** — Trello/Asana push events to a Web App URL exposed by the agency's Apps Script. Latency: seconds. Reliability: high. Zero infrastructure beyond Apps Script.
2. **Polling (fallback)** — for accounts without webhook permission, the agency's Apps Script polls every 15 minutes. Latency: 15 min. Reliability: medium.

Default in v0.1: **webhook** when available; falls back to polling automatically.

## Token economics

Heavy: `TOKEN_ECONOMICS.md` in this directory. TL;DR: per-event cost is **negligible** (microcents); the connector reads ~3 metadata fields per event, not the full payload. Annual budget for a 50-analyst agency: <USD 5/month at current Anthropic / OpenAI prices.

## Order to install

1. Read `trello/README.md` or `asana/README.md` (whichever applies).
2. Generate a Trello API key + token, or an Asana Personal Access Token, in **the gestora's** account (never an analyst's).
3. Store both in `PropertiesService.getScriptProperties()` (never in `00_config.gs`).
4. Set the flag in `00_config.gs` to `true`.
5. Re-run `setupOverlay()` — the script registers the webhook automatically.
6. Test with a deliberate event (move a card, complete a task) — should show up in the ledger within seconds.

## What the connector NEVER does

- Reads card/task body content. Only metadata.
- Posts back to Trello/Asana. One-way.
- Disposes of the source data. Trello/Asana keep their authoritative state; the ledger is a side-record for audit.
- Bridges to non-agency Trello/Asana workspaces.

## Roadmap (v0.2)

- Push annotations BACK to Trello/Asana — when a deliverable is stamped, post the manifest URL as a comment on the originating card. Closes the loop between operational tool and audit trail.
- Slack connector (channels, threads).
- Notion connector (database rows for clients with Notion-as-PM stack).
- Linear connector (engineering-style PM, less common in agencies).
