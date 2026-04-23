# Dogfooding — what runs at Cachola Tech itself

> Audit-able. The user typed `voce ta usando o batiste pra desenvolver tudo isso que tamo falando, se eu tiver uma auditoria dos nosso claims e nao ser processado pro propaganda enganosa?` — that question created this file.

The agency overlay (`apps/governance-vault/`) and Cachola Tech's own house both run **the same six-axis vault, the same manifest schema, the same audit ledger**. The storage backend differs (local laptop vs Drive-synced) and the Apps Script automation is agency-side only. Below: line-by-line, what is verifiable in Cachola Tech today, vs what is on the explicit roadmap.

---

## ✓ Verifiable today

### Six-axis vault

```
$ ls cachola_tech/obs_vault/cachola_tech/
01 Identity/   02 Policy/    03 Roles/    04 Decision/
05 Memory/     06 Audit/    _attachments/  _templates/
```

### Stamping discipline (PDFs)

`brand/stamp.py` — emits manifest sidecar + audit note + ledger line on every PDF. 200+ entries in the ledger as of 2026-04-23. Verify:

```
$ wc -l cachola_tech/.audit/document-audit.jsonl
$ ls cachola_tech/legal/radaz/*.manifest.json | head
$ ls cachola_tech/obs_vault/cachola_tech/06\ Audit/*.md | wc -l
```

### Stamping discipline (SVGs)

`brand/stamp_svg.py` — same three GVS writes for SVG assets. Created 2026-04-23 in response to the Bonita G PoC release that needed it. The SVG stamper now emits the same manifest schema as `stamp.py`, the same audit note format, and appends to the same ledger. Verify:

```
$ ls cachola_tech/releases/2026-04-22-ana-luisa-poc-v1/*.manifest.json
$ grep "cacholatech-svg" cachola_tech/.audit/document-audit.jsonl
$ ls cachola_tech/obs_vault/cachola_tech/06\ Audit/2026-04-23-CT-ANA-*
```

### End-of-day digest

`brand/eod_digest.py` — daily ritual that produces `06 Audit/YYYY-MM-DD-EOD-DIGEST.md`. The same artifact gets ledgered as evidence of self-discipline. Verify:

```
$ ls cachola_tech/obs_vault/cachola_tech/06\ Audit/*-EOD-DIGEST.md
$ tail -1 cachola_tech/.audit/document-audit.jsonl  # eod_digest entry
```

### The agency overlay app itself, in this repo

`apps/governance-vault/` lives in the Batiste monorepo. The exact same files an agency installs are versioned here. Cachola Tech does not run the Apps Script (no Drive overlay needed for a single-user firm), but the **conceptual reference** is shared. Verify:

```
$ ls batiste/apps/governance-vault/
README.md  ARCHITECTURE.md  apps_script/  obsidian/
sop/  permissions/  integrations/  manifests/  dogfooding.md  CHANGELOG.md
```

### GVS spec

`batiste/specs/gvs-0.1.md` — the standard published under CC-BY-4.0, Cachola Tech as editor. The vault layout above is a conforming implementation. Verify:

```
$ head -20 batiste/specs/gvs-0.1.md
```

---

## ✗ Not verifiable today, on roadmap

### Storage topology — Drive overlay at Cachola Tech

Cachola Tech's vault is **local** (laptop + git, no Drive sync, no Apps Script). The overlay added for Bonita G is **Drive-synced**. The discipline is identical; the storage backend is not.

This is **deliberate**: Cachola Tech is currently a single-principal firm. There is no team to share with, no analyst to scope away from, no PII beyond the founder's own. The Drive overlay solves a problem Cachola Tech does not yet have. When Cachola Tech operates with collaborators (NL hire, BR contractor, board observer), the Drive overlay will be adopted in-house.

**Honest claim:** the overlay was *built for* Bonita G; it is *applicable to* Cachola Tech but not yet *deployed in* Cachola Tech.

### Batiste runtime in the document-generation loop

Today: PDFs and SVGs are written by Claude Code (this very session) via the Write tool, then stamped by `brand/stamp.py` / `brand/stamp_svg.py`. The Batiste runtime middleware (`@batiste-aidk/scope`, `@batiste-aidk/audit`, `@batiste-aidk/auth`) is **not in the loop** — it sits beside the loop, not inside it.

Closing the loop = `apps/governance-vault` v0.2 (target 2026-05-31): every Claude Code Write tool call routes through a Batiste node that scope-validates the path against an `AccessPolicyEngine`, audit-emits before writing, and signs the manifest with the node's identity.

### Inline encryption at Cachola Tech

Cachola Tech does not run Meld Encrypt because there is no PII beyond the founder's own to protect from collaborators (because there are no collaborators yet). When a collaborator joins, Meld Encrypt is mandatory.

### C2PA on raster export

When SVGs are rasterized to PNG/JPG for Instagram upload, the SHA chain breaks at the raster step. C2PA claim embedding is on the v0.2 roadmap. Today, the raster export is unstamped.

### Sigstore / PGP signature on manifests

Manifests today are plain JSON files. Sigstore-signed manifests are on the v0.3 roadmap.

### Multi-tenant Apps Script

Today the Apps Script is per-agency. Multi-agency tenant isolation (one script project, N config namespaces) is on v0.3.

---

## How to keep this honest

Three rules:

1. **Every claim in any client-facing document MUST cite a verifiable command.** "We run on a six-axis vault" is OK if `ls cachola_tech/obs_vault/cachola_tech/` shows the six axes. Otherwise it's a stretch.
2. **Every roadmap item has a target date.** "Coming in v0.2 (2026-05-31)" is OK. "Will be added soon" is not.
3. **The dogfooding doc (this file) is updated within 7 days of any client-facing claim change.** If the README changes a claim, this file changes to back it up — or the README claim gets reverted.

The integrity check that triggered this discipline (the user's "propaganda enganosa" question) is, itself, recorded in `memory/feedback_integrity_no_bluff.md`. It is the founding event of the firm's brand promise *The firm, on the record.*
