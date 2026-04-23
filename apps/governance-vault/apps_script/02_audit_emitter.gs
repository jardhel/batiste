/**
 * Cachola Tech · Governance Vault · AUDIT EMITTER
 * --------------------------------------------------
 * Drive trigger handler. Subscribes to file events under the overlay folder
 * and appends a GVS-conforming entry to the audit ledger on each event.
 *
 * Trigger setup is one-shot:
 *   1. Open Apps Script editor
 *   2. Run installAuditTriggers() once
 *   3. Approve the OAuth scope prompts (drive + script.scriptapp)
 *
 * The triggers run in the GESTORA's auth context. They never escalate beyond
 * what the gestora already has access to. They never read content of files
 * — only metadata (name, id, type, size, lastUpdated, owners list).
 */

const TRIGGER_HANDLER_NAME = "onDriveChange";
const POLL_INTERVAL_MIN = 15;     // Drive doesn't push true webhooks for personal accounts;
                                  // we poll. Tradeoff: 15-min latency, zero-dependency.

function installAuditTriggers() {
  validateConfig();
  // Remove any existing handlers
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === TRIGGER_HANDLER_NAME) {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger(TRIGGER_HANDLER_NAME)
    .timeBased()
    .everyMinutes(POLL_INTERVAL_MIN)
    .create();
  Logger.log("✓ Audit trigger installed (every " + POLL_INTERVAL_MIN + " min).");
}

function uninstallAuditTriggers() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === TRIGGER_HANDLER_NAME) {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  Logger.log("✓ Removed " + removed + " trigger(s).");
}

// ─────────────────────────────────────────────────────────────────────
// Trigger handler
// ─────────────────────────────────────────────────────────────────────

function onDriveChange() {
  const props = PropertiesService.getScriptProperties();
  const lastRunIso = props.getProperty("LAST_AUDIT_RUN") || new Date(Date.now() - 24*3600*1000).toISOString();
  const sinceMs = Date.parse(lastRunIso);

  const overlay = locateOverlay();
  if (!overlay) {
    Logger.log("⚠ Overlay not found. Run setupOverlay() first.");
    return;
  }
  const auditDir = overlay.getFoldersByName(".audit").next();

  // Walk the overlay tree. For each file with lastUpdated > lastRun, emit one ledger entry.
  const events = walkAndCollectEvents(overlay, sinceMs);
  events.forEach(ev => {
    appendLedgerLine(auditDir, ev);
    maybeEmitVaultAuditNote(overlay, ev);
  });

  // Also check for permission drift (files becoming over-shared)
  checkPermissionDrift(overlay, auditDir, sinceMs);

  props.setProperty("LAST_AUDIT_RUN", new Date().toISOString());
  Logger.log("✓ Audit pass complete. " + events.length + " event(s) recorded.");
}

function locateOverlay() {
  const parent = DriveApp.getFolderById(CONFIG.PARENT_FOLDER_ID);
  const it = parent.getFoldersByName(CONFIG.OVERLAY_FOLDER_NAME);
  return it.hasNext() ? it.next() : null;
}

function walkAndCollectEvents(folder, sinceMs) {
  const events = [];
  const stack = [folder];
  while (stack.length) {
    const f = stack.pop();
    // Skip the audit dir itself (would create infinite-loop entries)
    if (f.getName() === ".audit") continue;
    const subIt = f.getFolders();
    while (subIt.hasNext()) stack.push(subIt.next());
    const fileIt = f.getFiles();
    while (fileIt.hasNext()) {
      const file = fileIt.next();
      const updated = file.getLastUpdated().getTime();
      if (updated <= sinceMs) continue;
      events.push({
        ts: new Date(updated).toISOString(),
        event: "file.changed",
        agency_slug: CONFIG.AGENCY_SLUG,
        actor: file.getOwner() ? file.getOwner().getEmail() : "unknown",
        path: relativePath(f, folder.getId()) + "/" + file.getName(),
        file_id: file.getId(),
        mime: file.getMimeType(),
        size_bytes: file.getSize(),
        sha256: null,                       // optional; computing requires download — skipped by default
        generator: "governance-vault-apps-script-v0.1.0",
      });
    }
  }
  return events;
}

function relativePath(folder, overlayId) {
  const parts = [];
  let f = folder;
  while (f && f.getId() !== overlayId) {
    parts.unshift(f.getName());
    const parents = f.getParents();
    f = parents.hasNext() ? parents.next() : null;
  }
  return parts.join("/");
}

function appendLedgerLine(auditDir, entry) {
  const it = auditDir.getFilesByName("document-audit.jsonl");
  let f;
  if (it.hasNext()) {
    f = it.next();
    f.setContent(f.getBlob().getDataAsString() + JSON.stringify(entry) + "\n");
  } else {
    auditDir.createFile("document-audit.jsonl", JSON.stringify(entry) + "\n", MimeType.PLAIN_TEXT);
  }
}

function maybeEmitVaultAuditNote(overlay, ev) {
  // Only emit a vault audit note for files that look like deliverables —
  // .pdf, .svg, .docx, .pptx, .png, .jpg in any axis except 06 Audit itself.
  const deliverableExt = /\.(pdf|svg|docx|pptx|png|jpg|jpeg)$/i;
  if (!deliverableExt.test(ev.path)) return;
  if (ev.path.indexOf("06 Audit/") === 0) return;

  const auditAxis = overlay.getFoldersByName("06 Audit").next();
  const date = ev.ts.slice(0, 10);
  const refSlug = ev.path.replace(/[\/\s]+/g, "_").replace(/\.[a-z0-9]+$/i, "").toUpperCase();
  const fname = date + "-" + refSlug + ".md";
  if (auditAxis.getFilesByName(fname).hasNext()) return;

  const body = [
    "---",
    `title: "${ev.path}"`,
    "axis: audit",
    `updated: ${date}`,
    "status: active",
    `event: "${ev.event}"`,
    `actor: "${ev.actor}"`,
    `file_id: "${ev.file_id}"`,
    `path: "${ev.path}"`,
    `mime: "${ev.mime}"`,
    "tags: [axis/audit, event/file.changed]",
    "---",
    "",
    "# " + ev.path,
    "",
    "> Auto-emitted by `02_audit_emitter.gs` on detected file change.",
    "",
    "- **Path:** `" + ev.path + "`",
    "- **MIME:** `" + ev.mime + "`",
    "- **Size:** " + ev.size_bytes + " bytes",
    "- **Last actor:** `" + ev.actor + "`",
    "- **Detected at:** " + ev.ts,
    "",
    "Re-verify in the ledger:",
    "",
    "```",
    "grep '" + ev.file_id + "' .audit/document-audit.jsonl",
    "```",
    ""
  ].join("\n");

  auditAxis.createFile(fname, body, MimeType.PLAIN_TEXT);
}

function checkPermissionDrift(overlay, auditDir, sinceMs) {
  // Walk the overlay; flag files shared with anyone outside the allowlist.
  const allowlist = [CONFIG.GESTORA_EMAIL]
    .concat(CONFIG.ANALYST_EMAILS)
    .concat(CONFIG.DESIGNER_EMAILS)
    .concat(CONFIG.EXTERNAL_COLLABORATORS);

  const violations = [];
  const stack = [overlay];
  while (stack.length) {
    const f = stack.pop();
    if (f.getName() === ".audit") continue;
    const subIt = f.getFolders();
    while (subIt.hasNext()) stack.push(subIt.next());
    const viewers = f.getViewers().concat(f.getEditors());
    viewers.forEach(u => {
      const email = u.getEmail();
      if (!allowlist.includes(email) && email !== Session.getActiveUser().getEmail()) {
        violations.push({
          ts: new Date().toISOString(),
          event: "permission.drift",
          path: f.getName(),
          unauthorized_principal: email,
          severity: "high",
        });
      }
    });
  }

  if (violations.length) {
    violations.forEach(v => appendLedgerLine(auditDir, v));
    MailApp.sendEmail({
      to: CONFIG.GESTORA_EMAIL,
      subject: "[Governance Vault] " + violations.length + " permission drift(s) detected",
      body: violations.map(v => v.path + " → " + v.unauthorized_principal).join("\n"),
    });
  }
}
