/**
 * Google Drive v3 REST client (zero-dep, scope-flexible).
 *
 * Uses `getGoogleClient(['https://www.googleapis.com/auth/drive.readonly'])`
 * for the auth layer so future Google connectors share the same refresh
 * token and incremental scope grant. Pagination is handled here so
 * callers iterate a single async generator.
 *
 * v1.3 only fetches metadata — the design-as-code compiler resolves
 * binary content on demand via the stored `webViewLink`. Content
 * extraction (PDF text, image OCR) lands in v1.3.1 via
 * `@batiste-aidk/connectors`.
 */

import type { GoogleClient } from './gauth.js';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
export const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime?: string;
  modifiedTime?: string;
  webViewLink?: string;
  parents?: string[];
  trashed?: boolean;
}

export interface DriveFolder {
  id: string;
  name: string;
}

interface DriveListResponse {
  files?: DriveFile[];
  nextPageToken?: string;
}

const FILE_FIELDS = 'id,name,mimeType,size,createdTime,modifiedTime,webViewLink,parents,trashed';

export async function fetchFolderMeta(client: GoogleClient, folderId: string): Promise<DriveFolder> {
  const url = `${DRIVE_API_BASE}/files/${encodeURIComponent(folderId)}?fields=id,name`;
  const res = await client.fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Drive folder ${folderId} fetch failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return (await res.json()) as DriveFolder;
}

/**
 * List all files inside a folder. Yields one page at a time so callers
 * can stream into FactEntry projection without buffering everything.
 *
 * `modifiedTimeFloor`: optional incremental-sync hint — if provided, the
 * Drive query is restricted to files modified strictly after this ISO
 * time. Atrium's checkpoint store passes `lastModifiedTime` here so a
 * re-run is O(delta), not O(folder).
 */
export async function* listFolderFiles(
  client: GoogleClient,
  folderId: string,
  options: { pageSize?: number; modifiedTimeFloor?: string } = {},
): AsyncGenerator<DriveFile, void, void> {
  const pageSize = options.pageSize ?? 200;
  let q = `'${folderId}' in parents and trashed = false`;
  if (options.modifiedTimeFloor) {
    q += ` and modifiedTime > '${options.modifiedTimeFloor}'`;
  }

  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q,
      fields: `nextPageToken,files(${FILE_FIELDS})`,
      pageSize: String(pageSize),
      orderBy: 'modifiedTime asc',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await client.fetch(`${DRIVE_API_BASE}/files?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Drive list ${folderId} failed (${res.status}): ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as DriveListResponse;
    for (const file of data.files ?? []) {
      yield file;
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
}
