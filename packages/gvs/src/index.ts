/**
 * @batiste-aidk/gvs — Governance Vault Specification v0.1
 *
 * Reference loader and validator for GVS-conforming vaults. Batiste uses this
 * package to ingest its own reference vault (the Cachola Tech governance
 * vault) and any third-party conforming vault the user points it at.
 *
 * @see specs/gvs-0.1.md
 */

export { loadVault } from './vault.js';
export { validateVault } from './validator.js';
export { parseMarkdown, parseFrontmatter, extractWikilinks } from './frontmatter.js';
export {
  AXES,
  AXIS_FOLDERS,
  STATUSES,
  CLASSIFICATIONS,
  BaseFrontmatterSchema,
  DecisionFrontmatterSchema,
  RolesFrontmatterSchema,
  MemoryFrontmatterSchema,
  AuditFrontmatterSchema,
  AXIS_SCHEMAS,
  normalizeWikilink,
} from './types.js';
export type {
  Axis,
  NoteStatus,
  Note,
  Vault,
  ValidationIssue,
  ValidationReport,
  BaseFrontmatter,
  DecisionFrontmatter,
  RolesFrontmatter,
  MemoryFrontmatter,
  AuditFrontmatter,
} from './types.js';
export type { ValidateOptions } from './validator.js';
