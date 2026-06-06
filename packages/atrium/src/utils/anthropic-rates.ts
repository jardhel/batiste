/**
 * Approximate Anthropic API list-pricing per 1M tokens (USD).
 *
 * These numbers drive the cost-estimate column in `batiste-fm token-report`.
 * They are APPROXIMATE — the published list pricing changes occasionally
 * and enterprise contracts (which most Cachola Tech deployments will be
 * on) negotiate different rates. The token-report subcommand documents
 * this caveat in its human-readable footer; verify on
 * https://www.anthropic.com/pricing before quoting numbers externally.
 *
 * The shape mirrors the four `message.usage` fields that Claude Code
 * writes to its session jsonls:
 *   - input_tokens                → `input`
 *   - cache_read_input_tokens     → `cacheRead`        (10% of input rate)
 *   - cache_creation_input_tokens → `cacheCreate`      (1.25x input rate, 5-min TTL writes)
 *   - output_tokens               → `output`
 */

export interface AnthropicRates {
  /** Standard input tokens. */
  input: number;
  /** Cache hit reads — billed at ~10% of input. */
  cacheRead: number;
  /** Cache writes — billed at ~125% of input (5-min TTL). */
  cacheCreate: number;
  /** Output (completion) tokens. */
  output: number;
}

/**
 * Default rates used by `batiste-fm token-report`. Numbers reflect the
 * Claude 3.5 / Claude Opus 4.7 family list pricing as of early 2026.
 * Override by passing a custom rate table to `summarize()` if you have
 * a negotiated enterprise discount.
 */
export const RATES: AnthropicRates = {
  input: 15.0,
  cacheRead: 1.5,
  cacheCreate: 18.75,
  output: 75.0,
};
