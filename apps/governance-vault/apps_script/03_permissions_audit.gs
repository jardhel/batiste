/**
 * Cachola Tech · Governance Vault · QUARTERLY PERMISSIONS AUDIT
 * --------------------------------------------------
 * Run manually from the Apps Script editor every 90 days, or on-demand
 * before any client compliance review. Produces:
 *   - 06 Audit/YYYY-MM-DD-PERMISSIONS-AUDIT.md  (vault note)
 *   - .audit/document-audit.jsonl                (ledger entry per finding)
 *   - email to gestora summarizing severity counts
 */

function runPermissionsAudit() {
  validateConfig();
  const overlay = locateOverlay();
  if (!overlay) throw new Error("Overlay not found.");

  const findings = [];
  const allowlist = [CONFIG.GESTORA_EMAIL]
    .concat(CONFIG.ANALYST_EMAILS)
    .concat(CONFIG.DESIGNER_EMAILS)
    .concat(CONFIG.EXTERNAL_COLLABORATORS);

  // Walk every folder in the overlay
  const stack = [overlay];
  while (stack.length) {
    const f = stack.pop();
    const subIt = f.getFolders();
    while (subIt.hasNext()) stack.push(subIt.next());

    const editors = f.getEditors().map(u => u.getEmail());
    const viewers = f.getViewers().map(u => u.getEmail());

    // Rule 1: _keys/, _governance/ → only gestora
    if (f.getName() === CONFIG.KEYS_HINT_DIR || f.getName() === CONFIG.GOVERNANCE_DIR) {
      const unauthorized = editors.concat(viewers).filter(e => e !== CONFIG.GESTORA_EMAIL);
      unauthorized.forEach(u => findings.push({
        severity: "critical",
        rule: "R1-gestora-only",
        folder: f.getName(),
        principal: u
      }));
    }

    // Rule 2: any folder shared with someone outside the allowlist
    editors.concat(viewers).forEach(u => {
      if (!allowlist.includes(u)) {
        findings.push({ severity: "high", rule: "R2-allowlist", folder: f.getName(), principal: u });
      }
    });

    // Rule 3: any folder with public sharing
    if (f.getSharingAccess() !== DriveApp.Access.PRIVATE) {
      findings.push({ severity: "critical", rule: "R3-no-public", folder: f.getName(), access: String(f.getSharingAccess()) });
    }
  }

  // Walk files inside 06 Audit + 05 Memory for PII-RESTRICTED label drift
  const memoryAxis = overlay.getFoldersByName("05 Memory").next();
  const piiViolations = checkPiiClassification(memoryAxis);
  findings.push.apply(findings, piiViolations);

  // Emit vault note
  const date = new Date().toISOString().slice(0, 10);
  const noteName = date + "-PERMISSIONS-AUDIT.md";
  const auditAxis = overlay.getFoldersByName("06 Audit").next();
  const note = renderAuditReport(date, findings);
  if (auditAxis.getFilesByName(noteName).hasNext()) {
    auditAxis.getFilesByName(noteName).next().setContent(note);
  } else {
    auditAxis.createFile(noteName, note, MimeType.PLAIN_TEXT);
  }

  // Emit ledger entries
  const auditDir = overlay.getFoldersByName(".audit").next();
  findings.forEach(f => appendLedgerLine(auditDir, Object.assign({
    ts: new Date().toISOString(),
    event: "audit.finding",
    agency_slug: CONFIG.AGENCY_SLUG,
    generator: "governance-vault-apps-script-v0.1.0",
  }, f)));

  // Email gestora
  const counts = findings.reduce((acc, f) => {
    acc[f.severity] = (acc[f.severity] || 0) + 1;
    return acc;
  }, {});
  MailApp.sendEmail({
    to: CONFIG.GESTORA_EMAIL,
    subject: "[Governance Vault] Permissions audit — " + date,
    body: "Audit complete. Findings:\n" +
          Object.keys(counts).map(k => "  " + k + ": " + counts[k]).join("\n") +
          "\n\nSee vault: 06 Audit/" + noteName
  });
  Logger.log("✓ Audit done. " + findings.length + " finding(s).");
  return findings;
}

function checkPiiClassification(memoryAxis) {
  // PII memory notes should carry "classification: PII-RESTRICTED" in frontmatter
  // AND should contain a Meld Encrypt span (%%🔐α ... α🔐%%).
  // Otherwise: the note is either over-disclosed (PII without encryption)
  // or mis-labeled (non-PII mistakenly tagged).
  const violations = [];
  const fileIt = memoryAxis.getFiles();
  while (fileIt.hasNext()) {
    const f = fileIt.next();
    if (f.getMimeType() !== MimeType.PLAIN_TEXT) continue;
    if (!f.getName().endsWith(".md")) continue;
    const body = f.getBlob().getDataAsString();
    const isLabeled = /classification:\s*PII-RESTRICTED/.test(body);
    const hasCipher = /%%🔐α[\s\S]+?α🔐%%/.test(body);
    if (isLabeled && !hasCipher) {
      violations.push({
        severity: "critical",
        rule: "R4-labeled-but-cleartext",
        file: f.getName()
      });
    }
    // Heuristic: cleartext CPF / CNPJ / email patterns in non-labeled files
    const looksLikePii = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/.test(body);
    if (!isLabeled && looksLikePii) {
      violations.push({
        severity: "high",
        rule: "R5-unlabeled-pii-pattern",
        file: f.getName()
      });
    }
  }
  return violations;
}

function renderAuditReport(date, findings) {
  const grouped = findings.reduce((acc, f) => {
    (acc[f.severity] = acc[f.severity] || []).push(f);
    return acc;
  }, {});
  const out = [
    "---",
    `title: "Permissions Audit — ${date}"`,
    "axis: audit",
    `updated: ${date}`,
    "status: active",
    'event: "audit.permissions"',
    "tags: [axis/audit, event/audit.permissions]",
    "---",
    "",
    `# Permissions Audit — ${date}`,
    "",
    "Auto-emitted by `03_permissions_audit.gs`. Quarterly cadence; on-demand for compliance reviews.",
    "",
    `**Total findings:** ${findings.length}`,
    "",
  ];
  ["critical", "high", "medium", "low"].forEach(sev => {
    if (!grouped[sev]) return;
    out.push(`## ${sev.toUpperCase()} (${grouped[sev].length})`);
    out.push("");
    grouped[sev].forEach(f => {
      const detail = f.folder ? `\`${f.folder}\``
                  : f.file   ? `\`${f.file}\``
                  : "—";
      out.push(`- **${f.rule}** · ${detail}` + (f.principal ? ` · principal=\`${f.principal}\`` : "") + (f.access ? ` · access=\`${f.access}\`` : ""));
    });
    out.push("");
  });
  return out.join("\n");
}
