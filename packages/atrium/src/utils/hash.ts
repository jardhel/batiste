import { createHash } from 'node:crypto';

/** SHA-256 of `s`, returned as a lowercase hex string. */
export function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** First 16 hex chars of sha256 — short enough for IDs, ~64 bits of entropy. */
export function shortHash(s: string): string {
  return sha256(s).slice(0, 16);
}
