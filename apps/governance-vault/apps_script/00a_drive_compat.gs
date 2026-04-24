/**
 * Cachola Tech · Governance Vault · DRIVE COMPATIBILITY LAYER
 * --------------------------------------------------
 * MyDrive vs Shared Drive helpers. The original v0.1.0 setup script
 * assumed MyDrive (per-folder ACLs via setSharing/addViewer/addEditor).
 * Shared Drives govern access via SD MEMBERSHIP, not per-folder ACLs —
 * so the IAM helpers branch on context. v0.1.1 adds full SD support.
 *
 * Requires the Drive Advanced Service v3 enabled in appsscript.json.
 *
 * @see https://developers.google.com/apps-script/advanced/drive
 */

/**
 * True if the given folder lives in a Shared Drive (any level, including SD root).
 * Returns false for MyDrive folders. Cached per-execution to avoid N+1 API calls.
 */
const _SD_CACHE = {};
function isSharedDriveFolder(folderId) {
  if (folderId in _SD_CACHE) return _SD_CACHE[folderId];
  try {
    const meta = Drive.Files.get(folderId, {
      supportsAllDrives: true,
      fields: 'driveId'
    });
    const result = !!meta.driveId;
    _SD_CACHE[folderId] = result;
    return result;
  } catch (e) {
    Logger.log("⚠ isSharedDriveFolder(" + folderId + ") threw: " + e.message);
    _SD_CACHE[folderId] = false;
    return false;
  }
}

/**
 * Returns the SD ID containing the folder, or null for MyDrive folders.
 */
function getSharedDriveId(folderId) {
  try {
    const meta = Drive.Files.get(folderId, {
      supportsAllDrives: true,
      fields: 'driveId'
    });
    return meta.driveId || null;
  } catch (e) {
    return null;
  }
}

/**
 * SD-safe folder lookup or creation. Uses Advanced Drive Service when the
 * parent is in a Shared Drive (DriveApp.createFolder is unreliable at SD
 * roots and per-folder operations need supportsAllDrives flags).
 */
function findOrCreateChildCompat(parent, childName) {
  const parentId = parent.getId();

  if (isSharedDriveFolder(parentId)) {
    // Search via Advanced Drive Service with SD support
    const escapedName = childName.replace(/'/g, "\\'");
    const q = "'" + parentId + "' in parents and name = '" + escapedName +
              "' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
    const found = Drive.Files.list({
      q: q,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: 'allDrives',
      fields: 'files(id,name)'
    });
    if (found.files && found.files.length > 0) {
      return DriveApp.getFolderById(found.files[0].id);
    }
    const created = Drive.Files.create({
      name: childName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId]
    }, null, {supportsAllDrives: true});
    return DriveApp.getFolderById(created.id);
  }

  // MyDrive path — original behavior
  const it = parent.getFoldersByName(childName);
  if (it.hasNext()) return it.next();
  return parent.createFolder(childName);
}

/**
 * Returns all permissions on a folder, SD-aware. For SD folders, uses
 * Advanced Drive Service with supportsAllDrives so SD member roles surface
 * (DriveApp.getViewers/getEditors only see file-level overlays, not SD members).
 *
 * Each item: {emailAddress, role, type, source} where source is 'member' for
 * SD members or 'file' for file-level permissions.
 */
function listAllPermissions(folderId) {
  if (isSharedDriveFolder(folderId)) {
    const driveId = getSharedDriveId(folderId);
    const out = [];

    // 1. Permissions on the file itself (file-level overlays in SD)
    try {
      const perms = Drive.Permissions.list(folderId, {
        supportsAllDrives: true,
        useDomainAdminAccess: false,
        fields: 'permissions(id,emailAddress,role,type,domain)'
      });
      (perms.permissions || []).forEach(p => {
        if (p.emailAddress) {
          out.push({
            emailAddress: p.emailAddress,
            role: p.role,
            type: p.type,
            source: 'file'
          });
        }
      });
    } catch (e) {
      Logger.log("⚠ Permissions.list(file) failed for " + folderId + ": " + e.message);
    }

    // 2. SD members (apply to every file in the SD)
    try {
      const driveMembers = Drive.Permissions.list(driveId, {
        supportsAllDrives: true,
        useDomainAdminAccess: false,
        fields: 'permissions(id,emailAddress,role,type,domain)'
      });
      (driveMembers.permissions || []).forEach(p => {
        if (p.emailAddress) {
          out.push({
            emailAddress: p.emailAddress,
            role: p.role,
            type: p.type,
            source: 'member'
          });
        }
      });
    } catch (e) {
      Logger.log("⚠ Permissions.list(drive) failed for " + driveId + ": " + e.message);
    }

    return out;
  }

  // MyDrive path — DriveApp is fine
  const folder = DriveApp.getFolderById(folderId);
  const out = [];
  folder.getEditors().forEach(u => out.push({
    emailAddress: u.getEmail(),
    role: 'writer',
    type: 'user',
    source: 'file'
  }));
  folder.getViewers().forEach(u => out.push({
    emailAddress: u.getEmail(),
    role: 'reader',
    type: 'user',
    source: 'file'
  }));
  return out;
}

/**
 * Return the SD root folder for a given drive ID, or null on failure.
 * Useful when CONFIG.PARENT_FOLDER_ID is the SD ID itself rather than a folder.
 */
function getSharedDriveRootAsFolder(driveId) {
  try {
    return DriveApp.getFolderById(driveId);
  } catch (e) {
    Logger.log("⚠ getSharedDriveRootAsFolder failed for " + driveId + ": " + e.message);
    return null;
  }
}

/**
 * Diagnostic: prints what kind of container PARENT_FOLDER_ID points to.
 * Run from the editor before setupOverlay if unsure of the topology.
 */
function describeParentFolder() {
  const id = CONFIG.PARENT_FOLDER_ID;
  Logger.log("PARENT_FOLDER_ID = " + id);
  try {
    const meta = Drive.Files.get(id, {
      supportsAllDrives: true,
      fields: 'id,name,mimeType,driveId,parents'
    });
    Logger.log("  name      = " + meta.name);
    Logger.log("  mimeType  = " + meta.mimeType);
    Logger.log("  driveId   = " + (meta.driveId || '(MyDrive)'));
    Logger.log("  parents   = " + (meta.parents ? meta.parents.join(',') : '(none — likely SD root)'));
    if (meta.driveId) {
      const drive = Drive.Drives.get(meta.driveId);
      Logger.log("  SD name   = " + drive.name);
    }
  } catch (e) {
    Logger.log("✗ Could not describe folder: " + e.message);
  }
}
