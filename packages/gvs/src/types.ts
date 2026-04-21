/**
 * @batiste-aidk/gvs · types
 *
 * Type definitions for the Governance Vault Specification v0.1.
 * See specs/gvs-0.1.md for the normative definitions.
 */

import { z } from 'zod';

export const AXES = ['identity', 'policy', 'roles', 'decision', 'memory', 'audit'] as const;
export type Axis = (typeof AXES)[number];

export const AXIS_FOLDERS: Record<Axis, string> = {
  identity: '01 Identity',
  policy: '02 Policy',
  roles: '03 Roles',
  decision: '04 Decision',
  memory: '05 Memory',
  audit: '06 Audit',
};

export const STATUSES = ['draft', 'active', 'paused', 'archived'] as const;
export type NoteStatus = (typeof STATUSES)[number];

export const CLASSIFICATIONS = [
  'public',
  'internal',
  'confidential',
  'confidential-nda',
  'privileged',
] as const;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T[\d:.+Z-]+)?$/, 'must be ISO-8601 date or datetime');

const OptionalWikilinkField = z
  .union([z.string(), z.array(z.array(z.string()).length(1)).length(1)])
  .optional();

export const BaseFrontmatterSchema = z.object({
  title: z.string().min(1),
  axis: z.enum(AXES),
  updated: isoDate,
  status: z.enum(STATUSES),
  tags: z.array(z.string()).default([]),
  canonical: z.string().optional(),
  language: z.string().length(2).optional(),
  supersedes: OptionalWikilinkField,
  superseded_by: OptionalWikilinkField,
}).passthrough();

/**
 * A wikilink field. In YAML, authors may write `authority: [[Name]]` unquoted,
 * which the YAML parser represents as a nested array `[["Name"]]`. We accept
 * either a plain string or the nested-array rendering and collapse them
 * downstream.
 */
const WikilinkField = z.union([
  z.string().min(1),
  z.array(z.array(z.string()).length(1)).length(1),
]);

export const DecisionFrontmatterSchema = BaseFrontmatterSchema.extend({
  axis: z.literal('decision'),
  decided_on: isoDate,
  authority: WikilinkField,
});

export const RolesFrontmatterSchema = BaseFrontmatterSchema.extend({
  axis: z.literal('roles'),
  principal_type: z.enum(['human', 'agent']),
  agent_model: z.string().optional(),
}).refine(
  (d) => d.principal_type !== 'agent' || !!d.agent_model,
  { message: 'agent_model is required when principal_type is agent', path: ['agent_model'] },
);

export const MemoryFrontmatterSchema = BaseFrontmatterSchema.extend({
  axis: z.literal('memory'),
  counterparty: z.string().optional(),
  workstream: z.string().optional(),
});

export const AuditFrontmatterSchema = BaseFrontmatterSchema.extend({
  axis: z.literal('audit'),
  ref: z.string().min(1),
  manifest: z.string().min(1),
  stamp_hash: z.string().regex(/^[a-f0-9]{64}$/i, 'must be SHA-256 hex'),
  stamped_on: isoDate,
});

export type BaseFrontmatter = z.infer<typeof BaseFrontmatterSchema>;
export type DecisionFrontmatter = z.infer<typeof DecisionFrontmatterSchema>;
export type RolesFrontmatter = z.infer<typeof RolesFrontmatterSchema>;
export type MemoryFrontmatter = z.infer<typeof MemoryFrontmatterSchema>;
export type AuditFrontmatter = z.infer<typeof AuditFrontmatterSchema>;

/** Collapse a wikilink field (string or nested-array YAML form) to a string. */
export function normalizeWikilink(value: unknown): string | null {
  if (typeof value === 'string') return value.replace(/^\[\[|\]\]$/g, '');
  if (Array.isArray(value) && value.length === 1) {
    const inner = value[0];
    if (Array.isArray(inner) && inner.length === 1 && typeof inner[0] === 'string') {
      return inner[0];
    }
  }
  return null;
}

export interface Note {
  path: string;
  relativePath: string;
  axis: Axis | null;
  frontmatter: BaseFrontmatter | Record<string, unknown>;
  body: string;
  wikilinks: string[];
  title: string;
}

export interface Vault {
  root: string;
  gvsVersion: string | null;
  home: Note | null;
  notesByAxis: Record<Axis, Note[]>;
  all: Note[];
  templates: string[];
  attachments: string[];
}

export interface ValidationIssue {
  rule: string;
  severity: 'error' | 'warning';
  path: string;
  message: string;
}

export interface ValidationReport {
  vault: string;
  gvsVersion: string | null;
  conforming: boolean;
  counts: {
    notes: number;
    byAxis: Record<Axis, number>;
    errors: number;
    warnings: number;
  };
  issues: ValidationIssue[];
}

export const AXIS_SCHEMAS: Record<Axis, z.ZodTypeAny> = {
  identity: BaseFrontmatterSchema.extend({ axis: z.literal('identity') }),
  policy: BaseFrontmatterSchema.extend({ axis: z.literal('policy') }),
  roles: RolesFrontmatterSchema,
  decision: DecisionFrontmatterSchema,
  memory: MemoryFrontmatterSchema,
  audit: AuditFrontmatterSchema,
};
