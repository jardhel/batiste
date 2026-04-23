# Asana connector

> v0.1 · metadata-only · gestora-account-bound · webhook-first

Same shape as the Trello connector — only the API differs. If your agency uses both Trello and Asana, install both; the audit ledger merges naturally.

## Setup (15 min, gestora)

### 1 · Create an Asana Personal Access Token (PAT)

- Login as gestora at https://app.asana.com/0/my-apps
- "Create new token" → name it `Governance Vault`
- Copy the token (you only see it once)

### 2 · Get the workspace ID and project IDs

- API browser: https://developers.asana.com/explorer
- Auth with your token
- `GET /workspaces` → copy the GID of the agency workspace
- `GET /workspaces/<GID>/projects` → copy the GIDs of the projects to audit

### 3 · Store credentials in Apps Script Properties

- Apps Script editor → Project Settings → Script Properties:
  - `ASANA_PAT` = `<token from step 1>`
  - `ASANA_WORKSPACE_ID` = `<workspace GID>`
  - `ASANA_PROJECT_IDS` = `<project GID 1>,<project GID 2>,...` (comma-separated)
- **Erase** the temporary copy of the PAT

### 4 · Enable the integration in `00_config.gs`

```javascript
ASANA_INTEGRATION_ENABLED: true,
```

### 5 · Deploy as Web App (same as Trello, separate Web App URL is fine)

If you already deployed the Apps Script as a Web App for Trello, you can reuse the same URL — the `doPost` handler dispatches by payload signature.

### 6 · Register Asana webhook(s)

Asana webhooks require a handshake. The `doPost` handler in `webhook_apps_script.gs` already implements the handshake response.

```bash
curl -X POST "https://app.asana.com/api/1.0/webhooks" \
  -H "Authorization: Bearer <PAT>" \
  -d '{
    "data": {
      "resource": "<PROJECT_GID>",
      "target": "<WEB_APP_URL>"
    }
  }'
```

Repeat for each project in `ASANA_PROJECT_IDS`.

### 7 · Test

- In Asana, complete a task. Wait 5 seconds.
- Apps Script editor → Executions → confirm `doPost` was called.
- Drive: `_Governanca_Obsidian/.audit/document-audit.jsonl` should have a new line.

## How to tag a task as PII

In Asana, add the **custom field** `gvs-pii` with value `yes`. From that point, every event on that task routes to the encrypted-memory pattern (same as Trello — see Trello README §"How to tag").

If your Asana plan does not support custom fields, alternative: prefix the task title with `[PII]` — the connector matches by regex.

## Differences from Trello

| | Trello | Asana |
|---|---|---|
| Webhook handshake | None (just HTTP 200) | X-Hook-Secret echo required (handler does it) |
| Event payload size | Small (one action) | Larger (events array) |
| Free-tier webhook support | Yes | Yes (since 2021) |
| Native PII flag | Label | Custom field |
| Rate limits | Generous | 1500 req/min/PAT (more than enough) |

## Roadmap

- v0.2: backlink — when a deliverable is stamped in Drive, post the manifest URL as a comment on the originating Asana task.
- v0.2: support for Asana **subtasks** (today the connector audits parent tasks only).
- v0.3: support for Asana **portfolios** for multi-project clients.
