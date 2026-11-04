# @batiste-aidk/router

Local-first, audit-stamped **model router** for Batiste inference tools.

Given a task (a `handleTool` that will call an LLM/VLM/diffusion model), the
router decides **which model/provider** runs it — local-VLM, local-text, or
frontier-hosted — from a **declarative policy** derived from the two feasibility
tables (`tools/asymmetric-model/{FEASIBILITY,MULTIMODAL_FEASIBILITY}.md`).

## The one thing this package is NOT

**It does not call a model.** The Batiste runtime has no LLM client — by design.
The router only **chooses** a model and returns a plain `RouteDecision`. The
**host** (e.g. Claude Code) executes the model and feeds the **measured** token
usage back through `@batiste-aidk/audit`'s middleware (`resolveUsage` seam), so
every choice is **stamped** `model × task` on the zero-trust ledger.

```
task ──route()──▶ RouteDecision ──host executes──▶ measured usage ──▶ audit ledger
 (pure, deterministic)            (out of scope here)       (api_usage gate)
```

`route()` is **pure and deterministic**: same task in → same decision out. No
I/O, no clock, no randomness. That is what makes the choice testable and the
stamp re-derivable.

## Usage

```ts
import { BatisteRouter } from '@batiste-aidk/router';

const router = new BatisteRouter();

// Private OCR / doc-read → local VLM, data never leaves the machine.
router.route({ modality: 'vision-read', privacy: 'private' });
//  → { placement: 'local', modelId: 'qwen2.5-vl-7b', via: 'policy', ruleId: 'vision-private-local', … }

// Hard open reasoning → frontier (the gap is real and honest).
router.route({ modality: 'text', width: 'open' });
//  → { placement: 'frontier', modelId: 'frontier-reasoning', … }

// Manual override (picker, Copilot/Cursor/`/model` style) — itself auditable.
router.route({
  modality: 'text',
  override: { placement: 'frontier', modelId: 'claude-opus-4-8', provider: 'anthropic', reason: 'human forced frontier' },
});
//  → { via: 'override', reason: 'human forced frontier', … }
```

Wiring the choice into the ledger (host side):

```ts
import { AuditedToolHandler } from '@batiste-aidk/audit';

const decision = router.route(task);
const audited = new AuditedToolHandler(handler, {
  ledger, sessionId, agentId,
  // The host ran `decision.modelId` and read the provider's measured usage:
  resolveUsage: ({ result }) =>
    result === 'success'
      ? { modelId: decision.modelId, provider: decision.provider,
          inputTokens, outputTokens, source: 'api_usage' }
      : undefined,
});
```

## Decision axes (spec §2)

| Axis | Values | Effect |
|---|---|---|
| `modality` | `text` / `vision-read` / `image-gen` | picks the table family |
| `width` | `narrow-with-oracle` / `narrow` / `open` | narrow stays local; open escalates |
| `privacy` | `public` / `private` | **private forces local** (DPA-guard bias) |
| `hasOracle` | bool | narrow text with a cheap oracle → local + loop |
| `longContext` | bool | long context only a frontier holds → frontier |
| `override` | `{placement, modelId, provider, reason}` | forces & stamps the route |

The policy table itself is `DEFAULT_POLICY` (`policy.ts`) — **data, not logic**.
Each row sources its `reason` to a feasibility doc and carries a
`commercialSafe` flag (FLUX.1 dev / Kontext[dev] are non-commercial and never
the default).

## Integrity line (inherited from the feasibilities)

- Parity holds only on a **narrow** task. The edge is **local + private + cheap
  + auditable**, never raw force.
- **No token-economy metric.** "% of tokens saved" is not a value claim here —
  refuted 3× (`products/kairos/bench/GATE_RESULTS.md`). A test asserts the
  policy table carries no such claim.
- We did **not** invent model routing (OpenRouter, Martian, RouteLLM, LiteLLM,
  Portkey, host pickers already route). The differentiator is the **combination**
  the landscape doesn't ship together: the *choice* as an audit event,
  re-derivable on the zero-trust ledger.

---

## SHIPPED (this increment — verifiable by shell)

- **Model stamp in the ledger.** `@batiste-aidk/audit`'s `AuditedToolHandler`
  now **accepts and persists** measured `usage {modelId, provider, source:
  'api_usage'}` via the `resolveUsage` seam. `ledger.query()` / `tokenTotals()`
  answer **"which model executed which tool"**. The provenance gate
  (`TokenUsageSchema`, `source: 'api_usage'`) is enforced — a `chars/4` estimate
  cannot be laundered in; a bad source is silently dropped, not persisted.
  *(packages/audit — 5 new middleware tests)*
- **Declarative routing policy.** `DEFAULT_POLICY` — the spec §2 table as data,
  sourced to the feasibility docs, with per-model commercial-licence flags.
- **Deterministic `route(task) → RouteDecision`.** Pure function over the
  decision axes; local-first with honest frontier escalation; private data
  biases local. *(18 router tests)*
- **Manual override**, itself stamped (`via: 'override'`, reason carried).
- **Custom/whitelabel policy table** injectable per tenant.

## ROADMAP (NOT shipped — stated plainly)

- **Small local classifier** (RouteLLM/NotDiamond-style, running local +
  audited) layered over the heuristic. Today the policy is pure heuristic.
- **dpa-guard ENFORCEMENT wiring.** `privacy: 'private'` only *biases* the
  choice here. The hard enforcement — "this task touches Art. 9 / off-allowlist
  data → reject or force local" — consumes `decideOutbound()`
  (`@batiste-aidk/transport/dpa-guard`, decision exists; gateway wiring not
  landed).
- **Per-op selection inside `@batiste-aidk/parallel`.** Each subagent of a sprint
  picking its optimal model, with the choice on the `LineageEntry` (which has no
  model field today) flowing through the existing `onLineage` sink. Today the
  router is standalone; it is not yet called per-op in the DAG.
- **Tournament → learn.** No feedback loop that updates the policy from observed
  outcomes. The policy is static config.
- **The §6 experiment** (route a real sprint, measure cost/quality/auditability)
  — not run. Pre-registration and the valid-refutation criterion live in the
  spec.

The honest headline: **the runtime now stamps which model ran each tool, and
chooses one deterministically from a sourced policy. It does not yet run a
local classifier, enforce DPA on the route, or learn.**
