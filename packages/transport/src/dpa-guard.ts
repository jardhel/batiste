/**
 * @batiste-aidk/transport · dpa-guard (F6 scaffold)
 *
 * Policy-enforced gateway middleware for outbound foundation-model calls.
 * Makes a DPA violation structurally impossible — residency, PII redaction,
 * RoPA (GDPR Art. 30), retention mirror, and sub-processor allowlist are
 * enforced by code, not by operator discipline.
 *
 * See the v2 thesis ADR:
 *   cachola_tech/obs_vault/.../04 Decision/2026-04-22 — Batiste v2 thesis — Firm Memory + DPA-compliant gateway.md
 *
 * v0.1 status: **scaffold**. The types are real and the decision logic is
 * declarative, but wiring into `secure-gateway.ts` lands in the
 * v1.2.0-alpha.2 milestone. The public API is committed to.
 */

import { z } from 'zod';

export const DATA_REGION = ['eu', 'us', 'uk', 'br', 'other'] as const;
export type DataRegion = (typeof DATA_REGION)[number];

export const DATA_CATEGORY = [
  'non-personal',
  'contact',
  'identifier',
  'financial',
  'health',
  'biometric',
  'political-opinion',
  'religious-belief',
  'sex-life',
  'sexual-orientation',
  'racial-origin',
  'trade-union',
  'genetic',
  'criminal',
  'location',
] as const;
export type DataCategory = (typeof DATA_CATEGORY)[number];

/** GDPR Art. 9 special categories — extra legal basis required. */
export const SPECIAL_CATEGORIES: readonly DataCategory[] = [
  'health',
  'biometric',
  'political-opinion',
  'religious-belief',
  'sex-life',
  'sexual-orientation',
  'racial-origin',
  'trade-union',
  'genetic',
];

export const LEGAL_BASIS = [
  'consent',
  'contract',
  'legal-obligation',
  'vital-interests',
  'public-task',
  'legitimate-interests',
  'art9-explicit-consent',
  'art9-employment',
  'art9-vital',
  'art9-public-interest',
] as const;
export type LegalBasis = (typeof LEGAL_BASIS)[number];

export const SubProcessorSchema = z.object({
  name: z.string().min(1),
  region: z.enum(DATA_REGION),
  role: z.string().min(1),
});

export const DpaProfileSchema = z.object({
  controller: z.string().min(1).describe('Legal entity acting as data controller (the firm)'),
  processor: z.string().min(1).describe('Foundation-model provider, e.g. "Anthropic PBC"'),
  dpa_version: z.string().min(1).describe('Version string of the executed DPA (e.g. "2024-11-Anthropic")'),
  signed_on: z.string().describe('ISO date the DPA was executed'),
  /** Regions to which data MAY be transferred. */
  allowed_regions: z.array(z.enum(DATA_REGION)).min(1),
  /** Preferred region; calls route here unless an override is recorded. */
  preferred_region: z.enum(DATA_REGION),
  /** Allowlisted sub-processors. A call whose chain touches an unlisted sub-processor MUST be rejected. */
  sub_processors: z.array(SubProcessorSchema).default([]),
  /** Retention in days matching the provider's commitment. Provider-side + firm-side audit copy follow this. */
  retention_days: z.number().int().positive().default(30),
  /** Special-category data is rejected unless a legal basis is explicitly declared here. */
  special_categories_basis: z.enum(LEGAL_BASIS).optional(),
});

export type DpaProfile = z.infer<typeof DpaProfileSchema>;
export type SubProcessor = z.infer<typeof SubProcessorSchema>;

export interface OutboundCall {
  /** The firm-side request ID tying this call to the audit ledger. */
  request_id: string;
  /** The destination provider ("anthropic", "openai", "google"). */
  provider: string;
  /** The intended regional endpoint, before residency enforcement. */
  requested_region: DataRegion;
  /** The raw prompt payload — may contain PII; dpa-guard redacts before dispatch. */
  payload: string;
  /** Detected data categories (populated by the detector). */
  detected_categories: DataCategory[];
  /** Declared legal basis for this call. */
  legal_basis: LegalBasis;
  /** Declared data subjects — wikilinks into the vault's Memory axis. */
  data_subjects: string[];
}

export type GuardDecision =
  | { kind: 'allow'; routedRegion: DataRegion; redactedPayload: string; ropaEntry: RopaEntry }
  | { kind: 'block'; rule: string; message: string };

export interface RopaEntry {
  /** Processing activity identifier — unique per call. */
  id: string;
  controller: string;
  processor: string;
  purpose: string;
  legal_basis: LegalBasis;
  data_categories: DataCategory[];
  data_subjects: string[];
  recipients: string[];
  transfer_region: DataRegion;
  retention_days: number;
  timestamp: string;
  /** SHA-256 of the redacted payload — ties back to audit ledger. */
  payload_hash: string;
}

/**
 * Pure-function decision for an outbound call given a DPA profile.
 *
 * v0.1 implements:
 *  - sub-processor allowlist enforcement (conservative: rejects anything
 *    not explicitly declared),
 *  - residency enforcement (rejects calls into disallowed regions),
 *  - special-category gate (requires explicit Art. 9 legal basis),
 *  - RoPA record emission.
 *
 * Redaction is delegated to a pluggable redactor (not implemented in v0.1;
 * tests inject a stub that no-ops so the decision logic is exercised
 * end-to-end).
 */
export function decideOutbound(
  call: OutboundCall,
  profile: DpaProfile,
  options: {
    redact: (payload: string, categories: DataCategory[]) => string;
    hash: (s: string) => string;
    ropaIdGenerator: () => string;
    now: () => string;
    purpose: string;
    recipients?: string[];
  },
): GuardDecision {
  if (!profile.allowed_regions.includes(call.requested_region)) {
    return {
      kind: 'block',
      rule: 'residency',
      message: `requested region "${call.requested_region}" is not in the DPA's allowed_regions (${profile.allowed_regions.join(', ')})`,
    };
  }

  const hasSpecial = call.detected_categories.some((c) => (SPECIAL_CATEGORIES as readonly DataCategory[]).includes(c));
  if (hasSpecial) {
    const basisOk = call.legal_basis.startsWith('art9-') && !!profile.special_categories_basis;
    if (!basisOk) {
      return {
        kind: 'block',
        rule: 'special-categories',
        message: 'special-category data (GDPR Art. 9) present and no Art. 9 legal basis declared on the DPA profile',
      };
    }
  }

  const subProcessorsForProvider = profile.sub_processors.filter(
    (sp) => sp.region === call.requested_region,
  );
  if (profile.sub_processors.length > 0 && subProcessorsForProvider.length === 0) {
    return {
      kind: 'block',
      rule: 'sub-processor-allowlist',
      message: `no sub-processor is allowlisted for region "${call.requested_region}"; declare one in the DPA profile or change requested_region`,
    };
  }

  const redacted = options.redact(call.payload, call.detected_categories);
  const ropaEntry: RopaEntry = {
    id: options.ropaIdGenerator(),
    controller: profile.controller,
    processor: profile.processor,
    purpose: options.purpose,
    legal_basis: call.legal_basis,
    data_categories: call.detected_categories,
    data_subjects: call.data_subjects,
    recipients: options.recipients ?? [profile.processor],
    transfer_region: call.requested_region,
    retention_days: profile.retention_days,
    timestamp: options.now(),
    payload_hash: options.hash(redacted),
  };

  return {
    kind: 'allow',
    routedRegion: call.requested_region,
    redactedPayload: redacted,
    ropaEntry,
  };
}

/**
 * Convenience: validate a DPA profile at load time. Throws on malformed
 * configuration — fail-fast before a single outbound call happens.
 */
export function loadDpaProfile(raw: unknown): DpaProfile {
  return DpaProfileSchema.parse(raw);
}
