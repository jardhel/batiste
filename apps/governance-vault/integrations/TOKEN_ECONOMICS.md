---
title: Token economics — Trello & Asana integrations
status: v0.1 · 2026-04-23
---

# Token economics — Trello & Asana integrations

> **Question this answers:** when the agency adds the integration, how much does the audit pipeline actually cost in IA tokens, and what does the agency save in human-time tokens?

This is the doc the gestora shows to her CFO ("we're adding governance, not adding cost") and the doc the Cachola Tech advisor shows when the prospect asks "what's the unit economics?".

---

## 1 · Architectural fact: zero LLM tokens per event

The Trello and Asana connectors **do not call any LLM**. They are pure metadata transformers — JSON in, JSONL out. The only IA token cost is incurred (a) when the gestora asks an LLM to summarize the ledger, or (b) when the gestora asks an LLM to draft a compliance answer based on the ledger. Both are deliberate, on-demand operations.

The integrations themselves: **0 LLM tokens per event.**

The infrastructure cost on the agency side: **Apps Script execution time** — bounded by Workspace quotas (90 minutes/day for free; 6 hours/day for Workspace Standard, far above what this overlay consumes).

| Resource | Per event | Per month (50-analyst agency) |
|---|---|---|
| LLM tokens (integration) | 0 | 0 |
| Apps Script execution time | ~150 ms | ~75 minutes (out of 6h quota) |
| Drive API calls | 2-3 | ~80,000 (out of 1,000,000,000/day quota) |
| Storage (ledger growth) | ~250 bytes | ~1.5 MB |

---

## 2 · Where IA tokens DO get spent (and how the design minimizes them)

The advisory product (selling AI-Governance to the agency's clients) involves IA on three deliberate surfaces:

### 2.1 · "Summarize my ledger" prompts

When the gestora (or a client compliance officer) asks "what happened on campaign Y last quarter?", the workflow is:

1. `grep <campaign-slug> .audit/document-audit.jsonl` returns ~50-200 lines
2. Pipe to LLM with prompt: "summarize lifecycle of this campaign in 5 bullets"

Cost per query (Claude Sonnet 4.6 list price as of 2026-04):

- Input: 200 lines × ~80 tokens = 16,000 tokens × $3/MTok input = $0.048
- Output: ~250 tokens × $15/MTok output = $0.004
- **Total per query: ~$0.05**

At 100 queries/month for a 50-analyst agency: **~$5/month**.

### 2.2 · "Draft a client compliance answer" prompts

When client X's compliance asks "demonstrate that you have controls for X", the gestora pulls relevant policy notes + audit examples and asks the LLM to draft a response.

Cost: ~$0.20 per draft × ~10 drafts/month = **~$2/month**.

### 2.3 · Prompt caching savings (architectural)

Both flows above are **prompt-cache-friendly**:

- The system prompt + the `02 Policy/` context is reused across queries
- With Anthropic prompt caching (5-min TTL on cached tokens) the input cost drops by ~90% on cache hit
- Effective input cost on a hot session: **$3/MTok → $0.30/MTok** (cached)

For a busy gestora running 5 queries in 10 minutes: first query at full price, four subsequent at cached price. Net cost on the busy hour: ~$0.10 instead of ~$0.25.

The integration architecture **assumes** prompt caching is available and structures the context window to maximize cache reuse:

```
[CACHED]
  - System prompt (3 KB)
  - 02 Policy/ax-usage policy (8 KB)
  - 02 Policy/pii-handling policy (4 KB)
  - 06 Audit ledger relevant slice (varies)
[FRESH per query]
  - User question (~100 tokens)
```

---

## 3 · Where the integration SAVES (the actual ROI)

The integration replaces **two human-hour categories** at the agency:

### 3.1 · Manual audit-trail compilation for client compliance

**Before:** when client compliance asks for a campaign lifecycle, an analyst spends 2-4 hours pulling Trello cards, exporting Asana history, scrolling Drive activity, and writing a narrative.

**After:** `grep` + 1 LLM query in <5 minutes. **Savings: 1.95-3.95 hours per request.**

A boutique agency averages 4-8 such requests per quarter from corporate clients. Annual time saved: **20-60 hours**.

### 3.2 · PII triage at e-mail / brief intake

**Before:** when a brief arrives with PII (CPF, account numbers, salaries), an account lead manually decides "this goes here, that gets redacted, this needs a separate folder" — 15-30 min per intake.

**After:** mark the Trello card / Asana task with `gvs-pii`, the connector auto-routes to encrypted memory note. **Savings: 12-25 min per intake.**

At ~30 PII briefs/year for a boutique agency: **6-12 hours saved**.

### 3.3 · Quarterly permissions audit

**Before:** the gestora manually reviews who has access to what across Drive, Trello, Asana, Slack — 3-6 hours per quarter.

**After:** `runPermissionsAudit()` produces the audit in 90 seconds; the gestora only reviews exceptions. **Savings: 2.5-5.5 hours per quarter = 10-22 hours/year.**

---

## 4 · Net unit economics — first year

**Costs (Cachola Tech-side LLM token spend):**

| Item | Monthly | Annual |
|---|---|---|
| Ledger summarization queries | ~$5 | ~$60 |
| Compliance draft queries | ~$2 | ~$24 |
| Quarterly audit summarization | ~$1 | ~$12 |
| **Total** | **~$8** | **~$96** |

**Savings (agency-side time, 50-analyst agency, $80/h blended):**

| Item | Hours/year saved | $/year |
|---|---|---|
| Manual audit-trail compilation | 40 | $3,200 |
| PII triage at intake | 9 | $720 |
| Quarterly permissions audit | 16 | $1,280 |
| Reduced incident risk (probabilistic) | 8-32 | $640-$2,560 |
| **Total** | **73-97** | **$5,840-$7,760** |

**ROI year 1:** $5,840 − $96 = **$5,744 net** (lowest-bound), or $7,664 (upper-bound).

**Break-even time: ~2 days** of a single analyst's billable time saved.

---

## 5 · What this does NOT include

- The advisory revenue Bonita G earns by **selling** AI-Governance Advisory to its corporate clients. That's the upside multiple. A single 8-figure corporate client paying for a quarterly governance audit at $30k-$80k/quarter dwarfs the integration cost by 4-5 orders of magnitude.
- The defensive value: avoiding ONE compliance incident with a regulated client (estimated cost of a single LGPD/CONAR incident in BR: $50k-$500k legal + reputational). The integration produces the audit trail that **prevents** the incident from being a black box.
- The talent retention value: senior analysts/account leads stop spending 4 hours/week on manual audit chores. Their time goes back to creative work.

---

## 6 · Caveats — honest limits

- These numbers assume the gestora actually runs the daily SOP. Without the SOP, the audit decays in days; the savings disappear. **The integration multiplies disciplined operation; it does not substitute for it.**
- LLM prices may change. As of 2026-04 (Anthropic Claude Sonnet 4.6 list price, OpenAI GPT-5 list price), the projection above holds. If LLM prices halve in 12 months (likely), the cost drops further. If they double, the cost is still <$200/year — still negligible vs savings.
- The "incident avoidance" figure is probabilistic. We do not promise zero incidents. We promise that **incidents are detectable and explainable**, which converts an existential incident into a manageable incident.
