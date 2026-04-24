# Apps Script — installation

Five files matter; one config file you edit; two scripts you run. Supports MyDrive and Shared Drive parents (auto-detected).

## Order of operations (90 minutes for the gestora, one time)

1. **Open Apps Script editor.** From the gestora's Drive UI: **+ New → More → Google Apps Script**.
2. **Create a new project.** Name it `Governance Vault — <agency slug>`.
3. **Paste the five files** from this folder, in this order, each as its own .gs file:
   - `00_config.gs`
   - `00a_drive_compat.gs`  *(MyDrive vs Shared Drive helpers — required v0.1.1+)*
   - `01_setup_overlay.gs`
   - `02_audit_emitter.gs`
   - `03_permissions_audit.gs`
4. **Replace the contents of `appsscript.json`** (Project Settings → "Show appsscript.json manifest in editor") with the file in this folder.
5. **Edit `00_config.gs`.** Replace every value tagged `REPLACE_WITH_…`. Save. `PARENT_FOLDER_ID` can point to a MyDrive folder, an SD folder, or an SD root — auto-detected.
6. **Run `validateConfig`** (function selector → `validateConfig` → ▶). Should print `✓ Config valid for agency: <name>`.
7. **(Recommended) Run `describeParentFolder`** to confirm topology — prints whether the parent is MyDrive or Shared Drive (and the SD name/id). Catches a wrong PARENT_FOLDER_ID before any folder is created.
8. **Approve OAuth scopes** when prompted: Drive (read/write), send_mail, scriptapp, userinfo.email. The script runs in the gestora's auth context — never escalates beyond what the gestora already has.
9. **Run `setupOverlay`.** Creates the overlay folder, six axes, IAM, templates, bootstrap audit note. Idempotent — safe to re-run.
   - **Shared Drive**: per-folder ACLs are skipped (SD membership governs); the script logs the expected member roster — provision SD members manually in Drive UI (Manage members).
   - **MyDrive**: per-folder ACLs applied (gestora=Editor, analysts=Reader, _keys/_governance=gestora-only).
10. **Run `installAuditTriggers`.** Schedules the 15-min poll. From now on, every file change in the overlay generates a ledger entry + (for deliverables) a vault audit note.
11. **Schedule a quarterly reminder** to run `runPermissionsAudit` manually. (Or wire it into `Triggers` if you prefer auto.)

## What the gestora can verify after step 9

- Open Drive → look for the overlay folder (default name `_Governanca_Obsidian`).
- Inside: six numbered folders, `_attachments/`, `_templates/`, `_governance/`, `_keys/`, `.audit/`.
- Open `00 Home.md` → should be the seeded landing note.
- Open `06 Audit/<date>-OVERLAY-SETUP.md` → should be the bootstrap note.
- Open `.audit/document-audit.jsonl` → one line, the `overlay.setup` event.

## Uninstall

If you ever need to back out:

1. Run `uninstallAuditTriggers()`.
2. Drive: optionally move `_Governanca_Obsidian/` to a personal-only folder, or delete. The estate folders outside the overlay are untouched.
3. Delete the Apps Script project.

The agency loses the audit history if it deletes the overlay folder; archive the `.audit/document-audit.jsonl` first if you want to keep the record.

## What the script never does

- Reads or writes files outside the overlay folder. (Inventory walks the parent's children read-only and writes ONE summary file inside the overlay's `_governance/`.)
- Sends data to any external service. No HTTP requests. (Trello / Asana integration is a separate opt-in module under `integrations/`.)
- Grants access to any external principal. The gestora is the sole owner of `_keys/` and `_governance/`.
- Decrypts Meld-Encrypted spans. Only the gestora's Obsidian client can do that, with the key stored in OS keychain.
