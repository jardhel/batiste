---
title: Governance Vault Specification
short_title: GVS
version: 0.1-draft
status: draft
date: 2026-04-20
editor: Cachola Tech Holding B.V.
authors:
  - Jardhel Martins Cachola
reference_implementation: Batiste
license: CC-BY-4.0
canonical_source: https://github.com/batiste-ai/batiste/blob/main/specs/gvs-0.1.md
---

# Governance Vault Specification

**Version 0.1 · Draft · 2026-04-20 · Editor: Cachola Tech**

> *A protocol for rendering AI-governed ledger state as a navigable knowledge vault — such that the graph and the ledger are the same substance, viewed from two axes.*

---

## 0. Status of this document

This is a **draft** specification, published in the Batiste repository as the canonical source. It is written in English and offered as a public, vendor-neutral market standard under Creative Commons BY 4.0. Until v1.0, the specification may change without notice. Breaking changes between minor versions are permitted during the `0.x` line; each will be announced in the changelog (Appendix C).

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this document are to be interpreted as described in RFC 2119.

Batiste is the reference implementation of this specification. Batiste's inclusion of the spec in its repository does not privilege Batiste over any other conforming implementation: compliance is purely mechanical, measured by the validation rules in §10.

## 1. Abstract

The Governance Vault Specification (GVS) defines a filesystem layout, metadata schema, and linking discipline for a markdown-based *governance vault* — a directory whose structure mirrors the six axes of AI-orchestrated corporate governance (Identity, Policy, Roles, Decision, Memory, Audit). A conforming vault SHALL be simultaneously (a) human-readable as a knowledge base and (b) machine-consumable as a rendering of an immutable audit ledger. The specification is agnostic to the tool used to browse the vault (Obsidian, VS Code, plain filesystem) and to the language of note contents.

## 2. Motivation

Corporate AI-governance platforms produce two valuable but historically disjoint artifacts: an **audit ledger** (temporal, cryptographically signed, authoritative) and a **knowledge base** (relational, navigable, human-intelligible). The disjunction forces organizations to maintain both — the ledger for regulators and the knowledge base for the team — with continual drift and reconciliation cost.

GVS eliminates the disjunction. The same write operation that stamps an artifact into the ledger also emits a note whose wikilinks render the ledger as a graph. Onboarding a new team member becomes self-service: they browse the vault, follow links, and recover the state of the firm without a human guide. Compliance audits become reproducible: every decision cited in a policy note has a wikilink to its audit entry, which has a wikilink to its manifest, which has a cryptographic hash over the canonical artifact.

## 3. Terminology

- **Vault** — a directory of plain-text markdown files with interlinked notes and metadata.
- **Axis** — one of six canonical top-level categories (§5).
- **Note** — a markdown file containing YAML frontmatter and body. Each note represents one conceptual unit (an entity, a rule, a role, a decision, a piece of state, or a ledger entry).
- **Ledger entry** — a note in the `06 Audit/` axis representing one stamped artifact.
- **Manifest** — a JSON sidecar emitted by a conforming stamping tool, containing hash, timestamp, classification, and signatures for a canonical artifact.
- **Canonical artifact** — the authoritative document (PDF, `.tex`, `.md`, `.docx`) that a note describes. Lives outside the vault, in the operating repository.
- **Counterparty** — an external organization or natural person referenced by a note.
- **Workstream** — a named initiative that groups notes across multiple axes (a deal, a hire, a product line).
- **Principal** — an entity (human or agent) that can author notes and stamp artifacts.

## 4. Core principles

GVS rests on five invariants:

1. **Mirror, not copy.** The vault does not duplicate canonical artifacts; it references them by relative path in frontmatter.
2. **Six axes, no more, no less.** The top-level taxonomy is fixed at the six axes enumerated in §5. Implementations MUST NOT introduce seventh axes; instead, extend via tags or sub-folders.
3. **Every write produces two representations.** A stamping operation MUST produce both a ledger entry (temporal) and a note (relational) from a shared schema. They MUST agree.
4. **Markdown is the source of truth for the vault.** Tool-specific features (Obsidian plugins, VS Code extensions) MAY enrich the experience but MUST NOT be required to read a conforming vault.
5. **Machine-validatable.** A conforming vault passes a deterministic set of validation rules (§10). Compliance is not a matter of taste.

## 5. The six axes

The vault's top-level layout mirrors the six axes of AI-orchestrated corporate governance. Each axis is represented by a numbered folder:

```
vault/
├── 00 Home.md                  # entry index; SHOULD link to each axis
├── 01 Identity/                # who the firm is
├── 02 Policy/                  # rules the firm binds itself to
├── 03 Roles/                   # who can act, on which axis, with what authority
├── 04 Decision/                # material decisions and their rationale
├── 05 Memory/                  # live state — workstreams, deals, obligations
├── 06 Audit/                   # immutable record of stamped artifacts
├── _attachments/               # binary assets (images, PDFs); MAY be empty
└── _templates/                 # note templates per axis; REQUIRED for conforming vaults
```

A conforming vault **MUST** ship a `_templates/` directory containing one template per axis (§5.7). The templating discipline is normative: GVS is designed to be replicable by third parties without author presence, which requires every note type to have a ready-to-copy scaffold.

Folders MUST use the numbered-prefix form (`01 Identity`, `02 Policy`, …) for deterministic ordering across filesystems.

### 5.1 Identity (`01 Identity/`)

Notes describing **what the firm is**. Examples: legal entity records, founder bio, brand charter, tagline, canonical boilerplate. Identity notes change rarely; they are the firm's ground truth.

### 5.2 Policy (`02 Policy/`)

Notes describing **rules the firm has bound itself to**. Examples: this specification; voice and tone; operating principles; permissioning rules; recurring governance rituals. Policy notes are normative: they describe what MUST, SHOULD, or MAY be done, not what has been done.

### 5.3 Roles (`03 Roles/`)

Notes describing **principals** — humans and agents — and their authority to act. Each principal has one note. Notes MUST declare `principal_type: human | agent` and, if agent, `agent_model`. Roles notes wikilink to the policies they are bound by.

### 5.4 Decision (`04 Decision/`)

Notes recording **material decisions** — analogous to Architecture Decision Records (ADRs) but scoped to corporate governance. Each decision note MUST carry `decided_on` (ISO date), `authority` (wikilink to a role), and MAY carry `supersedes` (wikilink to prior decision). Decision notes are append-only: once stamped, they are not edited; a superseding decision is recorded as a new note.

### 5.5 Memory (`05 Memory/`)

Notes describing **live state** — workstreams in flight, deals under negotiation, obligations pending. Memory notes are the most mutable. They MUST carry `status` and SHOULD wikilink to the counterparty, the governing decisions, and the audit entries that bear on them.

### 5.6 Audit (`06 Audit/`)

Notes representing **ledger entries** — one note per stamped artifact. Audit notes are emitted programmatically by a conforming stamping tool (§11). They are immutable. Each MUST carry `ref` (unique), `manifest` (path to JSON sidecar), `stamp_hash`, and `stamped_on`. The filename convention is `YYYY-MM-DD-<REF>.md`.

### 5.7 Templates (`_templates/`)

A conforming vault **MUST** ship a `_templates/` directory containing one note template per axis, plus a `00-home.md` template. Each template file MUST:

- carry a complete YAML frontmatter with placeholder values enclosed in `{{double-braces}}`,
- contain a body scaffold with canonical section headings for that axis,
- be named `<axis-number>-<axis-slug>.md` (e.g. `01-identity.md`, `06-audit.md`),
- be valid markdown when placeholders are left unresolved — i.e., a template is itself a (non-conforming-but-parseable) note.

Templates are normative artifacts, not convenience scaffolds. They are the replication contract: anyone who adopts GVS MUST be able to fork a vault and instantiate new notes by copying templates without reading the spec end-to-end. A vault without `_templates/` is non-conforming, even if every existing note is valid.

Implementations MAY provide additional templates (e.g. `05-memory-deal.md`, `05-memory-hire.md`) as specializations. Additional templates MUST be named `<axis-number>-<axis-slug>-<specialization>.md`.

## 6. Frontmatter schema

Every note MUST carry YAML frontmatter. Required keys for all notes:

| Key | Type | Description |
|---|---|---|
| `title` | string | Human-readable title |
| `axis` | enum | `identity | policy | roles | decision | memory | audit` |
| `updated` | ISO date | Last substantive update |
| `status` | enum | `draft | active | paused | archived` |
| `tags` | array[string] | Taxonomy tags (§8.3) |

Optional keys, permitted on any axis:

| Key | Type | Description |
|---|---|---|
| `canonical` | path | Relative path to authoritative artifact outside vault |
| `language` | ISO 639-1 | Primary language of the note body |
| `supersedes` | wikilink | Prior note rendered obsolete by this one |
| `superseded_by` | wikilink | Later note that renders this one obsolete |

Axis-specific required keys:

| Axis | Key | Description |
|---|---|---|
| Decision | `decided_on` | ISO date the decision was taken |
| Decision | `authority` | Wikilink to the Roles note who took it |
| Roles | `principal_type` | `human | agent` |
| Roles | `agent_model` | If `principal_type: agent`, the model identifier |
| Memory | `counterparty` | Wikilink to counterparty note (if applicable) |
| Memory | `workstream` | Workstream identifier or wikilink |
| Audit | `ref` | Canonical document reference (implementation-defined) |
| Audit | `manifest` | Path to `manifest.json` sidecar |
| Audit | `stamp_hash` | SHA-256 of the stamped artifact |
| Audit | `stamped_on` | ISO-8601 datetime with timezone |

Unknown frontmatter keys MUST be preserved by tools and MAY carry implementation-specific metadata.

## 7. Naming conventions

- **Note filenames** SHOULD be human-readable titles. Diacritics, spaces, and non-ASCII characters are permitted for titles in the `01 Identity/`, `02 Policy/`, `03 Roles/`, `04 Decision/`, and `05 Memory/` axes.
- **Audit note filenames** MUST follow `YYYY-MM-DD-<REF>.md` for deterministic sorting.
- **Folders** MUST use the `NN Axis/` form with a two-digit zero-padded prefix.
- **Canonical artifact paths** (in `canonical:` frontmatter) MUST be relative to the repository root and use forward slashes.

## 8. Linking discipline

### 8.1 Wikilinks

All intra-vault references MUST use wikilink syntax: `[[Note Title]]` or `[[Note Title|display text]]`. Wikilinks MUST resolve to an existing note; broken wikilinks constitute a validation failure (§10).

### 8.2 External references

References to canonical artifacts outside the vault use relative paths in frontmatter (`canonical: legal/radaz/07_minuta_email_reset.md`) and, in the body, markdown links to the same path.

### 8.3 Tag taxonomy

Tags MUST be namespaced with a forward slash:

- `axis/<value>` — one of the six axes (redundant with frontmatter `axis`, but enables graph filtering)
- `status/<value>` — `active | paused | archived | draft`
- `counterparty/<slug>` — kebab-case counterparty identifier
- `workstream/<slug>` — kebab-case workstream identifier
- `classification/<value>` — `public | internal | confidential | confidential-nda | privileged`

Implementations MAY define additional namespaces but MUST NOT reuse these.

## 9. The ledger-graph duality

A conforming stamping tool performs, as a single atomic operation, **three writes** for each stamped canonical artifact:

1. The `manifest.json` sidecar next to the artifact (hash, timestamp, classification, signatures).
2. A line appended to the operating ledger (JSONL) under the implementation's audit directory.
3. A note written to `06 Audit/` in the vault, with frontmatter populated from the manifest and body containing wikilinks to:
   - the canonical artifact (via `canonical:` path in body as a markdown link),
   - the workstream note in `05 Memory/` (if `workstream` is set on the manifest),
   - the counterparty note in `05 Memory/` (if `counterparty` is set),
   - the governing decision note in `04 Decision/` (if cited in the artifact).

The three writes MUST succeed or fail together. On failure, the tool MUST NOT leave partial state.

This is the core property of GVS: **the ledger and the graph are derivations of the same event**. A compliant implementation renders both, and validation (§10) verifies they agree.

## 10. Validation

A conforming vault passes the following checks, enforced by a validation tool:

1. **Frontmatter completeness.** Every note has all required keys for its axis.
2. **Axis consistency.** Every note's `axis` value matches its containing folder.
3. **Wikilink resolution.** Every `[[...]]` resolves to an existing note.
4. **Canonical path resolution.** Every `canonical:` path resolves to an existing file.
5. **Audit uniqueness.** Every `ref` in `06 Audit/` is unique.
6. **Audit-ledger agreement.** For every note in `06 Audit/`, a matching line exists in the operating ledger with the same `ref`, `stamp_hash`, and `stamped_on`.
7. **Status consistency.** No note with `status: archived` is wikilinked from a note with `status: active` without a `supersedes` relation.
8. **Decision immutability.** No Decision note has been modified after its `decided_on` date, except to add `superseded_by`.

Tools MAY define additional checks but MUST NOT relax these.

## 11. Reference implementation

The reference implementation is **Batiste**, operated by Cachola Tech Holding B.V.:

- Stamping tool — emits manifest, ledger entry, and audit note in a single transaction.
- Verification tool — enforces the validation rules in §10 against a vault.
- Reference vault — the Cachola Tech governance vault, operating the firm's own decision record against this specification.

Batiste is not normative. A conforming implementation MAY replace any component provided it produces a byte-equivalent vault and manifest stream, and passes the validation rules in §10.

Alternative implementations are invited. A public registry of conforming implementations will accompany GVS 1.0; until then, implementers are asked to notify the editor at `hello@cachola.tech` so their implementation can be referenced in the changelog.

## 12. Internationalization

GVS is language-agnostic for note body content. The **specification** is canonical in English. **Note bodies** MAY be written in any language; the `language` frontmatter key (ISO 639-1) SHOULD be set. **Frontmatter keys, axis names, and folder names** are English and fixed — they are structural, not content.

## 13. Versioning and evolution

GVS follows Semantic Versioning. A draft carries a suffix: `0.1-draft`. Breaking changes are permitted during the `0.x` line and require a new minor version. After `1.0`:

- MAJOR version bumps introduce breaking changes (frontmatter keys removed, axis renamed).
- MINOR version bumps add optional keys, new tag namespaces, or new validation rules that permit a grace period.
- PATCH version bumps correct errata without schema impact.

Implementations MUST declare the GVS version they target in the vault's `00 Home.md` frontmatter under `gvs_version:`.

## 14. Security considerations

- **Frontmatter injection.** Tools parsing YAML frontmatter MUST use a safe loader that rejects arbitrary object construction.
- **Wikilink traversal.** Tools MUST NOT follow wikilinks outside the vault directory, even if filesystem symlinks permit it.
- **Ledger tampering.** The operating ledger is the authoritative record; audit notes are a rendering. On detected disagreement, the ledger wins and the note is marked for re-emission.
- **Classification leakage.** Tools generating public exports (e.g. published graph views) MUST filter notes by `classification` tag.

## 15. Acknowledgments and prior art

GVS draws from:

- **ADR (Architecture Decision Records)** — Michael Nygard's 2011 format, for the structure of Decision-axis notes.
- **Zettelkasten** — Niklas Luhmann, for the discipline of atomic notes and bi-directional linking.
- **W3C Design Tokens** — for the idea of a language-agnostic, machine-readable specification over a human-readable substrate.
- **RFC 2119** — for normative language.
- **Batiste six-axis governance framework** — Cachola Tech, 2026, for the top-level taxonomy.

---

## Appendix A — Minimal conforming example

A minimal vault compliant with GVS 0.1:

```
vault/
├── 00 Home.md
├── 01 Identity/
│   └── Acme Corp.md
├── 02 Policy/
│   └── Operating principles.md
├── 03 Roles/
│   └── Jane Doe — Founder.md
├── 04 Decision/
│   └── 2026-04-20 — Adopt GVS.md
├── 05 Memory/
│   └── Q2 fundraise.md
├── 06 Audit/
│   └── 2026-04-20-AC-LEG-2026-001.md
└── _templates/
    ├── 00-home.md
    ├── 01-identity.md
    ├── 02-policy.md
    ├── 03-roles.md
    ├── 04-decision.md
    ├── 05-memory.md
    └── 06-audit.md
```

With each note carrying the minimum required frontmatter for its axis.

## Appendix B — Template catalog (normative)

Every conforming vault MUST ship the following templates under `_templates/`:

| Filename | Axis | Purpose |
|---|---|---|
| `00-home.md` | (index) | Home / index template with `gvs_version:` declaration |
| `01-identity.md` | Identity | Legal entity, brand charter, founder bio |
| `02-policy.md` | Policy | Operating rule, voice/tone, permission policy |
| `03-roles.md` | Roles | Principal (human or agent) with authority |
| `04-decision.md` | Decision | Dated material decision with authority and rationale |
| `05-memory.md` | Memory | Live workstream, deal, obligation |
| `06-audit.md` | Audit | Ledger entry for a stamped artifact |

Placeholder convention: `{{placeholder_name}}`. Required placeholders are unquoted in frontmatter; optional placeholders are commented (`# optional:`). A conforming stamping tool (§11) substitutes placeholders at generation time.

## Appendix C — Changelog

| Version | Date | Changes |
|---|---|---|
| 0.1-draft | 2026-04-20 | Initial draft. Six axes, frontmatter schema, validation rules, normative templates directory. |

---

*End of specification.*

*Correspondence on this specification is welcome at `hello@cachola.tech`. Pull requests against the canonical source are reviewed under the standard editorial process.*
