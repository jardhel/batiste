/**
 * Cachola Tech · Governance Vault · CONFIG
 * --------------------------------------------------
 * The ONLY file you should edit during install.
 * Every other .gs file is identical across deployments.
 *
 * Where to fill: replace the placeholder strings below.
 * Validation: run `validateConfig()` from the Apps Script editor — it
 * fails loud on any unset value before any folder is touched.
 */

const CONFIG = {
  // ── Agency identity ────────────────────────────────────────────────
  AGENCY_NAME: "Agência Bonita G",            // human-readable
  AGENCY_SLUG: "bonita-g",                    // lowercase, hyphenated, no accents
  AGENCY_TIMEZONE: "America/Sao_Paulo",

  // ── Drive topology ─────────────────────────────────────────────────
  // The PARENT folder under which the overlay is created. Usually the
  // agency's existing Workspace root or a "Compartilhados" folder.
  // Right-click in Drive → "Get info" → copy the folder ID from the URL.
  PARENT_FOLDER_ID: "REPLACE_WITH_DRIVE_FOLDER_ID",

  // The name of the new overlay folder. Convention: starts with "_" so
  // it sorts to the top and is visually distinct from existing client folders.
  OVERLAY_FOLDER_NAME: "_Governanca_Obsidian",

  // ── Principals ─────────────────────────────────────────────────────
  GESTORA_EMAIL: "ana.luisa@bonitag.com.br",  // sole owner of _keys/, _governance/
  ANALYST_EMAILS: [
    "analista1@bonitag.com.br",
    "analista2@bonitag.com.br"
  ],
  DESIGNER_EMAILS: [
    "designer@bonitag.com.br"
  ],
  EXTERNAL_COLLABORATORS: [
    // Leave empty unless explicitly authorized. Cachola Tech is NOT in this list.
  ],

  // ── Cataloging behavior ────────────────────────────────────────────
  // When true, runs a read-only inventory of the existing estate on first
  // setup and writes _governance/inventory_YYYY-MM-DD.json. Never modifies.
  RUN_INVENTORY_ON_SETUP: true,

  // Whether the audit emitter subscribes to events on existing folders too.
  // Default: false (only audit events under the overlay folder).
  AUDIT_EXISTING_ESTATE: false,

  // ── Audit ledger location ──────────────────────────────────────────
  // Inside the overlay, hidden from Obsidian indexer.
  AUDIT_LOG_PATH: ".audit/document-audit.jsonl",
  GOVERNANCE_DIR: "_governance",
  KEYS_HINT_DIR: "_keys",

  // ── Trello / Asana webhook secrets ─────────────────────────────────
  // Leave blank if not integrating yet. Tokens live in PropertiesService,
  // never in this file (see `integrations/<tool>/README.md` step 2).
  TRELLO_INTEGRATION_ENABLED: false,
  ASANA_INTEGRATION_ENABLED: false,

  // ── Cachola Tech advisory contact (read-only metadata) ─────────────
  ADVISOR_NAME: "Jardhel Martins Cachola",
  ADVISOR_ORG: "Cachola Tech Ltda-ME",
  ADVISOR_EMAIL: "jardhel@cachola.tech",
  COUNSEL_NAME: "Dr. César Cipriano de Fazio",
  COUNSEL_EMAIL: "cesar@cesarfazio.adv.br",
};

// ─────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────

function validateConfig() {
  const errors = [];
  const warns = [];
  const placeholders = ["REPLACE_WITH_DRIVE_FOLDER_ID", "your.email@domain", ""];

  if (placeholders.includes(CONFIG.PARENT_FOLDER_ID)) {
    errors.push("CONFIG.PARENT_FOLDER_ID is not set.");
  }
  if (!CONFIG.GESTORA_EMAIL.includes("@")) {
    errors.push("CONFIG.GESTORA_EMAIL is not a valid email.");
  }
  if (!Array.isArray(CONFIG.ANALYST_EMAILS) || CONFIG.ANALYST_EMAILS.length === 0) {
    warns.push("CONFIG.ANALYST_EMAILS is empty — no analysts will be granted Reader access.");
  }
  if (CONFIG.EXTERNAL_COLLABORATORS.includes(CONFIG.ADVISOR_EMAIL)) {
    errors.push(
      "CONFIG.EXTERNAL_COLLABORATORS includes the Cachola Tech advisor email. " +
      "Per Principle of Least Privilege, the vendor MUST NOT have Drive access. " +
      "Remove the entry."
    );
  }

  if (errors.length) {
    Logger.log("✗ Config invalid:\n" + errors.map(e => "  - " + e).join("\n"));
    throw new Error("CONFIG validation failed. Fix the errors above and re-run.");
  }
  if (warns.length) {
    Logger.log("⚠ Warnings:\n" + warns.map(w => "  - " + w).join("\n"));
  }
  Logger.log("✓ Config valid for agency: " + CONFIG.AGENCY_NAME);
  return true;
}
