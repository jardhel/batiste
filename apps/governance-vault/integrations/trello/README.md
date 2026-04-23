# Trello connector

> v0.1 · metadata-only · gestora-account-bound · webhook-first

## What it does

For every event on the agency's Trello board(s) — card create / move / archive / label change / due-date change / member assigned — emits one line in the agency's ledger and (conditionally) one note in `05 Memory/` or `06 Audit/`.

## Setup (15 min, gestora)

### 1 · Get Trello API credentials

- API key: https://trello.com/app-key (under gestora's Trello login)
- Token (read-only is enough): the same page → "Generate a Token" link → grant
- Save both somewhere safe **temporarily** (you'll paste them in step 3, then erase the temporary copy)

### 2 · Identify the boards to subscribe

- For each agency board you want to audit, get the **board ID**:
  - Open the board in Trello → URL ends in `/b/<short-id>/<slug>`
  - The full ID is via API: `https://trello.com/1/boards/<short-id>?key=<KEY>&token=<TOKEN>`
  - Look for the `id` field in the JSON response

### 3 · Store credentials in Apps Script Properties

- Open the Apps Script project (`Governance Vault — Bonita G`)
- File → Project Settings → "Script Properties" → Add property:
  - `TRELLO_API_KEY` = `<key from step 1>`
  - `TRELLO_TOKEN` = `<token from step 1>`
  - `TRELLO_BOARD_IDS` = `<board ID 1>,<board ID 2>,...` (comma-separated)
- **Erase the temporary copy** of the credentials

### 4 · Enable the integration in `00_config.gs`

```javascript
TRELLO_INTEGRATION_ENABLED: true,
```

### 5 · Deploy the Apps Script as a Web App

- Apps Script editor → Deploy → New deployment → "Web app"
- Description: `Governance Vault — Trello webhook`
- Execute as: `Me (gestora email)`
- Who has access: `Anyone` (Trello servers need to reach it; payload validation in script)
- Deploy → copy the resulting URL

### 6 · Register the webhook(s) for each board

- In a terminal:
  ```
  curl -X POST "https://api.trello.com/1/webhooks/" \
    -d "key=<KEY>" \
    -d "token=<TOKEN>" \
    -d "callbackURL=<WEB_APP_URL_FROM_STEP_5>" \
    -d "idModel=<BOARD_ID>"
  ```
- Repeat for each board in `TRELLO_BOARD_IDS`.

### 7 · Test

- In Trello, move a card. Wait 5 seconds.
- In Apps Script editor → Executions tab → confirm `doPost` was called and returned 200.
- In Drive: open `_Governanca_Obsidian/.audit/document-audit.jsonl` → should have a new line.

## How to tag a card as PII

In Trello, add the label `gvs-pii` (case-sensitive) to the card. From that point, every event on that card causes the connector to:

1. Skip ledgering metadata that could leak (card title is hashed instead of recorded plain)
2. Create or update an encrypted note in `05 Memory/<board>/<card-slug>.md`
3. Mark the audit ledger entry with `pii_routed: true`

## Card template that auto-generates a vault note

Save the file at `card_template.md` (next to this README) as a Trello card description template. When the gestora creates a new client card, she pastes this template — the structure ensures the connector knows where to route.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `doPost` not called when card moved | Webhook not registered, or Web App URL wrong | Re-do step 6, double-check URL |
| `doPost` called but no ledger line | `TRELLO_INTEGRATION_ENABLED` is false | Toggle in `00_config.gs`, save |
| Ledger lines duplicated | Same card subscribed to multiple webhook IDs | List webhooks (`GET https://api.trello.com/1/tokens/<TOKEN>/webhooks?key=<KEY>`), delete duplicates |
| 401 from Trello | Token revoked or expired | Regenerate token at trello.com/app-key |

## Removing the integration

- Trello side: `curl -X DELETE` the webhook for each board (use `GET .../tokens/.../webhooks` to list)
- Apps Script side: set `TRELLO_INTEGRATION_ENABLED: false`, redeploy
- Script properties: delete `TRELLO_API_KEY`, `TRELLO_TOKEN`, `TRELLO_BOARD_IDS`
