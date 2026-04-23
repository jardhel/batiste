# Governance Vault — PII-Safe Drive Overlay

> **Batiste app · GVS 0.1 reference instance for agency-tier governance**
> Editor: Cachola Tech Ltda-ME · License: MIT · Status: v0.1.0 (2026-04-23)

A turn-key governance overlay that drops on top of an **existing** Google Drive estate without disrupting it, gives the firm a six-axis Obsidian vault, an inline-encrypted PII discipline, and an append-only audit ledger — and exposes the whole thing as the agency's saleable *AI-Governance Advisory* product.

This app is the **first end-to-end client-facing instance of the Governance Vault Specification (GVS 0.1)** outside of Cachola Tech's own internal vault. It is dogfood-grade because the same six-axis layout, the same manifest schema, and the same audit ledger shape that Cachola Tech runs on itself are what an adopting agency runs on its own house.

---

## Who this is for

The overlay was built for **boutique advertising agencies** that:

- Service corporate clients with mature compliance functions (banking, pharma, insurance, automotive, telecom).
- Use generative-AI tooling daily (Midjourney, Runway, Firefly, ChatGPT, Sora, Gemini, Claude) without a documented chain of provenance.
- Want to expand revenue with a packaged *AI-Governance Advisory* line item, billed separately from creative production.
- Already store work-in-progress on Google Drive and need a discipline that is **additive**, not migratory.

The first deployment is with **Agência Bonita G**, signed 2026-04-23 as second anchor client (pro bono in practice, treated operationally as an 8-figure engagement).

---

## What's in the box

| Path | Purpose |
|---|---|
| `ARCHITECTURE.md` | The PII-Safe-by-Design overlay — what the seven-layer stack looks like, why each layer exists |
| `apps_script/` | Google Apps Script bundle that the agency runs in its own Drive context (zero remote write by Cachola Tech) |
| `obsidian/` | Vault skeleton + Meld Encrypt setup + recommended `.obsidian/` config |
| `sop/` | Standard Operating Procedures: gestora day-to-day, analyst day-to-day, new-client onboarding, incident response, 1-page printable PII card |
| `permissions/` | Role definitions, IAM matrix, quarterly-audit playbook |
| `integrations/trello/` | Webhook connector + card template that emits audit entries on Trello card events |
| `integrations/asana/` | Webhook connector + task template that emits audit entries on Asana task events |
| `manifests/` | GVS manifest template + audit-log JSONL template |
| `dogfooding.md` | How Cachola Tech itself runs on this same overlay |
| `CHANGELOG.md` | Versioned per-release notes |

---

## Installation flow at the client

The agency-side install is **five steps, ~90 minutes** for the gestora plus ~15 minutes per analyst. The agency runs everything itself; Cachola Tech does not touch the agency's Drive directly.

1. **Inventory current Drive** — gestora answers a 7-question intake form (`sop/SOP_NOVO_CLIENTE.md` §1).
2. **Run setup Apps Script** — paste `apps_script/` files into a new Apps Script project bound to the agency's Drive root, fill in `00_config.gs`, run `setupOverlay()`. Idempotent — safe to re-run. Creates the `_governance/` overlay parallel to existing folders, never inside them.
3. **Install Obsidian + Meld Encrypt** on the gestora's machine and on each analyst's machine. Vault root = `~/Drive/Governanca_Obsidian/` (synced via Drive desktop client).
4. **Distribute the master key** to the gestora out-of-band. The plugin is configured per-machine; ciphertext is portable.
5. **First-week SOP** — gestora rotates through the four daily SOPs once each, with one assisted walk-through by Cachola Tech per Microsoft Teams (30 min, BR time).

After step 5, the agency runs the system itself and Cachola Tech moves to advisory cadence (30 min/month + on-demand incidents).

---

## Principle of Least Privilege — design constraint

The overlay was deliberately built so that **no Cachola Tech principal** ever needs:

- Edit access to the agency's Drive root.
- Read access to any folder containing client PII.
- API credentials for the agency's Trello / Asana / Slack workspace.

The agency runs Apps Script in its own context; it generates and rotates its own keys; it reads its own audit log; Cachola Tech receives only **structural metrics** (folder counts, manifest counts, audit-event counts, key-rotation timestamps) on a monthly debrief — never document content.

This is by design: the *advisory product* is the discipline, not the data. If Cachola Tech became dependent on data access to deliver value, the relationship would invert — and that would violate the firm's promise to its own brand (*The firm, on the record. Yours.*).

---

## How this relates to GVS 0.1

This app is a **conforming instance** of GVS 0.1 (Batiste/specs/gvs-0.1.md). Specifically:

- The vault skeleton (`obsidian/vault_skeleton/`) is a literal six-axis layout: `01 Identity / 02 Policy / 03 Roles / 04 Decision / 05 Memory / 06 Audit`.
- The audit log (`manifests/audit_log_template.jsonl`) implements §9 Document Stamping with the dual-hash content+file pattern.
- The Meld Encrypt PII handling extends GVS at the §4.6 *Classification* layer, adding `PII-RESTRICTED` between `INTERNAL` and `CONFIDENTIAL`.

The Trello and Asana connectors are GVS-conformant **principals** in §3 terminology, emitting ledger entries via the standard event schema.

---

## What's actually dogfood (and what isn't, yet)

**True today, verifiable in seconds:**

- **Six-axis vault** — Cachola Tech runs the same six-axis layout. Verify: `ls cachola_tech/obs_vault/cachola_tech/`.
- **Manifest schema** — every PDF Cachola Tech produces gets `.manifest.json` sidecar with the exact schema `apps_script/02_audit_emitter.gs` writes. Verify: `cat cachola_tech/legal/radaz/Anexo_A_NFSe_08_Fase0.pdf.manifest.json`.
- **Append-only ledger** — Cachola Tech writes to `cachola_tech/.audit/document-audit.jsonl`. The same path is what the agency Apps Script writes to (per agency, scoped to their Drive). Verify: `wc -l cachola_tech/.audit/document-audit.jsonl` (200+ entries as of 2026-04-23).
- **End-of-day digest** — Cachola Tech runs `brand/eod_digest.py` daily; the same discipline is embedded in this overlay's `sop/SOP_GESTORA_diario.md`. Verify: `ls cachola_tech/obs_vault/cachola_tech/06\ Audit/*-EOD-DIGEST.md`.
- **Vault audit notes** — every stamp emission triggers an automatic note in `06 Audit/`. Verify: `ls cachola_tech/obs_vault/cachola_tech/06\ Audit/2026-04-23-CT-ANA-*` (proves yesterday's Bonita G release artifacts are stamped and indexed at Cachola Tech).

**Not yet, on the explicit roadmap:**

- **Storage topology divergence** — Cachola Tech's vault is **local** (laptop + git). Bonita G's vault is **Drive-synced** (Google Drive desktop client + Obsidian). The discipline is identical; the storage backend is not. This overlay's contribution is to make the Drive-synced topology safe (overlay folder, Apps Script setup, Meld Encrypt for PII). Cachola Tech will adopt the Drive-synced topology if and when it operates with NL-based collaborators that need it; today it does not.
- **Batiste runtime in the orchestration loop** — today the documents Cachola Tech produces are written by Claude Code (via Write tool) and stamped by `brand/stamp.py` / `brand/stamp_svg.py` directly, not orchestrated through Batiste's `createNode()` chain. The output schema is identical to what a Batiste node would emit; the *generation pipeline* is not yet routed through Batiste middleware. Closing this loop is `apps/governance-vault` v0.2 (target: 2026-05).
- **Inline-encryption in the Cachola Tech vault** — Cachola Tech does not currently use Meld Encrypt because there are no PII categories beyond the founder's own. Bonita G has client PII; Meld Encrypt is mandatory there. The capability is in this overlay; it is dormant in Cachola Tech.

The single-source-of-truth invariant is enforced **forward only**: every architectural change to this overlay must be back-mergeable into Cachola Tech's vault within seven days, even if Cachola Tech does not need to adopt that change immediately. The changelog records both — what changed in the offering, and what changed in Cachola Tech's own vault.

---

## Status

- v0.1.0 · 2026-04-23 · first end-to-end client-facing release · Agência Bonita G
- Reference deployment: `cachola_tech/releases/2026-04-23-ana-luisa-vault-v1/`
- Cachola Tech canonical vault: `cachola_tech/obs_vault/cachola_tech/`
- Specification: `batiste/specs/gvs-0.1.md`

## License

MIT for the code (`apps_script/`, `integrations/`). CC-BY-4.0 for the documentation (everything else). Attribution: *Cachola Tech Ltda-ME · cachola.tech*.
