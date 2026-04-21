/**
 * @batiste-aidk/gvs · validator
 *
 * Enforces GVS 0.1 §10 validation rules against a loaded Vault.
 *
 * Implemented:
 *  (1) Frontmatter completeness · per-axis zod schemas
 *  (2) Axis consistency · frontmatter.axis matches containing folder
 *  (3) Wikilink resolution · every [[target]] resolves to a note title
 *  (4) Canonical path resolution · `canonical:` resolves relative to repo
 *  (5) Audit uniqueness · every ref is unique within 06 Audit
 *  (7) Status consistency · no archived note is linked from an active note
 *      without a supersedes relation
 * Also enforced (spec §5.7, §13):
 *  - `_templates/` directory present with one template per axis
 *  - `00 Home.md` with `gvs_version:` declared
 *
 * Not yet implemented (require external state):
 *  (6) Audit-ledger agreement · needs operating ledger path
 *  (8) Decision immutability · needs git history
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  AXES,
  AXIS_FOLDERS,
  AXIS_SCHEMAS,
  normalizeWikilink,
  type Axis,
  type Note,
  type ValidationIssue,
  type ValidationReport,
  type Vault,
} from './types.js';

const REQUIRED_TEMPLATES = [
  '00-home.md',
  '01-identity.md',
  '02-policy.md',
  '03-roles.md',
  '04-decision.md',
  '05-memory.md',
  '06-audit.md',
];

export interface ValidateOptions {
  /** Repository root used to resolve `canonical:` paths. Defaults to the vault's parent. */
  repoRoot?: string;
  /** If true, skip canonical path resolution — useful when the repo layout is not available. */
  skipCanonical?: boolean;
}

export async function validateVault(
  vault: Vault,
  opts: ValidateOptions = {},
): Promise<ValidationReport> {
  const issues: ValidationIssue[] = [];
  const repoRoot = opts.repoRoot ?? path.dirname(vault.root);

  // Home + gvs_version
  if (!vault.home) {
    issues.push({
      rule: 'home-present',
      severity: 'error',
      path: '00 Home.md',
      message: '00 Home.md is missing',
    });
  } else {
    if (vault.home.relativePath !== '00 Home.md') {
      issues.push({
        rule: 'home-naming',
        severity: 'warning',
        path: vault.home.relativePath,
        message: `home file should be named "00 Home.md" per spec §5 (found "${vault.home.relativePath}")`,
      });
    }
    if (!vault.gvsVersion) {
      issues.push({
        rule: 'home-gvs-version',
        severity: 'error',
        path: vault.home.relativePath,
        message: 'home frontmatter must declare gvs_version per spec §13',
      });
    }
  }

  // Templates directory
  for (const tpl of REQUIRED_TEMPLATES) {
    const rel = `_templates/${tpl}`;
    if (!vault.templates.includes(rel)) {
      issues.push({
        rule: 'templates-catalog',
        severity: 'error',
        path: rel,
        message: `required template is missing: ${tpl}`,
      });
    }
  }

  // Per-note rules (1, 2, 4)
  for (const note of vault.all) {
    if (note.path === (vault.home?.path ?? '')) continue;

    // (2) axis consistency: folder vs frontmatter
    const folderAxis = folderAxisOf(note.relativePath);
    const fmAxis = note.frontmatter['axis'];
    if (folderAxis && fmAxis && fmAxis !== folderAxis) {
      issues.push({
        rule: 'axis-consistency',
        severity: 'error',
        path: note.relativePath,
        message: `frontmatter axis=${String(fmAxis)} does not match folder ${AXIS_FOLDERS[folderAxis]}`,
      });
    }

    // (1) frontmatter completeness — per-axis schema
    if (note.axis) {
      const schema = AXIS_SCHEMAS[note.axis];
      const result = schema.safeParse(note.frontmatter);
      if (!result.success) {
        for (const err of result.error.issues) {
          issues.push({
            rule: 'frontmatter-completeness',
            severity: 'error',
            path: note.relativePath,
            message: `frontmatter.${err.path.join('.') || '(root)'}: ${err.message}`,
          });
        }
      }
    } else {
      issues.push({
        rule: 'axis-consistency',
        severity: 'error',
        path: note.relativePath,
        message: 'note lacks a resolvable axis (no folder match and no frontmatter axis)',
      });
    }

    // (4) canonical path
    const canonical = note.frontmatter['canonical'];
    if (!opts.skipCanonical && typeof canonical === 'string' && canonical.length > 0) {
      const abs = path.resolve(repoRoot, canonical);
      const stat = await fs.stat(abs).catch(() => null);
      if (!stat) {
        issues.push({
          rule: 'canonical-path',
          severity: 'warning',
          path: note.relativePath,
          message: `canonical path does not resolve: ${canonical}`,
        });
      }
    }
  }

  // (3) wikilink resolution
  const titleIndex = new Map<string, Note>();
  for (const note of vault.all) {
    titleIndex.set(note.title, note);
    const base = path.basename(note.relativePath, '.md');
    titleIndex.set(base, note);
  }
  for (const note of vault.all) {
    for (const link of note.wikilinks) {
      if (!titleIndex.has(link)) {
        issues.push({
          rule: 'wikilink-resolution',
          severity: 'warning',
          path: note.relativePath,
          message: `broken wikilink: [[${link}]]`,
        });
      }
    }
  }

  // (5) audit uniqueness
  const seenRefs = new Map<string, string>();
  for (const note of vault.notesByAxis.audit) {
    const ref = note.frontmatter['ref'];
    if (typeof ref !== 'string' || ref.length === 0) continue;
    const prev = seenRefs.get(ref);
    if (prev) {
      issues.push({
        rule: 'audit-uniqueness',
        severity: 'error',
        path: note.relativePath,
        message: `audit ref "${ref}" also appears in ${prev}`,
      });
    } else {
      seenRefs.set(ref, note.relativePath);
    }
  }

  // (7) status consistency — archived notes linked from active notes without supersedes
  const archivedTitles = new Set(
    vault.all.filter((n) => n.frontmatter['status'] === 'archived').map((n) => n.title),
  );
  for (const note of vault.all) {
    if (note.frontmatter['status'] !== 'active') continue;
    const supersedesNorm = normalizeWikilink(note.frontmatter['supersedes']);
    const supersededSet = new Set(supersedesNorm ? [supersedesNorm] : []);
    for (const link of note.wikilinks) {
      if (archivedTitles.has(link) && !supersededSet.has(link)) {
        issues.push({
          rule: 'status-consistency',
          severity: 'warning',
          path: note.relativePath,
          message: `active note links archived note [[${link}]] without a supersedes relation`,
        });
      }
    }
  }

  const byAxis = Object.fromEntries(
    AXES.map((a) => [a, vault.notesByAxis[a].length]),
  ) as Record<Axis, number>;

  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;

  return {
    vault: vault.root,
    gvsVersion: vault.gvsVersion,
    conforming: errors === 0,
    counts: {
      notes: vault.all.length,
      byAxis,
      errors,
      warnings,
    },
    issues,
  };
}

function folderAxisOf(relativePath: string): Axis | null {
  const top = relativePath.split(path.sep)[0] ?? relativePath.split('/')[0];
  for (const axis of AXES) {
    if (AXIS_FOLDERS[axis] === top) return axis;
  }
  return null;
}
