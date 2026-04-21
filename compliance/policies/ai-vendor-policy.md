# AI Vendor & Foundation Model Policy

**Owner:** CEO + Security Lead · **Version:** 0.1.0 · **Effective:** 2026-04-21
**Maps to:** EU AI Act Arts. 25, 53-55 (GPAI); ISO/IEC 42001:2023; DORA Arts. 28-30 (third-party ICT); GDPR Art. 28; ISO 27001 A.5.19-23.

> This policy governs how the firm and Batiste-operated workflows consume third-party foundation models (Anthropic Claude, OpenAI GPT, Google Gemini, etc.). It complements `ai-governance-policy.md` (which governs AI *we build*) and `vendor-management-policy.md` (which governs vendors generally).

## 1. Scope

Applies to every workflow — engineering, legal, commercial, operational — in which the firm or a Batiste agent calls a third-party LLM API, regardless of whether the workflow is internal or client-facing.

## 2. Threat model

Four risk vectors are recognised:

| # | Vector | Posture |
|---|---|---|
| V1 | **Training on input** — provider may use our content to train future models | Mitigate via tier selection |
| V2 | **Output ownership ambiguity** — unclear IP over generated content | Mitigate via contract + human review |
| V3 | **Competitor access** — provider serves the same model to our competitors | Accept; compete on orchestration, not model access |
| V4 | **Dependency lock-in** — provider can change terms, deprecate models, or suspend account | Mitigate via multi-provider fallback |

## 3. Required controls

### 3.1 Tier discipline (mitigates V1)

- **All firm work** MUST use a **paid, commercial tier** of a foundation-model provider (e.g., Claude API, Claude for Work, OpenAI API via organisation account). Consumer tiers (Claude.ai free/Pro, ChatGPT Plus without API) MUST NOT be used for any work that touches firm or client IP.
- **Claude Code / Claude API / Claude for Work** are approved for firm work under Anthropic Commercial Terms §6.1 (no training on customer content).
- **Feedback mechanisms** (thumbs up/down, "report this response", shared links) MUST NOT be used when reviewing output containing firm or client IP — they may be used for training per the consumer-tier ToS.

### 3.2 Output provenance (mitigates V2)

- Every artefact with commercial value MUST pass through **substantive human review** before shipping. Stylistic edits are not sufficient; structural edits are. The final version MUST be authored (git commits, contract signatures, brand stamp) by a human principal.
- The firm's commercial contracts with clients MUST include language clarifying that deliverables are owned by the firm irrespective of the tools or methods used in their production, and are subsequently assigned to the client per the contract terms.
- **AI-assisted code** in Batiste-owned repositories is acceptable under the Batiste MIT licence. Provenance is tracked via git commit metadata (commits attributable to a human; Co-Authored-By trailers permitted for model-assisted edits) and reflected in `CONTRIBUTING.md`.

### 3.3 Competitive posture (acknowledges V3)

- The firm explicitly **does not** position foundation-model access as a moat. Moats are orchestration (Batiste), governance (GVS), integrator relationships, and validated prompt libraries.
- Public communications (blog, press, landing) MUST NOT imply that the firm has exclusive access to any foundation model.

### 3.4 Continuity & fallback (mitigates V4)

- The firm MUST maintain a **secondary AI-vendor account** (different parent company from the primary) at a functional tier that permits production workload. As of 2026-04-21, primary is Anthropic; secondary to be selected within 30 days (candidates: OpenAI, Google Vertex, AWS Bedrock).
- The `batiste-prompts/` library (separate repository, see §5) MUST mark each prompt with a `model_preference` frontmatter key: `claude-opus-4 | claude-sonnet-4 | any`. Prompts marked `any` constitute the **continuity tier** — enough coverage to sustain operations during a primary-provider outage.
- **Disaster-recovery drill:** at least once per 12 months, a sample of `any`-tier prompts MUST be executed against the secondary provider and the output quality compared to the primary. Results recorded in `compliance/drills/ai-vendor-failover-YYYY-MM.md`.
- On-prem hosting (Claude on AWS Bedrock Dedicated, Gemini on Vertex Private Endpoint) SHOULD be re-evaluated every 6 months; adopt when client revenue justifies it.

### 3.5 Contractual posture with clients

- The firm's standard service contract MUST include a clause analogous to:
  > *"A entregabilidade das obras contratadas não é afetada por descontinuidade, alteração de termos, ou indisponibilidade de qualquer fornecedor de modelo de linguagem (foundation model) ou provedor de inteligência artificial de terceiros. A Cachola Tech mantém infraestrutura de continuidade multi-fornecedor para assegurar a entrega conforme o cronograma acordado."*
- For clients in regulated sectors (defence, finance, health), the firm MAY additionally commit to a named primary + named fallback provider in the contract.

## 4. Data protection

- Processing of personal data through a foundation-model provider requires a **Data Processing Agreement** (Art. 28 GDPR) between the firm and the provider, with Standard Contractual Clauses if the provider is outside the EEA.
- Anthropic DPA (publicly available) SHALL be executed by the CEO before Anthropic services are used to process any client personal data (counterparty names, contact details, transaction data). Open action item as of 2026-04-21 — see `vendors.md` V9.
- Personal data with special categories (GDPR Art. 9) MUST NOT be sent to any foundation-model provider without an explicit, documented legal basis.

## 5. The prompt library

The firm maintains a public library of validated prompts at `github.com/jardhel/batiste-prompts` (separate repository, MIT licence). The library:

- Is the shared content layer for all firms that adopt Batiste.
- Receives validated prompts only (see `CONTRIBUTING.md` in that repo).
- Is used by the firm internally — the founder's first stop before composing any commercial or governance artefact.

Prompts in the library MUST NOT contain confidential material (counterparty names, dollar figures, internal references); such material is filled via placeholders at use time.

## 6. Exception handling

A deviation from §3 requires written approval from the CEO and documentation in `compliance/declarations/ai-vendor-deviations.md` with date, reason, scope, and compensating control.

## 7. Review

- **Annual review** by CEO + Security Lead.
- **Event-driven review** on: material change to a provider's commercial terms; public breach of a provider; acquisition of a provider; deprecation of a model class in active use.
- Each review appends an entry to `compliance/vendor-reviews/YYYY-MM-<provider>.md`.

## 8. References

- Anthropic Commercial Terms — `https://www.anthropic.com/legal/commercial-terms` (versioned review on each annual audit).
- Anthropic DPA — `https://www.anthropic.com/legal/dpa`.
- OpenAI Business Terms — `https://openai.com/policies/business-terms`.
- EU AI Act Art. 25 (responsibilities along the AI value chain).
- EU AI Act Arts. 53-55 (obligations for providers of general-purpose AI models).

---

*This policy is a living document. Raise a PR against `compliance/policies/ai-vendor-policy.md` to propose changes.*
