/**
 * limits.ts — auto-detect machine + Anthropic-tier limits.
 *
 * The Executor consults this module to size pools when the caller
 * passes `concurrency: 'auto'`. Keeping the heuristics here means a
 * future operator-config layer can override them in one place.
 */

import * as os from 'node:os';

export type AnthropicTier = '1' | '2' | '3' | '4' | 'enterprise';
export type AnthropicModel = 'opus' | 'sonnet' | 'haiku';

/** Public RPM limits per tier — see Anthropic console rate-limit page. */
const RPM_TABLE: Record<Exclude<AnthropicTier, 'enterprise'>, Record<AnthropicModel, number>> = {
  '1': { opus: 50, sonnet: 1000, haiku: 2000 },
  '2': { opus: 1000, sonnet: 2000, haiku: 4000 },
  '3': { opus: 2000, sonnet: 4000, haiku: 4000 },
  '4': { opus: 4000, sonnet: 8000, haiku: 8000 },
};

/**
 * @returns the published RPM limit for the given (model, tier) tuple,
 *          or `null` for `enterprise` / unknown tier (skip throttling).
 */
export function getRpmLimit(model: AnthropicModel, tier?: string): number | null {
  const resolved = (tier ?? process.env.ANTHROPIC_TIER ?? '1') as AnthropicTier;
  if (resolved === 'enterprise') return null;
  const row = RPM_TABLE[resolved as Exclude<AnthropicTier, 'enterprise'>];
  if (!row) return null;
  return row[model];
}

/**
 * Default CPU-bound concurrency: half the cores, min 1.
 * Half-the-cores is a deliberately conservative choice — leaves headroom
 * for the operator's editor, browser, and the LLM streaming itself.
 */
export function getCpuConcurrency(): number {
  const cpus = os.cpus()?.length ?? 1;
  return Math.max(1, Math.floor(cpus / 2));
}

/** Available memory in bytes; useful for future memory-aware scheduling. */
export function getAvailableMemoryBytes(): number {
  return os.freemem();
}

/**
 * Translate a published RPM into a steady-state concurrency cap, assuming
 * each in-flight LLM request takes ~`avgLatencyMs` (default 4s for Sonnet
 * tool-use). Caller can pass a model-specific latency.
 *
 * @returns positive integer or `null` if RPM is `null` (enterprise/skip).
 */
export function rpmToConcurrency(rpm: number | null, avgLatencyMs = 4000): number | null {
  if (rpm == null) return null;
  // requests per second * avg request duration (s) = steady in-flight count.
  const rps = rpm / 60;
  const inflight = Math.max(1, Math.floor((rps * avgLatencyMs) / 1000));
  return inflight;
}
