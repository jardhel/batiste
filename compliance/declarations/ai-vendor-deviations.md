# AI Vendor Policy — Deviation log

**Owner:** CEO + Security Lead · **Last reviewed:** 2026-04-21
**Governing policy:** `compliance/policies/ai-vendor-policy.md`

> Every deviation from `ai-vendor-policy.md §3` is recorded here with date, reason, scope, compensating control, and expiry. An open deviation older than 90 days triggers a CEO review.

## Current deviations

| # | Date opened | Deviation | Scope | Reason | Compensating control | Expiry |
|---|---|---|---|---|---|---|
| D1 | 2026-04-21 | Anthropic DPA not yet executed | Claude API usage in firm workflows | DPA template under legal review (Dr. César) | Personal data in prompts kept to minimum (counterparty names + public addresses); no special-category data | 2026-05-21 |
| D2 | 2026-04-21 | No secondary AI-vendor account yet | All firm workflows | Policy §3.4 gives 30 days; selection in progress (OpenAI vs Google Vertex vs AWS Bedrock) | Export of `batiste-prompts/` library mirrored locally (portable if primary fails); critical workflows have paper-based fallback | 2026-05-21 |

## Resolved deviations

_(none yet)_

## Review

On each quarterly compliance review, the CEO:

1. Verifies all open deviations have expiry dates within policy (≤ 90 days).
2. Closes resolved deviations with a one-paragraph outcome note.
3. Escalates any overdue deviation to a formal incident.
