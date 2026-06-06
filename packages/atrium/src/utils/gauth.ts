/**
 * Google OAuth helper — scope-flexible from day one.
 *
 * Per ADR-0002 + the v1.3 ingestion plan: every Google-side connector
 * (`ingest drive` now, `ingest gmail` / `ingest calendar` / `ingest sheets`
 * later) must reuse the SAME OAuth refresh token in the operator's
 * keychain, adding scopes incrementally rather than triggering a fresh
 * consent screen per connector. This is Google's "incremental
 * authorization" pattern: ask for the minimum upfront, request more on
 * demand, store the merged grant.
 *
 * Implementation choice: zero-dep. We talk to Google's token endpoint
 * directly via `fetch`, and the access-token cache + refresh logic lives
 * here — no `googleapis` SDK pulled in. The Drive client (and any future
 * Google connector) simply asks `getGoogleClient(scopes)` for an object
 * that exposes `fetch(url, init)` with `Authorization: Bearer ...`
 * already set.
 *
 * Storage: Keychain account `google-oauth-token` (one record holding the
 * JSON blob with refresh_token + granted scopes), with a token-file
 * fallback at `~/.batiste/secrets/google.token.json` for non-darwin
 * platforms or operators who explicitly opt out of Keychain.
 *
 * Acquisition is OUT OF SCOPE for this helper — v1.3 expects the
 * operator to run a one-time bootstrap (`gauth bootstrap`, future) to
 * seed the keychain entry. Until that exists, drive ingestion runs in
 * `--fixture` mode for the design-as-code demo.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { getSecret, setSecret } from './keychain.js';

export const GOOGLE_OAUTH_KEYCHAIN_ACCOUNT = 'google-oauth-token';
export const GOOGLE_TOKEN_FILE = join(homedir(), '.batiste', 'secrets', 'google.token.json');
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

export interface StoredGoogleToken {
  /** Long-lived refresh token returned by the original OAuth consent. */
  refresh_token: string;
  /** OAuth client_id used to mint refresh_token (same client must refresh). */
  client_id: string;
  /** OAuth client_secret matching client_id. */
  client_secret: string;
  /** Whitespace-separated list of scopes that have been granted. */
  scope: string;
  /** ISO timestamp when this record was last updated. */
  updated_at: string;
}

export interface GoogleClient {
  /**
   * Authenticated fetch — caller passes a Google API URL and any init,
   * we inject `Authorization: Bearer <access_token>`. Refreshes the
   * access token transparently on 401.
   */
  fetch(url: string, init?: RequestInit): Promise<Response>;
  /** The set of scopes the underlying refresh token has been granted. */
  grantedScopes(): string[];
}

/**
 * Best-effort load of the stored OAuth record. Tries Keychain first
 * (preferred — disk-encrypted at rest by the OS), falls back to the
 * `~/.batiste/secrets/google.token.json` file.
 */
export async function loadStoredToken(): Promise<StoredGoogleToken | null> {
  const fromKeychain = await getSecret(GOOGLE_OAUTH_KEYCHAIN_ACCOUNT);
  if (fromKeychain) {
    try {
      return JSON.parse(fromKeychain) as StoredGoogleToken;
    } catch {
      // fall through to file
    }
  }
  if (existsSync(GOOGLE_TOKEN_FILE)) {
    try {
      const raw = await readFile(GOOGLE_TOKEN_FILE, 'utf8');
      return JSON.parse(raw) as StoredGoogleToken;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Persist the OAuth record. Writes to Keychain if available; ALWAYS also
 * writes the token file as a recoverable backup (the operator may switch
 * machines). The file is mode 0600.
 */
export async function saveStoredToken(token: StoredGoogleToken): Promise<void> {
  const serialized = JSON.stringify(token, null, 2);
  try {
    await setSecret(GOOGLE_OAUTH_KEYCHAIN_ACCOUNT, serialized);
  } catch {
    // non-darwin or Keychain unavailable; fall back to file only
  }
  await mkdir(dirname(GOOGLE_TOKEN_FILE), { recursive: true });
  await writeFile(GOOGLE_TOKEN_FILE, serialized + '\n', { encoding: 'utf8', mode: 0o600 });
}

interface AccessTokenCache {
  access_token: string;
  expires_at: number; // epoch ms
}

async function refreshAccessToken(stored: StoredGoogleToken): Promise<AccessTokenCache> {
  const params = new URLSearchParams({
    client_id: stored.client_id,
    client_secret: stored.client_secret,
    refresh_token: stored.refresh_token,
    grant_type: 'refresh_token',
  });
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token refresh failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error('Google token response missing access_token');
  }
  const ttl = (data.expires_in ?? 3600) * 1000;
  return {
    access_token: data.access_token,
    // refresh 60s before actual expiry to dodge boundary-flake 401s
    expires_at: Date.now() + ttl - 60_000,
  };
}

/**
 * Get an authenticated Google client for the requested scopes.
 *
 * MUST be called with the union of every scope the caller intends to
 * use. If the stored refresh token's grant doesn't cover one of the
 * requested scopes, this throws with a setup hint — the operator needs
 * to re-run the bootstrap consent flow to add the new scope (Google's
 * incremental auth UX) before the connector can proceed.
 *
 * The client itself is stateless aside from an in-memory access-token
 * cache; the heavy refresh-token credential stays in Keychain.
 */
export async function getGoogleClient(scopes: string[]): Promise<GoogleClient> {
  const stored = await loadStoredToken();
  if (!stored) {
    throw new Error(
      'Google OAuth token not configured. ' +
      'Bootstrap one-time consent (planned: `batiste-fm gauth bootstrap`) or ' +
      `seed ${GOOGLE_TOKEN_FILE} with a JSON record { client_id, client_secret, refresh_token, scope }.`,
    );
  }
  const grantedScopes = stored.scope.split(/\s+/).filter((s) => s.length > 0);
  const missingScopes = scopes.filter((s) => !grantedScopes.includes(s));
  if (missingScopes.length > 0) {
    throw new Error(
      'Google OAuth token is missing requested scopes: ' + missingScopes.join(', ') + '. ' +
      'Re-run consent to grant incrementally; the existing refresh_token will be re-issued ' +
      'with the union of scopes (Google\'s incremental authorization).',
    );
  }

  let cache: AccessTokenCache | null = null;

  async function ensureAccessToken(): Promise<string> {
    if (cache && cache.expires_at > Date.now()) return cache.access_token;
    cache = await refreshAccessToken(stored as StoredGoogleToken);
    return cache.access_token;
  }

  return {
    grantedScopes(): string[] {
      return [...grantedScopes];
    },
    async fetch(url: string, init: RequestInit = {}): Promise<Response> {
      const token = await ensureAccessToken();
      const headers = new Headers(init.headers ?? {});
      headers.set('Authorization', `Bearer ${token}`);
      let res = await fetch(url, { ...init, headers });
      if (res.status === 401) {
        // forced refresh on a stale token (cache was within window but
        // server rejected — clock skew, or revoked-and-reissued)
        cache = await refreshAccessToken(stored as StoredGoogleToken);
        const headers2 = new Headers(init.headers ?? {});
        headers2.set('Authorization', `Bearer ${cache.access_token}`);
        res = await fetch(url, { ...init, headers: headers2 });
      }
      return res;
    },
  };
}
