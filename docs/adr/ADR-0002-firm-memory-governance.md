# ADR-0002 — Firm Memory governance: sources of truth, projection rule, and multi-tenant isolation

- **Status:** Accepted
- **Date:** 2026-04-24
- **Deciders:** Jardhel Martins Cachola (founder, Cachola Tech) · advisory: Dr. César Cipriano de Fazio (counsel)
- **Trigger:** hotfix session 2026-04-24 uncovered that `@batiste-aidk/memory` advertised Firm Memory capabilities whose backend (SQLite + vector) was still a TODO marked for milestone v1.2.0-alpha.3. The founder pressed: *"tem que ir pra cold setup"* and *"senão não estamos fazendo dogfood at all"*. Before completing the backend migration, an explicit governance model had to be written so that the code would anchor on written rules, not informal intent.

## Context

Firm Memory is the centerpiece of Batiste v2's "your-Claude" thesis (see `04 Decision/2026-04-22 — Batiste v2 thesis — Firm Memory + DPA-compliant gateway.md` in the Cachola Tech vault). The public promise is: *"A foundation-model call may receive a retrieved chunk, never the corpus. The firm's IP stays inside the deployment."*

Prior to 2026-04-24 the package `@batiste-aidk/memory` shipped:

- Zod schemas for `PromptEntry` and `FactEntry` with `sensitivity`, `vault_ref`, `audit_ref` fields.
- Contracts `PromptStore`, `FactStore`, `FirmMemory` (lexical + vector + filter by tag/kind/category).
- An `InMemoryFirmMemory` v0.1 implementation that explicitly throws on `vectorOnly: true` with the message *"vector search is not available in the in-memory store — use the SQLite+sqlite-vec backend when it ships (v1.2.0-alpha.3)"*.

Meanwhile a working local vector engine existed in `seu-claude/src/vector/` (HuggingFace transformers + LanceDB) that **was never migrated** into Batiste. The contract was real; the backend was vapor.

Five sources of truth coexist without a precedence rule:

| Layer | Location | Truth type | Governance state pre-ADR |
|---|---|---|---|
| Founder vault | `~/.../iCloud~md~obsidian/.../cachola-tech/` | narrative, decisions, memory notes | Obsidian + iCloud, no audit |
| Release artifacts | `~/Documents/git/cachola_tech/releases/` | stamped deliverables for clients | git + `brand/stamp_*.py` hashes (partial) |
| Batiste monorepo | `~/Documents/git/batiste/` | product code | git, does not dogfood own audit |
| Seu-claude | `~/Documents/git/seu-claude/` | legacy engine (should absorb into Batiste) | git, divergent |
| Session jsonl | `~/.claude/projects/<cwd>/*.jsonl` | conversational provenance | local, not ledgered |

Without written governance, each agent touching Firm Memory would invent local conventions, drift would compound, and the public claim would remain falsifiable — exactly the failure mode that triggered this ADR.

## Decision

**Firm Memory is a *projection* of authoritative sources, not an additional source.** This is the single rule that resolves every downstream question.

### Canonicality rules

1. **Narrative source of truth = founder vault.** Decisions, pricing policy, memories about persons/projects, and reference docs originate in the Obsidian vault. The founder is the sole writer.
2. **Code source of truth = Batiste monorepo, `main` branch.** Packages are published via changesets. CI runs as a principal distinct from the founder.
3. **Audit ledger source of truth = per-deployment.** Each deployment maintains its own `<root>/.audit/document-audit.jsonl` (append-only). A Batiste node never reads another deployment's ledger without an explicit opt-in cross-sharing agreement (future §6).
4. **Firm Memory is a projection of 1 + 2 + 3.** If Firm Memory disagrees with any source, Firm Memory is wrong; rebuild it.

### Replication flows (source → FM)

Three ingestion paths, each optimized for its source:

- **Founder vault → FM** via `batiste-fm vault-refresh` — uses **graphify** (Leiden clustering + wikilink/tag/frontmatter topology extraction). The vault was designed around the graph; AST-only chunking would drop ~70% of its retrieval signal. Output `graph.json` is parsed into `FactEntry` records with relation refs in the body.
- **Batiste src + seu-claude src (post-absorption) → FM** via code indexing — AST chunking via tree-sitter (the existing `@batiste-aidk/code` path), per-function/class granularity.
- **Session jsonl → FM** via `batiste-fm ingest` — turn-level chunking, secret scrubbing, then embed + upsert. Each session event becomes a `FactEntry` with `kind: 'observation'`.

Each ingestion path writes an event to the deployment's audit ledger before it mutates FM, so the projection is itself auditable.

### Write rules (who can change what)

| Principal | Vault | Batiste main | Releases | Client FM | Client audit |
|---|---|---|---|---|---|
| Founder | ✅ write | ✅ write | trigger (via CI) | — | — |
| Cachola Tech CI | read | ✅ merge + tag | ✅ stamp | — | — |
| Agency gestora (e.g., Ana Luisa) | — | — | — | ✅ write own | ✅ append own |
| Agency analyst | — | — | — | read (with RLS) | read (scoped) |
| Cachola Tech advisor | — | — | — | view-only export (opt-in) | view-only export (opt-in) |
| Foundation-model (Claude) | — | — | — | read-through-retrieval | append via hook |

### Multi-tenant isolation

Every `FirmMemory` instance is namespaced. `SqliteFirmMemory` takes a constructor option `namespace: string` (default `'default'`). Every SQL row carries the namespace. Every LanceDB table key includes the namespace. Every `search` filters by namespace in both lexical and vector paths. Cross-namespace reads require an explicit `SharedMemoryView` that logs each access to the audit ledger (ADR-0005 to be written when the first two-tenant deployment materializes).

A baseline isolation test lands with v1.3: put in namespace A, query from namespace B with identical terms, assert zero overlap. This test is non-negotiable for future backend changes.

### Why isolation matters beyond agencies (verified target verticals)

The namespace primitive specified above is the foundation for every regulated vertical Cachola Tech intends to enter. Agency (Bonita G) is the entry case. The harder cases that validate the design:

- **Healthcare / nutrition:** LGPD Art. 11 (sensitive personal data — requires specific highlighted consent), CFM Resolução 1.821/2007 (prontuário retention ≥ 20 years with integrity guarantees), ANS RN 305 (private health-operator data). Each clinic/nutritionist/hospital is a tenant; within a tenant, RLS (ADR-0001) handles role separation (attending physician, nursing, admin, patient self-access).
- **Legal (OAB sigilo profissional):** each law firm is a tenant; within a firm, RLS handles partner/associate/paralegal/client access bands.
- **Fund administration (CVM + ANBIMA):** each fund is a tenant; internal segregation is handled by RLS with a separate policy pack.
- **Consumer psychology (CFP):** each practice is a tenant; patient consent management and session retention follow CFP Resolução 11/2018.

The namespace primitive is **necessary but not sufficient** for any of these — each requires an additional policy pack (consent management, retention, portability, data-subject rights, vertical-specific audit formats). Those policy packs ship as future Batiste packages (`@batiste-aidk/healthcare-policy`, `@batiste-aidk/legal-policy`, ...). Without the namespace primitive at the core today, every future policy pack would re-implement isolation with drift — repeating exactly the failure mode this ADR exists to prevent.

Healthcare is the named target vertical whose constraints were used to stress-test this design (founder's domain: former integration engineer at Hospital Albert Einstein, Cerner implementation). If the design does not hold for healthcare, it does not hold.

### Divergence resolution

- **FM drifts from source:** rebuild FM. The rebuild is idempotent — running `batiste-fm rebuild --source all` must produce a byte-identical SQLite + LanceDB state given identical sources. Non-determinism in the embedder (e.g., model version drift) is its own audit event.
- **Release claim ≠ implemented code:** CI blocks the release. A `brand/verify_claims.py` script (to be written pre-v1.4) scans release docs for claims of the form "Firm Memory retrieves X" or "audit ledger tracks Y" and asserts the referenced code path exists with a passing test.
- **Vault edits an already-stamped release artifact:** the vault edit wins if newer; the stamper re-runs on next release cycle. The stamper emits a new manifest with a new hash.

### Cross-deployment sharing (future, scoped out of this ADR)

Client FMs are air-gapped by default. The envisioned marketplace (`@batiste-aidk/marketplace`) will support opt-in cross-deployment sharing — e.g., Agency A sharing its "anonymized outcome facts" with Cachola Tech for benchmarking — via a consent-logged export protocol. That design is deferred to a dedicated ADR when the first sharing agreement exists; today's rule is **"no implicit cross-reads, period."**

## Alternatives considered

### Alt 1 — No written governance; let conventions emerge

**Rejected.** This is what we had pre-ADR, and it produced a public claim with no backing code. Every new integration would have re-invented access rules, ingestion flows, and divergence handling. The cost of discipline is a short ADR; the cost of no discipline is unlimited.

### Alt 2 — Declare Firm Memory a source of truth (not just projection)

**Rejected.** Dangerous failure mode: a retrieval error or embedder drift becomes a data-loss event if FM is canonical. Declaring FM as projection means rebuild is always safe — the worst a bad FM run can do is degrade retrieval until the next refresh. This matches how every durable production search/retrieval system is designed (Elastic, Weaviate, Pinecone-as-index not as store).

### Alt 3 — Single-tenant for v1.3; add multi-tenant later

**Rejected.** Isolation architecture is the kind of thing that's cheap to build in from day one and expensive to retrofit after two tenants diverge. The namespace column in SQLite and the namespace prefix in LanceDB table names are both trivial additions today; rewriting a live multi-tenant system is not.

### Alt 4 — Use AST chunking for vault (simpler, fewer moving parts)

**Considered, rejected.** Obsidian vaults are graph-first by design. Wikilinks (`[[Note Name]]`), tags (`#tag`), and frontmatter refs encode relationships that AST chunking collapses into flat text. Retrieval quality on the vault is substantially worse without the graph. Graphify adds one install (pipx) and one refresh command — a small price for the retrieval gain. The code path remains AST-based because code's structure *is* its graph (imports + calls).

## Consequences

### Positive

- Firm Memory's public claim stops being falsifiable — it now maps onto a testable implementation with rules that CI can enforce.
- Onboarding the next client is **hours, not days**, because ingestion + retrieval + isolation are package concerns, not per-deployment hacks.
- Legal/compliance conversations (LGPD, DPA) become substantive: "your data lives in your namespace, never leaves without your opt-in, every access is audited."
- The projection rule makes rebuilds safe, which makes experimentation on ingestion/embedding/retrieval safe.

### Negative

- Write path adds an audit ledger emit before every FM mutation. Each `put` pays for one ledger append. Benchmarks pending; acceptable given scale profile (hundreds of entries per session, not millions).
- Three ingestion paths (code AST, vault graph, session turn) means three code surfaces to maintain. The alternative (one path that handles all) would be worse in quality.
- Graphify integration introduces a Python dep (`graphifyy`) alongside the Node/TS stack. Mitigated by isolating it to the cold-setup app and treating it as a tool, not a library.

### Neutral / to watch

- If embedder model versions drift between a client deployment's `npm install` and Cachola Tech's reference build, retrieval results differ. The rebuild rule handles this, but we should pin the model version in `@batiste-aidk/memory`'s package.json and add a startup warning when the loaded model doesn't match.

## Verification

1. `@batiste-aidk/memory` has `SqliteFirmMemory` with a `namespace` constructor option; test `sqlite-store.test.ts` includes a "put in A, query from B → zero hits" assertion. **Gate for v1.3 release.**
2. `batiste-fm vault-refresh` produces `FactEntry` records whose `body` field references wikilinks extracted by graphify. **Gate for v1.3 release.**
3. `batiste-fm ingest` records one audit ledger event per FM mutation. **Gate for v1.3 release.**
4. Founder-only test: writing directly to FM without a corresponding source update triggers a `divergence` warning on the next `rebuild --source all` (drift detection). **Gate for v1.4.**
5. A `brand/verify_claims.py` script reads release INDEX.md files and asserts every claim of the form "Firm Memory retrieves X" is backed by a passing test. **Gate for v1.4.**

## Related

- `04 Decision/2026-04-22 — Batiste v2 thesis — Firm Memory + DPA-compliant gateway.md` (Cachola Tech vault) — strategy doc this ADR operationalizes.
- `ADR-0001-rls-extension.md` — complements this ADR: RLS governs *who* within a tenant; this ADR governs *what* is true across tenants.
- `releases/2026-04-24-ana-luisa-vault-v1.3/` (in progress) — first release to ship with this ADR in force.
- `ADR-0003-seu-claude-absorption-roadmap.md` (to be written) — completes the migration of search/agents/context from seu-claude, referenced in §"Replication flows".
