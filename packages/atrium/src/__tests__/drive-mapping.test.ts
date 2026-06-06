/**
 * Google Drive folder → FactEntry projection unit tests.
 *
 * Pure-function coverage of `projectFolderToFacts`: no live API, no FM
 * writes, no audit ledger. Uses a minimal in-memory file list that
 * mirrors the shape Drive v3 returns for `files.list`.
 */

import { describe, expect, it } from 'vitest';
import { projectFolderToFacts } from '../commands/ingest-drive.js';
import type { DriveFile, DriveFolder } from '../utils/drive-client.js';
import { shortHash } from '../utils/hash.js';

const folder: DriveFolder = {
  id: 'folder-xyz',
  name: 'Loungerie · Asset Catalog',
};

const files: DriveFile[] = [
  {
    id: 'file-1',
    name: 'brand-guidelines-2026.pdf',
    mimeType: 'application/pdf',
    size: '1234567',
    createdTime: '2026-01-10T08:00:00.000Z',
    modifiedTime: '2026-04-15T08:00:00.000Z',
    webViewLink: 'https://drive.google.com/file/d/file-1/view',
    parents: ['folder-xyz'],
    trashed: false,
  },
  {
    id: 'file-2',
    name: 'product-photo-azul.jpg',
    mimeType: 'image/jpeg',
    size: '450000',
    createdTime: '2026-02-01T10:00:00.000Z',
    modifiedTime: '2026-04-20T10:00:00.000Z',
    webViewLink: 'https://drive.google.com/file/d/file-2/view',
    parents: ['folder-xyz'],
    trashed: false,
  },
  {
    id: 'file-trashed',
    name: 'old-deck.pdf',
    mimeType: 'application/pdf',
    trashed: true,
  },
];

describe('projectFolderToFacts', () => {
  const facts = projectFolderToFacts(folder, files, { now: '2026-04-24T00:00:00.000Z' });

  it('projects one FactEntry per non-trashed file', () => {
    expect(facts).toHaveLength(2);
  });

  it('skips trashed files', () => {
    expect(facts.find((f) => f.title === 'old-deck.pdf')).toBeUndefined();
  });

  it('uses shortHash("drive:" + fileId) for the FactEntry id', () => {
    expect(facts[0]?.id).toBe(shortHash('drive:file-1'));
    expect(facts[1]?.id).toBe(shortHash('drive:file-2'));
  });

  it('marks every fact as kind=precedent', () => {
    for (const f of facts) expect(f.kind).toBe('precedent');
  });

  it('derives workstream from folder name as kebab-case when not overridden', () => {
    expect(facts[0]?.workstream).toBe('loungerie-asset-catalog');
  });

  it('honors --workstream override', () => {
    const overridden = projectFolderToFacts(folder, files, {
      workstream: 'loungerie-catalog-override',
      now: '2026-04-24T00:00:00.000Z',
    });
    expect(overridden[0]?.workstream).toBe('loungerie-catalog-override');
  });

  it('builds tag set with source/mime/folder prefixes', () => {
    const tags = facts[0]?.tags ?? [];
    expect(tags).toContain('source:drive');
    expect(tags).toContain('mime:application/pdf');
    expect(tags).toContain('folder:Loungerie · Asset Catalog');
  });

  it('uses webViewLink as vault_ref', () => {
    expect(facts[0]?.vault_ref).toBe('https://drive.google.com/file/d/file-1/view');
  });

  it('renders metadata in body (id, mime, size, parents)', () => {
    const body = facts[0]?.body ?? '';
    expect(body).toContain('id: file-1');
    expect(body).toContain('mimeType: application/pdf');
    expect(body).toContain('size: 1234567');
    expect(body).toContain('parents: [folder-xyz]');
    expect(body).toContain('webViewLink: https://drive.google.com/file/d/file-1/view');
  });

  it('marks every fact as confidential', () => {
    for (const f of facts) expect(f.sensitivity).toBe('confidential');
  });

  it('uses the file modifiedTime as updated_at', () => {
    expect(facts[0]?.updated_at).toBe('2026-04-15T08:00:00.000Z');
    expect(facts[1]?.updated_at).toBe('2026-04-20T10:00:00.000Z');
  });
});
