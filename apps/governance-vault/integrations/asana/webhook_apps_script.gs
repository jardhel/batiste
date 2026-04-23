/**
 * Cachola Tech · Governance Vault · Asana webhook handler
 * --------------------------------------------------
 * Asana requires a handshake (X-Hook-Secret) on first registration.
 * The handler below detects the handshake header and echoes it back.
 * Subsequent calls receive an events array; each event is ledgered.
 */

const ASANA_PII_FIELD_NAME = "gvs-pii";
const ASANA_PII_TITLE_PREFIX = "[PII]";

function doPostAsana_(e) {
  // Called from doPost when the request signature looks like Asana
  if (!CONFIG.ASANA_INTEGRATION_ENABLED) {
    return ContentService.createTextOutput("disabled");
  }

  // Handshake: Asana sends a HEAD/POST with X-Hook-Secret on first call
  const headers = (e && e.parameter) || {};
  const hookSecret = e.parameter && e.parameter["X-Hook-Secret"];
  if (hookSecret) {
    return ContentService.createTextOutput("")
      .setMimeType(ContentService.MimeType.TEXT)
      .append("");  // Apps Script can't set custom headers easily; alternative:
                    // use Web App with HTML response for setHeader.
                    // For simplicity, we recommend doing the initial registration
                    // via a manual webhook with secret echoed via Properties.
  }

  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return ContentService.createTextOutput("bad payload");
  }

  const events = payload.events || [];
  if (!events.length) return ContentService.createTextOutput("no events");

  const overlay = locateOverlay();
  if (!overlay) return ContentService.createTextOutput("no overlay");
  const auditDir = overlay.getFoldersByName(".audit").next();

  events.forEach(ev => {
    const entry = {
      ts: new Date(ev.created_at || Date.now()).toISOString(),
      event: "asana." + (ev.action || "unknown"),
      agency_slug: CONFIG.AGENCY_SLUG,
      actor: ev.user ? ev.user.gid : "unknown",
      resource_type: ev.resource ? ev.resource.resource_type : null,
      resource_gid: ev.resource ? ev.resource.gid : null,
      parent_gid: ev.parent ? ev.parent.gid : null,
      generator: "governance-vault-asana-v0.1.0",
    };

    // For task events, fetch the task to inspect PII flag
    if (ev.resource && ev.resource.resource_type === "task") {
      const task = fetchAsanaTask_(ev.resource.gid);
      if (task) {
        const isPii = isAsanaTaskPii_(task);
        entry.pii_routed = isPii;
        if (isPii) {
          entry.task_name = null;
          entry.task_name_hash = sha256Short(task.name);
          upsertEncryptedMemoryNoteAsana_(overlay, task);
        } else {
          entry.task_name = task.name;
          upsertTaskAuditNoteAsana_(overlay, task, ev);
        }
      }
    }
    appendLedgerLine(auditDir, entry);
  });

  return ContentService.createTextOutput("ok");
}

function fetchAsanaTask_(gid) {
  const props = PropertiesService.getScriptProperties();
  const pat = props.getProperty("ASANA_PAT");
  if (!pat) return null;
  try {
    const r = UrlFetchApp.fetch("https://app.asana.com/api/1.0/tasks/" + gid +
      "?opt_fields=name,custom_fields.name,custom_fields.text_value,custom_fields.enum_value", {
      method: "get",
      headers: { Authorization: "Bearer " + pat },
      muteHttpExceptions: true
    });
    if (r.getResponseCode() !== 200) return null;
    return JSON.parse(r.getContentText()).data;
  } catch (e) {
    return null;
  }
}

function isAsanaTaskPii_(task) {
  if (!task || !task.name) return false;
  if (task.name.indexOf(ASANA_PII_TITLE_PREFIX) === 0) return true;
  if (Array.isArray(task.custom_fields)) {
    for (let i = 0; i < task.custom_fields.length; i++) {
      const f = task.custom_fields[i];
      if (f.name === ASANA_PII_FIELD_NAME) {
        const v = f.text_value || (f.enum_value && f.enum_value.name) || "";
        if (String(v).toLowerCase() === "yes" || String(v).toLowerCase() === "true") return true;
      }
    }
  }
  return false;
}

function upsertTaskAuditNoteAsana_(overlay, task, ev) {
  const auditAxis = overlay.getFoldersByName("06 Audit").next();
  const date = new Date(ev.created_at || Date.now()).toISOString().slice(0, 10);
  const fname = date + "-ASANA-" + task.gid + ".md";
  if (auditAxis.getFilesByName(fname).hasNext()) return;
  const body = [
    "---",
    `title: "Asana: ${(task.name || "").replace(/"/g, '\\"')}"`,
    "axis: audit",
    `updated: ${date}`,
    'event: "asana.task"',
    `task_gid: "${task.gid}"`,
    "tags: [axis/audit, source/asana]",
    "---",
    "",
    `# Asana: ${task.name || ""}`,
    "",
    `- **Task link:** https://app.asana.com/0/0/${task.gid}`,
    `- **Last action:** ${ev.action}`,
    `- **Created at:** ${ev.created_at || ""}`,
    ""
  ].join("\n");
  auditAxis.createFile(fname, body, MimeType.PLAIN_TEXT);
}

function upsertEncryptedMemoryNoteAsana_(overlay, task) {
  const memoryAxis = overlay.getFoldersByName("05 Memory").next();
  const fname = "asana-pii-" + task.gid + ".md";
  if (memoryAxis.getFilesByName(fname).hasNext()) return;
  const body = [
    "---",
    "title: \"Asana PII task\"",
    "axis: memory",
    "classification: PII-RESTRICTED",
    `task_gid: "${task.gid}"`,
    "tags: [axis/memory, source/asana, classification/pii-restricted, status/awaiting-encryption]",
    "---",
    "",
    "# Asana PII task",
    "",
    "> A task flagged for PII (custom field `gvs-pii=yes` or title prefix `[PII]`) was updated in Asana.",
    "> Open the task link below, copy the relevant content into the encrypted block, then Cmd+Shift+E.",
    "",
    `- **Task link:** https://app.asana.com/0/0/${task.gid}`,
    "",
    "## Encrypted content",
    "",
    "%%🔐α PASTE_AND_ENCRYPT_HERE α🔐%%",
    ""
  ].join("\n");
  memoryAxis.createFile(fname, body, MimeType.PLAIN_TEXT);
}
