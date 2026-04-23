/**
 * Cachola Tech · Governance Vault · Trello webhook handler
 * --------------------------------------------------
 * Add this file alongside the others in the agency's Apps Script project.
 * Trello posts every card event to the deployed Web App URL.
 *
 * Metadata-only by default. Cards labeled `gvs-pii` route the title and
 * description to an encrypted note in 05 Memory/ instead of cleartext ledger.
 */

const TRELLO_PII_LABEL = "gvs-pii";

function doGet(e) {
  // Trello pings GET to verify the webhook on registration. Return 200.
  return ContentService.createTextOutput("OK");
}

function doPost(e) {
  const props = PropertiesService.getScriptProperties();
  if (!CONFIG.TRELLO_INTEGRATION_ENABLED) {
    return ContentService.createTextOutput("disabled");
  }

  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    Logger.log("⚠ Invalid Trello payload: " + err.message);
    return ContentService.createTextOutput("bad payload");
  }

  const action = payload.action;
  if (!action) return ContentService.createTextOutput("no action");

  const overlay = locateOverlay();
  if (!overlay) return ContentService.createTextOutput("no overlay");

  const auditDir = overlay.getFoldersByName(".audit").next();
  const card = action.data && action.data.card;
  const board = action.data && action.data.board;
  const isPii = isPiiCard(card);

  const entry = {
    ts: new Date(action.date || Date.now()).toISOString(),
    event: "trello." + action.type,
    agency_slug: CONFIG.AGENCY_SLUG,
    actor: action.memberCreator ? action.memberCreator.username : "unknown",
    board_id: board ? board.id : null,
    board_name: board ? board.name : null,
    card_id: card ? card.id : null,
    card_short: card ? card.shortLink : null,
    card_name: isPii ? null : (card ? card.name : null),
    card_name_hash: isPii && card ? sha256Short(card.name) : null,
    pii_routed: isPii,
    generator: "governance-vault-trello-v0.1.0",
  };
  appendLedgerLine(auditDir, entry);

  if (isPii && card) {
    upsertEncryptedMemoryNote(overlay, board, card, action);
  } else if (action.type === "createCard" || action.type === "updateCard") {
    upsertCardAuditNote(overlay, board, card, action);
  }

  return ContentService.createTextOutput("ok");
}

function isPiiCard(card) {
  if (!card || !Array.isArray(card.labels)) return false;
  return card.labels.some(l =>
    (l.name || "").toLowerCase() === TRELLO_PII_LABEL
  );
}

function sha256Short(s) {
  if (!s) return null;
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s);
  return bytes.slice(0, 8).map(b => ("0" + (b & 0xff).toString(16)).slice(-2)).join("");
}

function upsertCardAuditNote(overlay, board, card, action) {
  const auditAxis = overlay.getFoldersByName("06 Audit").next();
  const date = new Date(action.date || Date.now()).toISOString().slice(0, 10);
  const fname = date + "-TRELLO-" + (card.shortLink || "noid") + ".md";
  if (auditAxis.getFilesByName(fname).hasNext()) return;
  const body = [
    "---",
    `title: "Trello: ${(card.name || "").replace(/"/g, '\\"')}"`,
    "axis: audit",
    `updated: ${date}`,
    'event: "trello.card"',
    `board: "${board ? board.name : ""}"`,
    `card_id: "${card.id}"`,
    `card_short: "${card.shortLink || ""}"`,
    "tags: [axis/audit, source/trello]",
    "---",
    "",
    `# Trello: ${card.name || ""}`,
    "",
    `- **Board:** ${board ? board.name : "—"}`,
    `- **Card link:** https://trello.com/c/${card.shortLink}`,
    `- **Last action:** ${action.type} by ${action.memberCreator ? action.memberCreator.username : "unknown"}`,
    `- **Last action ts:** ${action.date || ""}`,
    ""
  ].join("\n");
  auditAxis.createFile(fname, body, MimeType.PLAIN_TEXT);
}

function upsertEncryptedMemoryNote(overlay, board, card, action) {
  const memoryAxis = overlay.getFoldersByName("05 Memory").next();
  const fname = "trello-pii-" + (card.shortLink || card.id) + ".md";
  if (memoryAxis.getFilesByName(fname).hasNext()) return;
  // We can't actually encrypt server-side without the gestora's key.
  // Instead: write a placeholder note that tells the gestora to encrypt manually
  // on next vault sync. The card title is intentionally NOT included.
  const body = [
    "---",
    "title: \"Trello PII card\"",
    "axis: memory",
    "classification: PII-RESTRICTED",
    `card_id: "${card.id}"`,
    `card_short: "${card.shortLink || ""}"`,
    "tags: [axis/memory, source/trello, classification/pii-restricted, status/awaiting-encryption]",
    "---",
    "",
    "# Trello PII card",
    "",
    "> A card labeled `gvs-pii` was created/updated in Trello.",
    "> Open the card link below, copy the title and description into the encrypted block,",
    "> then encrypt with Cmd+Shift+E.",
    "",
    `- **Card link:** https://trello.com/c/${card.shortLink || ""}`,
    `- **Last action:** ${action.type}`,
    "",
    "## Encrypted content",
    "",
    "%%🔐α PASTE_AND_ENCRYPT_HERE α🔐%%",
    ""
  ].join("\n");
  memoryAxis.createFile(fname, body, MimeType.PLAIN_TEXT);
}
