import { z } from 'zod';

/**
 * Token usage for a single inference, recorded from the provider API's own
 * `usage` payload — never an estimate.
 *
 * The `source` discriminator is a provenance gate: the schema only admits
 * values literally tagged `'api_usage'`, so a derived estimate (e.g. the
 * `chars / 4` heuristic that produced the discredited 82.9% benchmark) cannot
 * be laundered into the ledger as if it were measured. The cost ledger records
 * MEASURED tokens or nothing. Energy/CO₂ are deliberately absent here: they are
 * ESTIMATED downstream from these measured tokens, and conflating the two is
 * how greenwashing happens.
 */
export const TokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedTokens: z.number().int().nonnegative().optional(),
  modelId: z.string().min(1),
  provider: z.string().min(1),
  source: z.literal('api_usage'),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const AuditEntrySchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
  sessionId: z.string(),
  agentId: z.string(),
  tool: z.string(),
  args: z.record(z.unknown()),
  result: z.enum(['success', 'denied', 'error']),
  durationMs: z.number(),
  astNodesAccessed: z.number().optional(),
  bytesTransferred: z.number().optional(),
  // Present only when this entry corresponds to an LLM inference. Most tool
  // calls (file reads, grep, symbol lookup) consume zero inference tokens, so
  // the field is optional rather than mandatory — forcing a number on every
  // row would mean fabricating one, which is exactly the failure mode this
  // instrumentation exists to eliminate.
  usage: TokenUsageSchema.optional(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const KillCommandSchema = z.object({
  action: z.enum(['kill_session', 'kill_all', 'pause', 'resume']),
  sessionId: z.string().optional(),
  reason: z.string(),
});
export type KillCommand = z.infer<typeof KillCommandSchema>;
