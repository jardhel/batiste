# Changelog — apps/governance-vault

## v0.1.1 — 2026-04-24

**Sev0 fix: Shared Drive support.** v0.1.0 silently assumed MyDrive topology. The Bonita G deploy revealed that agencies organize client work in Shared Drives, where per-folder ACLs (`setSharing`, `addViewer`, `addEditor`) are non-applicable — SD membership governs access. This release adds full SD-aware execution.

### Added

- `apps_script/00a_drive_compat.gs` — MyDrive vs Shared Drive compatibility layer:
  - `isSharedDriveFolder(id)` — true if folder lives in any SD
  - `getSharedDriveId(id)` — returns SD id or null
  - `findOrCreateChildCompat(parent, name)` — uses Advanced Drive Service in SD (DriveApp.createFolder is unreliable at SD root)
  - `listAllPermissions(id)` — returns SD members + file-level ACL via Advanced Drive Service in SD; falls back to DriveApp viewers/editors in MyDrive
  - `describeParentFolder()` — diagnostic to print PARENT_FOLDER_ID topology before setupOverlay

### Changed

- `apps_script/01_setup_overlay.gs` —
  - `setupOverlay()` now logs detected topology (SD or MyDrive) and SD id
  - `applyOverlayPermissions / applyGestoraOnlyPermissions / applyAuditPermissions` branch on SD: log expected member roster instead of calling MyDrive-only APIs
  - `findOrCreateChild` removed; all callers use `findOrCreateChildCompat`
  - `writeBootstrapAuditNote()` records `topology` + `shared_drive_id` in frontmatter and adapts the next-step prose
- `apps_script/02_audit_emitter.gs` — `checkPermissionDrift` uses `listAllPermissions`; drift entries now include `role` + `source` ('member' for SD vs 'file' for per-folder ACL)
- `apps_script/03_permissions_audit.gs` — same SD-aware permission walk; R3 (no-public) skipped in SD where folder-level link sharing doesn't apply

### Migration notes

- Existing v0.1.0 installs (Cachola Tech internal MyDrive vault, hypothetical) require no changes — branches preserve original behavior.
- New installs targeting Shared Drives: SD members must be configured in Drive UI (Manage members) — the script logs the expected roster but does not provision SD memberships, since cross-domain SD membership management requires Workspace admin scope this script does not request.

### Audit trail

- This release was triggered by an anchor-client deploy attempt 2026-04-24 hitting `setupOverlay` failure when `PARENT_FOLDER_ID` resolved to a Shared Drive root. Bug classification: sev0 (target-platform mismatch, not a corner-case).

---

## v0.1.0 — 2026-04-23

**First end-to-end client-facing release.** Reference deployment: Agência Bonita G (second anchor client, pro bono in practice, calibrated as 8-figure deliverable).

### Added

- `README.md` — what the overlay is, who it's for, what's in the box, install flow
- `ARCHITECTURE.md` — seven-layer PII-Safe-by-Design design + threat model + GVS conformance + roadmap to v1.0
- `apps_script/` — four .gs files + appsscript.json + README:
  - `00_config.gs` (the only file installer edits) with `validateConfig()`
  - `01_setup_overlay.gs` — idempotent setup, six axes + IAM + bootstrap audit
  - `02_audit_emitter.gs` — 15-min poll, file-change detection, permission drift, vault audit notes
  - `03_permissions_audit.gs` — quarterly audit + email digest
- `obsidian/` — meld_encrypt_setup.md (gestora + analyst paths) + vault skeleton folders
- `sop/` — five SOPs:
  - `SOP_GESTORA_diario.md` — 15 min/day
  - `SOP_ANALISTA_diario.md` — 5 min/day
  - `SOP_NOVO_CLIENTE.md` — onboarding ~25 min
  - `SOP_INCIDENTE.md` — incident playbook (six categories)
  - `SOP_PII_DAILY_card.md` — printable monitor card
- `permissions/permissions_matrix.md` — IAM matrix + change procedure + onboarding/offboarding
- `integrations/`:
  - `README.md` — overall integration philosophy
  - `trello/` — README + webhook_apps_script.gs (metadata-only by default, PII routing via `gvs-pii` label)
  - `asana/` — README + webhook_apps_script.gs (metadata-only, PII via custom field or `[PII]` prefix)
  - `TOKEN_ECONOMICS.md` — unit economics: ~$96/year cost vs ~$5,840-$7,760/year savings
- `dogfooding.md` — line-by-line audit of what's verifiable today vs roadmap

### Cachola Tech-side changes (sibling repo)

- `brand/stamp_svg.py` — SVG sibling of `stamp.py`, same three GVS writes
- `brand/eod_digest.py` — daily end-of-day digest (auto-emits to `06 Audit/<date>-EOD-DIGEST.md`)
- Retroactively stamped 2 SVG releases (2026-04-22 Ana Luisa POC) → 2 audit notes + 2 ledger entries

### Roadmap committed

- v0.2 (2026-05-31): Batiste runtime in the document-generation loop · automatic permissions audit (cron) · C2PA claim on raster export · `@batiste-aidk/rls` package usable
- v0.3 (2026-06-30): Multi-tenant onboarding · Sigstore-signed manifests · Slack & Notion connectors
- v1.0 (2026-09-30): Self-service install · GVS 0.2 ratified · advisory product packaging templates

### Known limitations

- Inline encryption depends on the gestora running the daily SOP. Without SOP, the audit trail decays in days.
- Apps Script polling is 15-min granular (true webhooks not available for personal Drive accounts; Workspace allows webhook subscription, planned for v0.2).
- Asana webhook handshake (X-Hook-Secret) requires manual initial registration step — current Apps Script handler simplifies but does not fully automate.
- Master key recovery is social (Shamir 3-of-5). No KMS escrow. Recovery failure means permanent ciphertext loss — this is a deliberate design choice, not a bug.
