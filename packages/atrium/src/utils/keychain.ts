/**
 * macOS Keychain wrapper.
 *
 * Atrium credential storage strategy (per ADR-0002 + project memory
 * `project_first_enterprise_contract.md`): tokens used by ingestion
 * connectors live in the operator's macOS login keychain, NOT in env files
 * checked into a repo. We shell out to the system `security` CLI rather
 * than binding to a native module so the package stays zero-dep and works
 * inside any Node 18+ environment without rebuilds.
 *
 * Layered resolution at the call site:
 *   1. process.env[VAR]           — explicit operator override / CI
 *   2. await getSecret(account)   — macOS Keychain (`security`)
 *   3. fail with setup hint       — connector tells operator how to fix
 *
 * The shared service name (`cachola-tech-batiste-fm`) keeps every
 * Batiste-managed secret discoverable in Keychain Access.app under one
 * label so an operator can audit / revoke in one place.
 *
 * Non-darwin platforms: `getSecret` returns null (callers fall back to
 * env vars or surface a setup error); `setSecret` throws.
 */

import { spawn } from 'node:child_process';
import { platform } from 'node:os';

export const KEYCHAIN_SERVICE = 'cachola-tech-batiste-fm';

function isDarwin(): boolean {
  return platform() === 'darwin';
}

interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

function execCapture(cmd: string, args: string[], stdin?: string): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.on('error', () => resolve({ code: -1, stdout, stderr }));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
    if (stdin !== undefined) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

/**
 * Read a secret from Keychain by account name. Returns null when the
 * platform is not darwin OR when the secret is not present, so callers
 * can chain through env-then-keychain-then-error gracefully.
 */
export async function getSecret(account: string): Promise<string | null> {
  if (!isDarwin()) return null;
  const res = await execCapture('security', [
    'find-generic-password',
    '-s', KEYCHAIN_SERVICE,
    '-a', account,
    '-w',
  ]);
  if (res.code !== 0) return null;
  // `-w` prints the password followed by a newline.
  return res.stdout.replace(/\n$/, '');
}

/**
 * Write (or update — `-U`) a secret in Keychain. Throws on non-darwin
 * platforms with a clear message rather than silently no-op'ing — this
 * is the write path, so silent failure would lose the operator's input.
 */
export async function setSecret(account: string, secret: string): Promise<void> {
  if (!isDarwin()) {
    throw new Error(
      'Keychain write is only supported on macOS. ' +
      'Use environment variables (TRELLO_KEY, TRELLO_TOKEN, GOOGLE_OAUTH_TOKEN) on this platform.',
    );
  }
  const res = await execCapture('security', [
    'add-generic-password',
    '-U',
    '-s', KEYCHAIN_SERVICE,
    '-a', account,
    '-w', secret,
  ]);
  if (res.code !== 0) {
    throw new Error(
      `security add-generic-password failed (code ${res.code}): ${res.stderr.trim() || 'no stderr'}`,
    );
  }
}

/**
 * Convenience: resolve a secret following the env-first, keychain-second,
 * null-third chain that every connector wants.
 *
 * `keychain:<account>` syntax in env vars is also supported — it lets an
 * operator write `TRELLO_TOKEN=keychain:trello-token` in `.envrc` to
 * indirect through Keychain without leaking the literal token into shell
 * history or process listings.
 */
export async function resolveSecret(envVar: string, keychainAccount: string): Promise<string | null> {
  const fromEnv = process.env[envVar];
  if (fromEnv && fromEnv.length > 0) {
    if (fromEnv.startsWith('keychain:')) {
      const account = fromEnv.slice('keychain:'.length);
      return getSecret(account);
    }
    return fromEnv;
  }
  return getSecret(keychainAccount);
}
