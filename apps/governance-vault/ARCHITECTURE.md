# Architecture — PII-Safe-by-Design Drive Overlay

> **Reference deployment:** Agência Bonita G · 2026-04-23
> **Specification basis:** GVS 0.1 + Cachola Tech RLS extension (draft, see `batiste/docs/adr/ADR-0001-rls.md`)

---

## 0. The single sentence

The overlay is a **non-destructive seven-layer envelope** that wraps the agency's existing Google Drive estate, intercepts every PII-bearing write at authoring time, and produces a vault that is simultaneously a knowledge graph (Obsidian) and an audit ledger (`.audit/`).

---

## 1. Constraints that shaped the design

1. **Non-destructive.** The agency's existing folders, naming conventions, sharing rules, and operational habits MUST stay intact. Adoption cannot require migration.
2. **Principle of Least Privilege.** No external principal (Cachola Tech included) gets edit access to the agency's Drive root. Apps Script runs in the agency's Workspace context with the gestora's own permissions.
3. **PII-Safe-by-Design.** PII-bearing notes MUST be encrypted at rest with a key the gestora controls; analysts who sync the file see ciphertext only.
4. **Verifiable provenance.** Every artifact emitted under the overlay MUST be hashable, ledger-recorded, and have a vault audit note. No write without a manifest.
5. **Storage-agnostic discipline.** The same six-axis layout, the same manifest schema, the same audit-log shape MUST work on local disk (Cachola Tech today) and on Drive-synced disk (Bonita G today). The storage backend is implementation detail; the discipline is invariant.
6. **Templatizable.** A second agency must be onboardable in <90 minutes by changing only the values in `apps_script/00_config.gs` — no code edits.

---

## 2. The seven layers (top-down)

```
┌─────────────────────────────────────────────────────────────────┐
│ Layer 7 · Advisory product            (sold by Bonita G to client X) │
├─────────────────────────────────────────────────────────────────┤
│ Layer 6 · Operational SOPs           (sop/  daily rituals)         │
├─────────────────────────────────────────────────────────────────┤
│ Layer 5 · Knowledge graph            (Obsidian vault, six axes)    │
├─────────────────────────────────────────────────────────────────┤
│ Layer 4 · Inline encryption          (Meld Encrypt over PII spans) │
├─────────────────────────────────────────────────────────────────┤
│ Layer 3 · Audit ledger               (.audit/document-audit.jsonl) │
├─────────────────────────────────────────────────────────────────┤
│ Layer 2 · IAM overlay                (Apps Script + Drive ACLs)    │
├─────────────────────────────────────────────────────────────────┤
│ Layer 1 · Existing Drive estate      (untouched, non-destructive)  │
└─────────────────────────────────────────────────────────────────┘
```

### 1 · Existing Drive estate

The agency's pre-existing `Clientes/`, `Campanhas/`, `Producao/`, etc. The overlay never moves, renames, or deletes anything here. The setup script catalogs what exists into a read-only manifest (`_governance/inventory_YYYY-MM-DD.json`) for reference.

### 2 · IAM overlay

A new sibling folder `_Governanca_Obsidian/` (configurable name) is created at the same parent as the existing roots. Permissions:

| Folder | Gestora | Analyst | Designer | External (client / Cachola Tech) |
|---|---|---|---|---|
| Existing estate | (as-is) | (as-is) | (as-is) | (as-is) |
| `_Governanca_Obsidian/` | Editor | Reader | Reader | **Sem acesso** |
| `_Governanca_Obsidian/06 Audit/` | Editor | Reader (audit-only) | — | — |
| `_Governanca_Obsidian/_keys/` | Editor (sole) | — | — | — |
| `_Governanca_Obsidian/_governance/` | Editor (sole) | — | — | — |

The `_keys/` folder holds **passphrase hints only** (never raw key material). Raw Meld Encrypt master keys live on the gestora's machine in OS keychain (macOS Keychain / Windows Credential Manager / Linux Secret Service).

### 3 · Audit ledger

Append-only JSONL at `_Governanca_Obsidian/.audit/document-audit.jsonl`. Schema is the GVS 0.1 §9 schema (one event per line). Apps Script `02_audit_emitter.gs` writes to it on every Drive event the script subscribes to (file create / update / move / share-change). The same schema is what `brand/stamp.py` and `brand/stamp_svg.py` write at Cachola Tech.

The ledger is **immutable** by social and technical contract: the file is owned by the gestora; analysts have read access; the Apps Script is the only authorized writer; tampering is detected on the next quarterly audit (`permissions/audit_quarterly.md`).

### 4 · Inline encryption (Meld Encrypt)

For notes that contain PII (names, emails, contracts, fees, brief content from named clients), the gestora wraps the sensitive span:

```markdown
Cliente: %%🔐α [base64 ciphertext written by Meld Encrypt] α🔐%%
Brief:   %%🔐α [base64 ciphertext] α🔐%%
```

Analysts who sync the file see the markers but not the cleartext. The gestora reads the cleartext on her own machine where the key is configured. The ciphertext is portable — it survives Drive sync round-trips, git commits, copy-paste.

Convention: PII-bearing notes carry frontmatter `classification: PII-RESTRICTED`. The Apps Script audit emitter flags any file at this level that becomes shared beyond the explicit allowlist.

### 5 · Knowledge graph (Obsidian)

Vault root = `_Governanca_Obsidian/`. Six axes per GVS 0.1 §5:

```
01 Identity/    — agency identity, brand, partners
02 Policy/      — AI usage policy, PII handling policy, comms policies
03 Roles/       — gestora, analystas, designers, external collaborators
04 Decision/    — campaign decisions, contract decisions, vendor decisions
05 Memory/      — per-client workstreams, per-campaign live state
06 Audit/       — automated audit notes (one per stamped artifact)
_attachments/   — binary assets
_templates/     — note templates per axis (REQUIRED for GVS conformance)
_keys/          — passphrase hints (never raw keys)
.audit/         — JSONL ledger (hidden from Obsidian indexer)
```

### 6 · Operational SOPs

Five SOPs codify the daily and event-driven rituals:

- `SOP_GESTORA_diario.md` — gestora's day (10 minutes morning + 5 minutes EOD)
- `SOP_ANALISTA_diario.md` — analyst's day (5 minutes morning ritual)
- `SOP_NOVO_CLIENTE.md` — adding a new client into the vault
- `SOP_INCIDENTE.md` — what to do on suspected leak / over-share / key loss
- `SOP_PII_DAILY_card.md` — printable 1-page card for the gestora's desk

### 7 · Advisory product

The overlay is the substrate that lets Bonita G **sell** *AI-Governance Advisory* to its corporate clients as a separately-priced line item. The pitch to a client of Bonita G is: *"every deliverable ships with a verifiable manifest and an audit trail your compliance can read in 60 seconds."* The technical substance behind the pitch is layers 2-6.

---

## 3. Trello / Asana integration (Layer 6.5)

Both connectors live in `integrations/<tool>/` and operate by **webhook**:

```
Trello card created/updated  ─┐
                              │
Asana task created/updated   ─┼──> Apps Script webhook handler
                              │       │
                              │       ▼
                              │    classify event → emit ledger entry
                              │       │
                              │       ▼
                              │    (if PII flag) → encrypted note in 05 Memory/
                              │       │
                              │       ▼
                              │    audit note in 06 Audit/
                              │
Slack channel post (future) ──┘
```

The handlers do **not** ingest payload bodies into the ledger by default — only metadata (board id, card id, action type, actor, timestamp). PII flowing through the task tools requires the gestora to explicitly tag a card/task with the `gvs-pii` label, at which point the handler routes the title to an encrypted memory note.

Integration economics (token budget, cache hit projections) is documented in `integrations/TOKEN_ECONOMICS.md`.

---

## 4. Threat model (abbreviated)

| Threat | Mitigation |
|---|---|
| Analyst goes rogue, copies all client PII off Drive | Files at `PII-RESTRICTED` are ciphertext to the analyst — she copies opaque blobs; cleartext stays with the gestora |
| Gestora's laptop is stolen | Master key lives in OS keychain protected by login password + (recommended) FileVault/BitLocker; ciphertext on Drive is unreadable without that key |
| Drive sharing accidentally goes "anyone with link" | `03_permissions_audit.gs` runs weekly, flags any file in `_Governanca_Obsidian/` that is shared beyond the allowlist; gestora gets email + ledger entry |
| Client compliance asks "prove this campaign asset is what you delivered" | `manifest.json` + ledger entry + audit note all reconcile to the artifact's SHA-256; reproducible in 60 seconds (per `04_prova_dogfooding_verificavel.md` of the Cachola Tech POC release) |
| Cachola Tech (overlay vendor) becomes adversarial | Cachola Tech has zero edit access to the agency Drive; revoking the `Apps Script` deployment is a one-click operation by the gestora; the artifacts and audit history remain in the agency's possession |
| Apps Script project is tampered with by an internal actor | The script source lives in the agency's Workspace; deployment versioning is on by default; the audit-emitter is read by quarterly review (`permissions/audit_quarterly.md`) |
| Meld Encrypt master key is lost | Recovery is via the gestora's pre-distributed split-key (3-of-5 Shamir, see `obsidian/meld_encrypt_setup.md` §6); without recovery, ciphertext is permanently inaccessible — design choice (no backdoor) |

---

## 5. What this is **not**

- **Not a DLP product.** The overlay does not scan for PII; the gestora classifies. False negatives are possible if the gestora forgets to tag.
- **Not a key management service.** Master keys are local. Recovery is social (Shamir). Enterprise-grade KMS is a v2 question.
- **Not a Workspace replacement.** Existing Drive, Gmail, Calendar, Meet stay as-is.
- **Not a CMS.** Notes are markdown files. The overlay does not own publication.
- **Not magic.** It works because the gestora runs the daily SOPs. If she stops, the audit trail decays in days, not months.

---

## 6. Conformance to GVS 0.1

This overlay is a **conforming implementation** of GVS 0.1:

- §5 (six axes): satisfied — vault root has the six numbered axes.
- §7 (manifest schema): satisfied — manifests emitted by Apps Script are byte-identical in shape to those emitted by Cachola Tech's `brand/stamp.py`.
- §9 (three writes): satisfied — manifest sidecar, vault audit note, ledger append, all atomic per emission.
- §10 (validation): satisfied — `apps_script/03_permissions_audit.gs` runs the GVS validation rules weekly.

Extension over GVS 0.1: the `PII-RESTRICTED` classification label and the inline-encryption convention are documented in `batiste/docs/adr/ADR-0002-pii-restricted-classification.md` and proposed for incorporation into GVS 0.2.

---

## 7. Roadmap

| Version | Target | Scope |
|---|---|---|
| **v0.1** (this) | 2026-04-23 | Single-agency deployment, Apps Script setup, Obsidian + Meld Encrypt, SOPs, Trello/Asana metadata-only integration, manual quarterly permissions audit |
| **v0.2** | 2026-05-31 | Batiste runtime in the loop (createNode wraps every emission), automatic permissions audit (weekly cron), C2PA claim on raster export, RLS primitives from `@batiste-aidk/rls` |
| **v0.3** | 2026-06-30 | Multi-tenant onboarding (one config per agency, shared script base), Sigstore-signed manifests, Slack connector, Notion connector |
| **v1.0** | 2026-09-30 | Self-service install (no Cachola Tech assistance required), GVS 0.2 ratified, advisory product packaging templates |
