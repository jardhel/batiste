/**
 * @batiste-aidk/rls — Row-Level Security primitives for Batiste.
 * v0.1.0-alpha.1 — interfaces only. Implementations are stubs that throw NotImplemented.
 * The interface surface is the contract; implementations land in v0.1.0.
 */

// ─── Types ────────────────────────────────────────────────────────────

export type Classification =
  | "PUBLIC"
  | "INTERNAL"
  | "PII-RESTRICTED"
  | "CONFIDENTIAL"
  | "SECRET";

export type Action = "read" | "write" | "delete" | "share";

export type Decision = "ALLOW" | "DENY" | "ALLOW_REDACTED";

export interface Principal {
  id: string;
  roles: string[];
  groups: string[];
  keyFingerprints?: string[];
  attestation?: string;
}

export interface Asset {
  uri: string;
  classification: Classification;
  ownerId: string;
  contentHash?: string;
  attributes?: Record<string, string>;
}

export interface RedactSpec {
  strategy: "placeholder" | "cipher" | "hash" | "null";
  spanPattern?: string; // regex; defaults vary per strategy
  placeholderText?: string; // used when strategy=placeholder
}

export interface AccessRuleMatch {
  principalRoles?: string[];
  classifications?: Classification[];
  actions?: Action[];
  uriPattern?: string;
}

export interface AccessRule {
  id?: string;
  match: AccessRuleMatch;
  decision: Decision;
  redactSpec?: RedactSpec;
  reason?: string;
}

export interface AccessPolicy {
  version: string;
  defaultDecision: "ALLOW" | "DENY";
  rules: AccessRule[];
}

export interface AccessDecision {
  decision: Decision;
  matchedRule?: AccessRule;
  reason: string;
  redactSpec?: RedactSpec;
  evaluatedAt: string; // ISO-8601
}

// ─── API (v0.1 stubs — throw NotImplementedError) ────────────────────

export class NotImplementedError extends Error {
  constructor(symbol: string) {
    super(
      `@batiste-aidk/rls v0.1.0-alpha.1 — '${symbol}' not yet implemented. ` +
        `Interfaces are stable; reference implementation lands in v0.1.0 (target 2026-05-15). ` +
        `Track progress at: https://github.com/jardhel/batiste/issues?q=rls`
    );
    this.name = "NotImplementedError";
  }
}

/**
 * Evaluate an access request against a policy.
 *
 * v0.1.0-alpha.1: throws NotImplementedError. The contract is:
 *   - Walk policy.rules in declared order
 *   - First rule whose match conditions ALL match wins
 *   - If no rule matches, return policy.defaultDecision
 *   - Decision is one of ALLOW / DENY / ALLOW_REDACTED
 *   - When ALLOW_REDACTED, the matched rule's redactSpec is propagated
 */
export function evaluate(
  _principal: Principal,
  _asset: Asset,
  _action: Action,
  _policy: AccessPolicy
): AccessDecision {
  throw new NotImplementedError("evaluate(principal, asset, action, policy)");
}

/**
 * Apply a redaction spec to a string of content.
 *
 * v0.1.0-alpha.1: throws NotImplementedError. The contract is:
 *   - placeholder: replace matching spans with placeholderText (default "[REDACTED]")
 *   - cipher: preserve Meld-Encrypt markers (%%🔐α … α🔐%%) and replace cleartext spans
 *   - hash: replace spans with sha256:<first-12-hex>
 *   - null: delete spans entirely
 */
export function redact(_content: string, _spec: RedactSpec): string {
  throw new NotImplementedError("redact(content, spec)");
}

/**
 * Bind a principal to an action stream (e.g. a Batiste node session).
 * Returns a guard function that callers wrap around every read/write to enforce the policy.
 */
export function guardFor(
  principal: Principal,
  policy: AccessPolicy
): (asset: Asset, action: Action) => AccessDecision {
  return (asset: Asset, action: Action) => evaluate(principal, asset, action, policy);
}

// ─── Default policies (reference) ─────────────────────────────────────

/**
 * Reference policy matching the IAM matrix used in apps/governance-vault/.
 * Agencies that customize this should clone-and-edit, not mutate in place.
 */
export const REFERENCE_AGENCY_POLICY: AccessPolicy = {
  version: "0.1.0",
  defaultDecision: "DENY",
  rules: [
    {
      id: "gestora-full-access",
      match: { principalRoles: ["gestora"] },
      decision: "ALLOW",
      reason: "Gestora is the sole owner of the overlay.",
    },
    {
      id: "analyst-read-most-axes",
      match: {
        principalRoles: ["analyst"],
        actions: ["read"],
        uriPattern: "**/{01 Identity,02 Policy,04 Decision,05 Memory,06 Audit}/**",
      },
      decision: "ALLOW",
      reason: "Analysts get read access to most axes for context.",
    },
    {
      id: "analyst-write-memory-only",
      match: {
        principalRoles: ["analyst"],
        actions: ["write"],
        uriPattern: "**/05 Memory/**",
      },
      decision: "ALLOW",
      reason: "Analysts may contribute to memory, but not policy or decisions.",
    },
    {
      id: "pii-redact-for-non-gestora",
      match: {
        classifications: ["PII-RESTRICTED"],
        principalRoles: ["analyst", "designer"],
        actions: ["read"],
      },
      decision: "ALLOW_REDACTED",
      redactSpec: { strategy: "cipher" },
      reason: "PII-RESTRICTED notes show ciphertext to non-gestora principals.",
    },
    {
      id: "external-no-access",
      match: { principalRoles: ["external"] },
      decision: "DENY",
      reason: "External principals get zero access to the overlay.",
    },
  ],
};

// ─── Versioning ───────────────────────────────────────────────────────

export const RLS_VERSION = "0.1.0-alpha.1";
