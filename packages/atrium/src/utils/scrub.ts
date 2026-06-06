/**
 * Secret scrubbing for content that lands in Firm Memory.
 *
 * Applied to user/assistant turns from session jsonl and to body text of
 * memory MD files before embedding. Conservative — over-scrub is preferable
 * to leaking a token into a vector index that may be queried by anyone with
 * read access to the deployment.
 *
 * The patterns cover the most common leak vectors. This is not a substitute
 * for proper credential management; it is a defense-in-depth layer.
 */

interface Pattern {
  name: string;
  re: RegExp;
  replacement: string;
}

const PATTERNS: Pattern[] = [
  { name: 'anthropic-key', re: /sk-ant-[A-Za-z0-9_-]{20,}/g, replacement: '[REDACTED:anthropic-key]' },
  { name: 'openai-key', re: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, replacement: '[REDACTED:openai-key]' },
  { name: 'google-api-key', re: /AIza[0-9A-Za-z_-]{35}/g, replacement: '[REDACTED:google-api-key]' },
  { name: 'github-token', re: /gh[pousr]_[A-Za-z0-9]{30,}/g, replacement: '[REDACTED:github-token]' },
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '[REDACTED:aws-key]' },
  { name: 'slack-token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/g, replacement: '[REDACTED:slack-token]' },
  { name: 'bearer-header', re: /Bearer\s+[A-Za-z0-9._-]{16,}/g, replacement: 'Bearer [REDACTED]' },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, replacement: '[REDACTED:jwt]' },
  { name: 'private-path', re: /\/private\/[^\s'"]+/g, replacement: '[REDACTED:private-path]' },
  { name: 'pem-block', re: /-----BEGIN[^-]+PRIVATE KEY-----[\s\S]*?-----END[^-]+PRIVATE KEY-----/g, replacement: '[REDACTED:private-key-block]' },
];

export interface ScrubResult {
  text: string;
  hits: Array<{ pattern: string; count: number }>;
}

export function scrub(input: string): ScrubResult {
  let text = input;
  const hits: Array<{ pattern: string; count: number }> = [];
  for (const { name, re, replacement } of PATTERNS) {
    const matches = text.match(re);
    if (matches && matches.length > 0) {
      hits.push({ pattern: name, count: matches.length });
      text = text.replace(re, replacement);
    }
  }
  return { text, hits };
}
