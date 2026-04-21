/**
 * @batiste-aidk/gvs · vault loader
 *
 * Walk a GVS-conforming directory and return an indexed Vault. Tolerates
 * malformed notes (recorded as notes with axis: null) so the validator can
 * report them as issues rather than crashing the loader.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { AXES, AXIS_FOLDERS, type Axis, type Note, type Vault } from './types.js';
import { parseMarkdown, extractWikilinks } from './frontmatter.js';

async function readIfExists(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function listMarkdown(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listMarkdown(full)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isFile()).map((e) => path.join(dir, e.name));
}

async function loadNote(absPath: string, rootDir: string, axis: Axis | null): Promise<Note> {
  const source = await fs.readFile(absPath, 'utf8');
  const { frontmatter, body } = parseMarkdownSafe(source);
  const wikilinks = extractWikilinks(body);
  const fmAxis = frontmatter['axis'];
  const resolvedAxis =
    typeof fmAxis === 'string' && (AXES as readonly string[]).includes(fmAxis)
      ? (fmAxis as Axis)
      : axis;
  const titleRaw = frontmatter['title'];
  const title =
    typeof titleRaw === 'string' && titleRaw.length > 0
      ? titleRaw
      : path.basename(absPath, '.md');
  return {
    path: absPath,
    relativePath: path.relative(rootDir, absPath),
    axis: resolvedAxis,
    frontmatter,
    body,
    wikilinks,
    title,
  };
}

function parseMarkdownSafe(source: string): { frontmatter: Record<string, unknown>; body: string } {
  try {
    const { frontmatter, body } = parseMarkdown(source);
    return { frontmatter, body };
  } catch {
    return { frontmatter: {}, body: source };
  }
}

export async function loadVault(root: string): Promise<Vault> {
  const rootStat = await fs.stat(root).catch(() => null);
  if (!rootStat || !rootStat.isDirectory()) {
    throw new Error(`vault root is not a directory: ${root}`);
  }

  const notesByAxis = {
    identity: [] as Note[],
    policy: [] as Note[],
    roles: [] as Note[],
    decision: [] as Note[],
    memory: [] as Note[],
    audit: [] as Note[],
  } satisfies Record<Axis, Note[]>;

  const canonicalHomePath = path.join(root, '00 Home.md');
  const fallbackHomePath = path.join(root, 'Home.md');
  let homePath = canonicalHomePath;
  let homeSource = await readIfExists(canonicalHomePath);
  if (homeSource === null) {
    const fallback = await readIfExists(fallbackHomePath);
    if (fallback !== null) {
      homePath = fallbackHomePath;
      homeSource = fallback;
    }
  }
  let home: Note | null = null;
  let gvsVersion: string | null = null;
  if (homeSource !== null) {
    const { frontmatter, body } = parseMarkdownSafe(homeSource);
    const gv = frontmatter['gvs_version'];
    if (typeof gv === 'string') gvsVersion = gv;
    home = {
      path: homePath,
      relativePath: path.relative(root, homePath),
      axis: null,
      frontmatter,
      body,
      wikilinks: extractWikilinks(body),
      title:
        typeof frontmatter['title'] === 'string'
          ? (frontmatter['title'] as string)
          : 'Home',
    };
  }

  const all: Note[] = home ? [home] : [];

  for (const axis of AXES) {
    const folder = path.join(root, AXIS_FOLDERS[axis]);
    const folderStat = await fs.stat(folder).catch(() => null);
    if (!folderStat || !folderStat.isDirectory()) continue;
    const files = await listMarkdown(folder);
    for (const file of files) {
      const note = await loadNote(file, root, axis);
      notesByAxis[axis].push(note);
      all.push(note);
    }
  }

  const templatesDir = path.join(root, '_templates');
  const templates = (await listFiles(templatesDir))
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.relative(root, f));

  const attachmentsDir = path.join(root, '_attachments');
  const attachments = (await listFiles(attachmentsDir)).map((f) => path.relative(root, f));

  return { root, gvsVersion, home, notesByAxis, all, templates, attachments };
}
