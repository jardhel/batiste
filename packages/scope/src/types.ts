import { z } from 'zod';
import { SECRET_PATH_PATTERNS } from './secret-paths.js';

/**
 * Validation bounds for glob patterns and file paths.
 *
 * These caps protect against two attack classes:
 *
 *   1. Catastrophic-backtracking DoS — pathological globs like
 *      "**\/**\/**\/**\/**" or patterns with many nested quantifiers
 *      can explode under micromatch's regex translation. We cap
 *      length and count so the attack surface is bounded.
 *
 *   2. Memory exhaustion — a policy with 100 000 patterns could
 *      quietly consume megabytes of resident regex state. 1 024
 *      patterns is more than any realistic operator will configure.
 *
 * These bounds are declared here rather than deep in the matcher so
 * they are visible to auditors reading the types.ts entry point.
 *
 * Compliance: SOC 2 CC6.6 (restriction of information to authorised
 * users), ISO 27001 A.8.9 (configuration management).
 */
const MAX_PATTERN_LENGTH = 512;
const MAX_PATTERN_COUNT = 1024;
const MAX_PATH_LENGTH = 4096; // matches Linux PATH_MAX on most kernels

const GlobPattern = z
  .string()
  .min(1, 'glob pattern cannot be empty')
  .max(MAX_PATTERN_LENGTH, `glob pattern exceeds ${MAX_PATTERN_LENGTH} chars`)
  .refine((p) => !p.includes('\0'), 'glob pattern contains NUL byte')
  // Reject patterns whose regex translation would be cartesian-explosive.
  // A "**" count above 8 is more than enough for any legitimate use-case.
  .refine((p) => (p.match(/\*\*/g) ?? []).length <= 8, 'glob pattern contains >8 "**" segments (DoS guard)');

export const AccessPolicySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(128),
  allowedPaths: z.array(GlobPattern).max(MAX_PATTERN_COUNT),
  deniedPaths: z.array(GlobPattern).max(MAX_PATTERN_COUNT).default([...SECRET_PATH_PATTERNS]),
  allowedSymbolTypes: z
    .array(z.enum(['function', 'class', 'interface', 'type', 'variable', 'import']))
    .optional(),
  maxDepth: z.number().int().nonnegative().max(64).default(10),
  includeTests: z.boolean().default(false),
});
export type AccessPolicy = z.infer<typeof AccessPolicySchema>;

/**
 * Path-length validator exported so callers outside the policy
 * definition (for example, the `ScopedHandler` at dispatch time) can
 * enforce the same bound uniformly.
 */
export function assertValidPath(path: unknown): asserts path is string {
  if (typeof path !== 'string') {
    throw new TypeError('path must be a string');
  }
  if (path.length === 0 || path.length > MAX_PATH_LENGTH) {
    throw new RangeError(`path length out of range (1..${MAX_PATH_LENGTH})`);
  }
  if (path.includes('\0')) {
    throw new RangeError('path contains NUL byte');
  }
}

export const SCOPE_LIMITS = Object.freeze({
  MAX_PATTERN_LENGTH,
  MAX_PATTERN_COUNT,
  MAX_PATH_LENGTH,
});
