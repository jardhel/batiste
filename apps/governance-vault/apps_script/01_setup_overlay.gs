/**
 * Cachola Tech · Governance Vault · SETUP
 * --------------------------------------------------
 * Idempotent one-shot setup. Re-running has no effect except logging.
 *
 * What it does:
 *   1. Validates CONFIG.
 *   2. Locates PARENT_FOLDER by ID (read-only check it exists).
 *   3. Creates OVERLAY_FOLDER_NAME under PARENT (skips if already there).
 *   4. Creates the GVS six-axis subtree + _attachments + _templates + _governance + _keys + .audit.
 *   5. Applies the IAM matrix (gestora=Editor on overlay; analysts=Reader; designers=Reader; _keys/_governance=gestora-only).
 *   6. (Optional) Runs read-only inventory of the existing estate.
 *   7. Writes the bootstrap audit note + ledger entry recording the setup itself.
 *
 * What it does NOT do:
 *   - Touch any folder OUTSIDE the overlay.
 *   - Move, rename, or delete anything in the existing estate.
 *   - Grant access to any external principal (Cachola Tech included).
 */

const SIX_AXES = [
  "01 Identity",
  "02 Policy",
  "03 Roles",
  "04 Decision",
  "05 Memory",
  "06 Audit"
];

const SUBSYSTEM_DIRS = [
  "_attachments",
  "_templates",
  // _governance, _keys, .audit handled separately (gestora-only ACLs)
];

function setupOverlay() {
  validateConfig();

  const parent = DriveApp.getFolderById(CONFIG.PARENT_FOLDER_ID);
  const inSD = isSharedDriveFolder(CONFIG.PARENT_FOLDER_ID);
  const sdId = inSD ? getSharedDriveId(CONFIG.PARENT_FOLDER_ID) : null;
  Logger.log("✓ Parent folder located: " + parent.getName() +
             (inSD ? " (Shared Drive: " + sdId + ")" : " (MyDrive)"));

  // 1. Find or create the overlay folder
  const overlay = findOrCreateChildCompat(parent, CONFIG.OVERLAY_FOLDER_NAME);
  Logger.log("✓ Overlay folder ready: " + overlay.getName());

  // 2. Six-axis subtree
  SIX_AXES.forEach(axis => findOrCreateChildCompat(overlay, axis));
  Logger.log("✓ Six axes ready");

  // 3. Public-to-team subsystems
  SUBSYSTEM_DIRS.forEach(d => findOrCreateChildCompat(overlay, d));

  // 4. Gestora-only subsystems
  const governance = findOrCreateChildCompat(overlay, CONFIG.GOVERNANCE_DIR);
  const keysHints = findOrCreateChildCompat(overlay, CONFIG.KEYS_HINT_DIR);
  // .audit is a special case — Drive doesn't support hidden folders, but the
  // leading dot in the name still hides it from Obsidian's indexer when the
  // vault is opened locally.
  const auditDir = findOrCreateChildCompat(overlay, ".audit");

  // 5. Apply IAM (branches MyDrive vs Shared Drive)
  applyOverlayPermissions(overlay);
  applyGestoraOnlyPermissions(governance);
  applyGestoraOnlyPermissions(keysHints);
  applyAuditPermissions(auditDir);
  Logger.log("✓ Permissions applied");

  // 6. Seed templates and Home.md if missing
  seedTemplatesAndHome(overlay);

  // 7. Inventory (optional)
  if (CONFIG.RUN_INVENTORY_ON_SETUP) {
    runInventory(parent, governance);
  }

  // 8. Bootstrap audit entry
  writeBootstrapAuditNote(overlay);
  appendLedgerEntry(overlay, {
    event: "overlay.setup",
    actor: Session.getActiveUser().getEmail(),
    overlay_id: overlay.getId(),
    overlay_name: overlay.getName(),
    parent_id: parent.getId(),
    note: "Initial setup completed. See bootstrap audit note in 06 Audit/."
  });

  Logger.log("════════════════════════════════════════");
  Logger.log("✓ Setup complete for " + CONFIG.AGENCY_NAME);
  Logger.log("  Overlay folder: " + overlay.getUrl());
  Logger.log("════════════════════════════════════════");
  return overlay.getUrl();
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function applyOverlayPermissions(overlay) {
  if (isSharedDriveFolder(overlay.getId())) {
    // SHARED DRIVE: per-folder ACLs are not the access-control surface.
    // SD membership governs. The script logs the expected member roster
    // for the gestora to provision via Drive UI; it does NOT silently
    // attempt setSharing/addViewer (which throw on SD).
    Logger.log("ℹ Shared Drive — per-folder sharing skipped. Configure SD members in Drive UI:");
    Logger.log("    - " + CONFIG.GESTORA_EMAIL + " : Manager");
    CONFIG.ANALYST_EMAILS.forEach(e => Logger.log("    - " + e + " : Content Manager (Editor)"));
    CONFIG.DESIGNER_EMAILS.forEach(e => Logger.log("    - " + e + " : Commenter"));
    return;
  }
  // MyDrive: per-folder ACL semantics
  overlay.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  CONFIG.ANALYST_EMAILS.forEach(email => safeAddViewer(overlay, email));
  CONFIG.DESIGNER_EMAILS.forEach(email => safeAddViewer(overlay, email));
}

function applyGestoraOnlyPermissions(folder) {
  if (isSharedDriveFolder(folder.getId())) {
    // SHARED DRIVE: gestora-only enforcement at folder level requires
    // SD-level "Folder restrictions" (paid Workspace plans). Document
    // the requirement instead of silently failing.
    Logger.log("ℹ Shared Drive — gestora-only requested for '" + folder.getName() +
               "'. SD does not support per-folder ACL restriction below SD-membership level. " +
               "Either: (a) Move " + folder.getName() + " out of SD into gestora's MyDrive, " +
               "or (b) enable Folder Restrictions on the SD (Workspace Business+) and configure manually.");
    return;
  }
  folder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
}

function applyAuditPermissions(folder) {
  if (isSharedDriveFolder(folder.getId())) {
    Logger.log("ℹ Shared Drive — audit dir read access governed by SD membership. " +
               "Analysts who are SD Content Managers will see .audit/ by default.");
    return;
  }
  folder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  CONFIG.ANALYST_EMAILS.forEach(email => safeAddViewer(folder, email));
}

function safeAddViewer(folder, email) {
  try {
    folder.addViewer(email);
  } catch (e) {
    Logger.log("⚠ Could not add viewer " + email + " to " + folder.getName() + ": " + e.message);
  }
}

function seedTemplatesAndHome(overlay) {
  const templates = overlay.getFoldersByName("_templates").next();
  const homeMissing = !overlay.getFilesByName("00 Home.md").hasNext();

  // Seed Home if missing
  if (homeMissing) {
    overlay.createFile("00 Home.md", buildHomeMd(), MimeType.PLAIN_TEXT);
  }

  // Seed templates if missing
  const tmpls = {
    "identity.md": buildTemplate_identity(),
    "policy.md": buildTemplate_policy(),
    "role.md": buildTemplate_role(),
    "decision.md": buildTemplate_decision(),
    "memory.md": buildTemplate_memory(),
    "audit.md": buildTemplate_audit(),
    "client_pii.md": buildTemplate_clientPii(),
  };
  Object.keys(tmpls).forEach(name => {
    if (!templates.getFilesByName(name).hasNext()) {
      templates.createFile(name, tmpls[name], MimeType.PLAIN_TEXT);
    }
  });
}

function buildHomeMd() {
  return [
    "---",
    `agency: "${CONFIG.AGENCY_NAME}"`,
    `slug: ${CONFIG.AGENCY_SLUG}`,
    `gestora: "${CONFIG.GESTORA_EMAIL}"`,
    `setup_at: "${new Date().toISOString()}"`,
    "axis: home",
    "---",
    "",
    `# ${CONFIG.AGENCY_NAME} · Vault de Governança`,
    "",
    "Este vault implementa **GVS 0.1** (Governed Verification Standard 0.1).",
    "",
    "## Eixos",
    "",
    "- [[01 Identity/]] — quem a agência é",
    "- [[02 Policy/]] — regras às quais a agência se vincula",
    "- [[03 Roles/]] — quem pode atuar e com qual autoridade",
    "- [[04 Decision/]] — decisões materiais e sua justificativa",
    "- [[05 Memory/]] — estado vivo (clientes, campanhas, obrigações)",
    "- [[06 Audit/]] — registro imutável de artefatos carimbados",
    "",
    "## Operação diária",
    "",
    "- Manhã: ver SOP da gestora ou do analista (`02 Policy/SOP_*`)",
    "- Final do dia: rodar EOD digest (gera nota em `06 Audit/`)",
    "",
    "## Confidencialidade",
    "",
    "- Notas com PII têm `classification: PII-RESTRICTED` no frontmatter.",
    "- Spans com PII são criptografados com Meld Encrypt; analistas veem apenas ciphertext.",
    "- A chave-mestra fica no Keychain da gestora — fora deste vault, fora do Drive.",
    "",
    "---",
    "",
    `_Setup executado por_ \`brand/governance-vault/apps_script/01_setup_overlay.gs\` _em ${new Date().toISOString()}_`,
    ""
  ].join("\n");
}

function buildTemplate_identity() {
  return `---
title: ""
axis: identity
status: active
classification: INTERNAL
created: ${ymd()}
tags: [axis/identity]
---

# {{title}}

## Resumo
`;
}

function buildTemplate_policy() {
  return `---
title: ""
axis: policy
status: draft
classification: INTERNAL
effective: ${ymd()}
review_due: ${ymd(180)}
tags: [axis/policy]
---

# {{title}}

## Aplicabilidade

## Regra

## Exceções

## Revisão
`;
}

function buildTemplate_role() {
  return `---
title: ""
axis: role
person: ""
classification: INTERNAL
tags: [axis/role]
---

# {{title}}

## Autoridade

## Responsabilidade

## Reportes
`;
}

function buildTemplate_decision() {
  return `---
title: ""
axis: decision
date: ${ymd()}
status: open
classification: INTERNAL
tags: [axis/decision]
---

# {{title}}

## Contexto

## Opções consideradas

## Decisão

## Consequências
`;
}

function buildTemplate_memory() {
  return `---
title: ""
axis: memory
status: live
classification: INTERNAL
tags: [axis/memory]
---

# {{title}}

## Estado atual

## Obrigações em aberto

## Histórico
`;
}

function buildTemplate_audit() {
  return `---
title: ""
axis: audit
ref: ""
stamp_hash: ""
stamped_on: ""
canonical: ""
tags: [axis/audit]
---

> Notas neste eixo são geradas automaticamente pelo audit emitter.
> Não editar à mão.
`;
}

function buildTemplate_clientPii() {
  return `---
title: "Cliente: __NOME__"
axis: memory
classification: PII-RESTRICTED
client_slug: ""
created: ${ymd()}
tags: [axis/memory, classification/pii-restricted]
---

# Cliente: __NOME__

> Spans abaixo são criptografados com Meld Encrypt. Analistas veem ciphertext.
> Para criar/editar uma área criptografada: Cmd-P → "Meld Encrypt: Encrypt selection".

## Identificação

- Nome jurídico: %%🔐α PASTE_CIPHERTEXT_HERE α🔐%%
- CNPJ: %%🔐α PASTE_CIPHERTEXT_HERE α🔐%%
- Contato principal: %%🔐α PASTE_CIPHERTEXT_HERE α🔐%%

## Brief

%%🔐α PASTE_CIPHERTEXT_HERE α🔐%%

## Histórico

- ${ymd()} — registro inicial criado pela gestora
`;
}

function ymd(offsetDays) {
  const d = new Date();
  if (offsetDays) d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function writeBootstrapAuditNote(overlay) {
  const auditAxis = overlay.getFoldersByName("06 Audit").next();
  const filename = ymd() + "-OVERLAY-SETUP.md";
  if (auditAxis.getFilesByName(filename).hasNext()) return;
  const inSD = isSharedDriveFolder(overlay.getId());
  const sdId = inSD ? getSharedDriveId(overlay.getId()) : null;
  const iamLine = inSD
    ? "- IAM: governed by Shared Drive membership (SD id: " + sdId + "). Per-folder ACLs not applied; configure SD members in Drive UI."
    : "- IAM: gestora=Editor; analistas=Reader; _keys/_governance=gestora-only (per-folder ACL)";
  const content = [
    "---",
    `title: "Overlay setup — ${CONFIG.AGENCY_NAME}"`,
    "axis: audit",
    `updated: ${ymd()}`,
    "status: active",
    'event: "overlay.setup"',
    `actor: "${Session.getActiveUser().getEmail()}"`,
    `overlay_id: "${overlay.getId()}"`,
    `topology: "${inSD ? 'shared_drive' : 'my_drive'}"`,
    inSD ? `shared_drive_id: "${sdId}"` : null,
    "tags: [axis/audit, event/overlay.setup]",
    "---",
    "",
    `# Overlay setup — ${CONFIG.AGENCY_NAME}`,
    "",
    `Setup do vault de governança executado em **${new Date().toISOString()}** por **${Session.getActiveUser().getEmail()}**.`,
    "",
    `**Topologia:** ${inSD ? 'Shared Drive (' + sdId + ')' : 'MyDrive'}`,
    "",
    "Aplicado:",
    "",
    "- Pasta overlay criada (ou pré-existente, idempotente)",
    "- Seis eixos GVS instanciados",
    iamLine,
    "- Templates seedados em `_templates/`",
    `- Inventory ${CONFIG.RUN_INVENTORY_ON_SETUP ? "executado (read-only)" : "pulado"}`,
    "",
    "## Próximo passo",
    "",
    inSD
      ? "Configurar SD members em Drive UI (Manage members) — ver roster logado pelo setupOverlay. Depois configurar Obsidian + Meld Encrypt — ver `obsidian/meld_encrypt_setup.md`."
      : "Configurar Obsidian + Meld Encrypt — ver `obsidian/meld_encrypt_setup.md` no app `apps/governance-vault/`.",
    ""
  ].filter(l => l !== null).join("\n");
  auditAxis.createFile(filename, content, MimeType.PLAIN_TEXT);
}

function appendLedgerEntry(overlay, payload) {
  const auditDir = overlay.getFoldersByName(".audit").next();
  const ledgerFiles = auditDir.getFilesByName("document-audit.jsonl");
  let ledgerFile;
  if (ledgerFiles.hasNext()) {
    ledgerFile = ledgerFiles.next();
  } else {
    ledgerFile = auditDir.createFile("document-audit.jsonl", "", MimeType.PLAIN_TEXT);
  }
  const entry = Object.assign({
    ts: new Date().toISOString(),
    agency_slug: CONFIG.AGENCY_SLUG,
    generator: "governance-vault-apps-script-v0.1.0",
  }, payload);
  const existing = ledgerFile.getBlob().getDataAsString();
  ledgerFile.setContent(existing + JSON.stringify(entry) + "\n");
}

function runInventory(parent, governanceDir) {
  // Read-only walk of the existing estate (excluding the overlay itself).
  const overlayName = CONFIG.OVERLAY_FOLDER_NAME;
  const inventory = [];
  const stack = [{ folder: parent, depth: 0 }];

  while (stack.length) {
    const { folder, depth } = stack.shift();
    if (depth > 4) continue;             // safety
    if (folder.getName() === overlayName) continue;

    const folderIt = folder.getFolders();
    while (folderIt.hasNext()) {
      const sub = folderIt.next();
      if (sub.getName() === overlayName) continue;
      inventory.push({
        type: "folder",
        name: sub.getName(),
        id: sub.getId(),
        depth: depth + 1,
        parent_id: folder.getId(),
      });
      stack.push({ folder: sub, depth: depth + 1 });
    }

    if (depth === 0) {
      const fileIt = folder.getFiles();
      while (fileIt.hasNext()) {
        const f = fileIt.next();
        inventory.push({
          type: "file",
          name: f.getName(),
          id: f.getId(),
          mime: f.getMimeType(),
          size: f.getSize(),
          depth: 1,
          parent_id: folder.getId(),
        });
      }
    }
  }

  const filename = "inventory_" + ymd() + ".json";
  const content = JSON.stringify({
    generated_at: new Date().toISOString(),
    parent_folder_id: parent.getId(),
    parent_folder_name: parent.getName(),
    overlay_excluded: overlayName,
    item_count: inventory.length,
    items: inventory
  }, null, 2);

  if (governanceDir.getFilesByName(filename).hasNext()) {
    governanceDir.getFilesByName(filename).next().setContent(content);
  } else {
    governanceDir.createFile(filename, content, MimeType.PLAIN_TEXT);
  }
  Logger.log("✓ Inventory: " + inventory.length + " items cataloged in " + filename);
}
