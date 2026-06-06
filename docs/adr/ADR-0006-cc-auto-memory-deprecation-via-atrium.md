# ADR-0006 — Claude Code auto-memory deprecation; Atrium becomes the single ingestion plane

- **Status:** Accepted
- **Date:** 2026-04-24
- **Deciders:** Jardhel Martins Cachola (founder, Cachola Tech)
- **Trigger:** v1.3 hotfix session 2026-04-24 surfaced that Claude Code's auto-memory feature (`~/.claude/projects/<cwd>/memory/`) had become a 6th unwritten layer of truth not enumerated in ADR-0002 (Firm Memory governance). Audit found **15 files in the batiste repo's silo and 11 separate `memory/` directories across all of the founder's CWDs** — the same person and the same firm, fragmented into eleven invisible silos with no cross-read, no dedupe, and no projection into the Obsidian vault or into the Firm Memory substrate. The founder formulated the issue precisely: *"o índice de memória era pra ser o do batiste ne desde quando chamava seu-claude memória infinita, preciso que você resolva tudo isso."*

## Context

ADR-0002 (Firm Memory governance) enumerated five sources of truth and declared Firm Memory the single projection of all of them. It missed a sixth: Claude Code's per-CWD auto-memory feature, which silently writes Markdown files with YAML frontmatter into `~/.claude/projects/<cwd>/memory/*.md`. Each file is one observation; each `MEMORY.md` is its index.

The feature is well-meaning — it bridges sessions when no other persistence exists — but in the presence of a Firm Memory substrate (`@batiste-aidk/memory`, milestone v1.2.0-alpha.3 closed in this session) it becomes a competing store with the following pathologies:

1. **Silo per CWD:** the same founder, in the same firm, opening Claude Code in `~/Documents/git/batiste/`, `~/Documents/git/cachola-tech/`, `~/Documents/git/seu-claude/`, the Obsidian vault directory, and 7 other paths, generates **11 independent memory directories** with no cross-read.
2. **No vector retrieval:** Claude Code searches its memory by filename / index pointer, not by semantic similarity. The substrate that Cachola Tech's product *exists to provide* is bypassed.
3. **No audit ledger emit:** writes happen invisibly to ADR-0001 RLS policies and to ADR-0002 audit chains.
4. **No deduplication:** the same fact (e.g., "Use Batiste tools by default") may appear in multiple silos with drift.
5. **No multi-tenant isolation primitive:** every silo is implicitly the founder's namespace; there is no path for a future Bonita G operator's analyst to use Claude Code-on-the-firm without writing into the firm's memory.

In short: Claude Code auto-memory is a useful primitive at the platform level, but at the *deployment* level it is the kind of unannotated drift the Firm Memory governance ADR exists to prevent.

A second discovery in the same session: **the founder's historical Claude Code session logs** (`~/.claude/projects/<cwd>/<session-uuid>.jsonl`) are themselves a corpus of decisions, prior reasoning, and discarded paths that today live nowhere queryable. Tens of sessions, hundreds of MB. ADR-0002 §"Replication flows" called for `batiste-fm ingest-session` to ingest *new* sessions going forward (Loop 4 in the v1.3 plan) but left the historical brain dump implicit. The founder explicitly elevated it to v1.3 scope: *"pensei que poderíamos tentar puxar também de memórias e chats antigos na implantação, aí teria o brain dump pro modelo Batiste."*

## Decision

### A new package: `@batiste-aidk/atrium`

The runtime layer that wires sources to the Firm Memory substrate is named **Atrium** — the entry hall of the firm, where everything (memory MD, historical sessions, vault notes, Drive assets, Trello briefings) passes through before reaching the inner sanctum (the SQLite + LanceDB store).

Atrium ships:

- A CLI binary `batiste-fm` (Firm Memory operator) with two verb groups:
  - `batiste-fm ingest <source> [opts]` — pull a source into FM. Sources: `cc-memory`, `cc-sessions`, `vault`, `drive`, `trello`.
  - `batiste-fm retrieve <query> [opts]` — RAG search against FM, prints top-K with provenance.
- A SessionStart hook script (`bin/install-hook.sh`) that wires `batiste-fm ingest cc-sessions --since <last>` into Claude Code's hook system, so going forward every session ingests itself at start.
- A per-source checkpoint store (`~/.batiste/firm-memory/checkpoints.json`) so re-runs are incremental, not full-scan.
- An audit-emit-before-mutation policy: every FM write goes through Atrium's `withAudit()` wrapper, which appends an `AuditEntry` to the deployment ledger before the SQLite/LanceDB write commits.

### Auto-memory is deprecated as an authoritative store

After v1.3 ships, the rule is:

| Source | Old role | New role |
|---|---|---|
| `~/.claude/projects/<cwd>/memory/*.md` | per-CWD authoritative store | one-time historical input to `batiste-fm ingest cc-memory`; thereafter read-only archive |
| `~/.claude/projects/<cwd>/<session>.jsonl` | ephemeral session log | source for `batiste-fm ingest cc-sessions`, both historical (one-time) and live (SessionStart hook) |
| Obsidian vault (`~/.../iCloud~md~obsidian/.../cachola-tech/`) | narrative source of truth (per ADR-0002) | unchanged; ingested via `batiste-fm ingest vault` (graphify) |
| Drive (Loungerie catalog) | absent in code | `batiste-fm ingest drive` |
| Trello (Loungerie briefings) | absent in code | `batiste-fm ingest trello` |
| Firm Memory substrate (`~/.batiste/firm-memory/`) | aspirational | **the canonical store** for every source above |

Each `MEMORY.md` index file in the 11 CWDs is, after the v1.3 import, **rewritten as a stub** pointing to `batiste-fm retrieve`:

```markdown
# Memory has moved to Batiste Firm Memory.
This deployment's memory now lives in `~/.batiste/firm-memory/`.
Query: `batiste-fm retrieve "<your query>"`
Original entries: imported on 2026-04-24, audit refs in `<deployment>/.audit/document-audit.db`.
```

This kills future Claude Code auto-memory writes in these directories: the unfamiliar format causes Claude Code to leave the file alone rather than auto-append.

### Brain dump as a first-class v1.3 capability

The historical brain dump (`batiste-fm ingest cc-sessions --all`) is mandated for v1.3, not deferred:

- Walks every `~/.claude/projects/*/[uuid].jsonl`.
- Skips meta events (`permission-mode`, `file-history-snapshot`, system messages).
- Extracts user turns (`type: 'user'`, `message.content` as string) and assistant text blocks (`type: 'assistant'`, content blocks where `type === 'text'`). Tool calls and `thinking` blocks are skipped — too noisy for retrieval, and `thinking` is private by Anthropic's product contract.
- Each turn becomes a `FactEntry` with `kind: 'observation'`, `id = sha256(<sessionId>:<uuid>):16`, `workstream = basename(cwd)`, tags `[source:cc-jsonl, session:<uuid>, role:<user|assistant>, cwd:<full-cwd>]`, `vault_ref = <jsonl-path>:<line>`, `sensitivity: 'confidential'`.
- Secret scrubbing on the body before embedding (regex pack: API keys, OAuth tokens, paths under `/private/`, `Bearer ` headers, etc.).
- Content-hash dedupe via a `body_hash` column.
- Per-file checkpoint (last byte offset processed) so subsequent runs are O(delta), not O(corpus).
- Audit-emit-before-mutation per turn.

The one-time historical pass is CPU-bound on the local embedder (Xenova/all-MiniLM-L6-v2, 384 dim). Estimated 1-3 hours of background compute on first run for the founder's full corpus; idempotent if interrupted.

### Atrium owns the mutation guarantees

ADR-0002 §"Replication flows" required *"each ingestion path writes an event to the deployment's audit ledger before it mutates FM, so the projection is itself auditable"* but did not specify where the wrapper lives. **Atrium is that wrapper.** Direct callers of `SqliteFirmMemory.put()` outside of Atrium are deprecated; everything goes through `atrium/src/audit-wrap.ts` (a thin function that takes a tool name + args, opens an `AuditLedger` at `~/.batiste/firm-memory/.audit/document-audit.db`, appends, then performs the FM mutation, and updates duration on success/failure).

This closes the gap that was previously masked by the v0.1 `InMemoryFirmMemory` (which had no ledger because the audit package was not a dependency of memory).

## Alternatives considered

### Alt 1 — Keep using Claude Code auto-memory; treat it as authoritative

**Rejected.** Eleven silos invisible to each other is not a memory system; it is a memory leak. And the platform feature has no semantic search, no audit, no isolation primitive — exactly the three things the firm pays Cachola Tech to provide.

### Alt 2 — Ingest at session start only; ignore historical sessions

**Rejected.** The founder's argument carries: the brain dump *is* the demo. A FM populated with one fresh session is a feature; a FM populated with the founder's full Claude Code corpus is a product moment ("watch your entire Claude history become queryable in 60 seconds"). The cost (one-time CPU pass) is bounded and idempotent.

### Alt 3 — Name the new package `cold-setup` (the working name during planning)

**Rejected** by the founder mid-session: *"cold setup is a very bad name."* `cold-setup` is engineer-speak for a provisioning script; the package is the runtime ingestion + retrieval plane and deserves a product noun. **Atrium** was selected over candidates `keep` (sovereign-fortress connotation) and `synapse` (neural connotation) because the entry-hall metaphor maps cleanly to ingestion-and-curation, and aligns with the brain-dump capability that just landed in scope.

### Alt 4 — Defer the silo migration to v1.4; only ship Atrium subcommands in v1.3

**Rejected.** The migration *is* the dogfood proof. v1.3 demos Atrium against the founder's own 15 memory files and ~30+ historical jsonl files; if it does not work on the founder's data, it will not work on Bonita G's.

## Consequences

### Positive

- One canonical ingestion plane (Atrium) for every source, enforcing audit emit and namespace isolation uniformly.
- The 11 invisible silos collapse into one queryable Firm Memory; cross-CWD retrieval becomes possible for the first time.
- Historical brain dump turns ~30+ jsonl files into a queryable corpus — a public-facing demo capability ("memoria infinita").
- Future Claude Code auto-memory writes are quiesced by the stub-replacement strategy.
- Atrium becomes the single integration point for new sources (a future `ingest slack`, `ingest gmail`, `ingest linear` does not require touching `@batiste-aidk/memory`).

### Negative

- One-time CPU cost for the historical embedding pass (1-3 hours, background, idempotent).
- Atrium is now a hard dependency between `@batiste-aidk/memory`, `@batiste-aidk/audit`, and any deployment that wants the brain-dump capability — inflates the install footprint.
- Founder must remember to run `batiste-fm ingest cc-sessions` (or rely on the SessionStart hook) for live updates; without the hook, FM drifts behind reality.

### Neutral / to watch

- The stub-replacement strategy for `MEMORY.md` may not survive a Claude Code update that auto-recreates the file; if so, we add a `.atrium-no-write` marker file that Atrium's wrapper checks and Claude Code ignores. Punt to v1.4 if it surfaces.
- Embedder model version pinning (raised in ADR-0002 §"Neutral / to watch") becomes more important once the historical corpus is ingested at one model version; a future model bump requires a full reindex. Add a `model_version` column in v1.4 schema migration.

## Verification (gates for v1.3 release)

1. `packages/atrium` builds clean (`pnpm --filter @batiste-aidk/atrium build`).
2. `batiste-fm ingest cc-memory` run against `~/.claude/projects/-Users-jardhel-Documents-git-batiste/memory/` imports all 15 files into FM with audit-emit per entry; re-run is a no-op (idempotent via content hash + checkpoint).
3. `batiste-fm ingest cc-sessions` run against the same CWD imports all 5 historical jsonl files; turn count matches a `wc -l` minus meta-event count; re-run with no new lines is a no-op.
4. `batiste-fm retrieve "trello briefing loungerie"` returns the `project_ana_luisa_ingestion.md` entry as a top-3 hit (proof: vector retrieval works on imported content).
5. `~/.claude/projects/<cwd>/memory/MEMORY.md` is replaced with the stub for at least the batiste CWD; index integrity is preserved by the audit ledger reference.
6. Multi-tenant isolation test from ADR-0002 §"Multi-tenant isolation" still passes (`pnpm --filter @batiste-aidk/memory test`).

## Related

- ADR-0002 — Firm Memory governance (this ADR closes a gap in §"Replication flows").
- ADR-0001 — RLS extension (within-tenant access control; orthogonal to namespace isolation).
- ADR-0003 — seu-claude absorption roadmap (to be written; defines how `~/Documents/git/seu-claude/` and its memory silo collapse into Batiste).
- ADR-0005 — cross-deployment sharing (to be written; the federation story Atrium enables once the marketplace ships).
- `releases/2026-04-24-ana-luisa-vault-v1.3/` — first envelope to depend on Atrium.
