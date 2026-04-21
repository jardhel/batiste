/**
 * Default deny-list for well-known secret paths.
 *
 * These patterns are unconditionally denied by every AccessPolicy unless
 * the operator explicitly replaces the default list. The list is a
 * belt-and-braces control on top of operator-supplied deniedPaths so
 * that a missing policy still blocks the most common exfiltration
 * targets.
 *
 * Rationale: the most common incident pattern in prompt-injection
 * attacks is an LLM convinced to read `~/.ssh/id_rsa`, `~/.aws/credentials`,
 * `.env` files, or `/etc/shadow`. Blocking these by default means an
 * operator has to opt **in** to exposing credentials, not opt **out**.
 *
 * Compliance:
 *   - ISO 27001 A.8.2 (privileged access rights)
 *   - ISO 27001 A.8.10 (information deletion / secret protection)
 *   - GDPR Art. 32(1)(b) (confidentiality of processing)
 *   - SOC 2 CC6.1 (logical access controls)
 *   - NIS2 Art. 21(2)(d) (supply-chain security / secrets hygiene)
 *
 * The list is intentionally conservative. False positives are cheaper
 * than credential leaks. Operators who need to read from e.g. a local
 * `.env.example` MUST add an explicit allow entry that specifies the
 * exact path, not a glob widening.
 */

export const SECRET_PATH_PATTERNS: readonly string[] = Object.freeze([
  // Environment files (all common variants and editor swap-files).
  '**/.env',
  '**/.env.*',
  '**/*.env',
  '**/*.env.*',
  '**/.envrc',
  '**/.env.local',
  '**/.env.production',
  '**/.env.development',
  '**/.env.*.local',

  // SSH / Git / GnuPG.
  '**/.ssh/**',
  '**/id_rsa',
  '**/id_rsa.pub',
  '**/id_ed25519',
  '**/id_ed25519.pub',
  '**/id_ecdsa',
  '**/id_ecdsa.pub',
  '**/id_dsa',
  '**/*.pem',
  '**/*.key',
  '**/*.p12',
  '**/*.pfx',
  '**/*.jks',
  '**/.gnupg/**',
  '**/authorized_keys',
  '**/known_hosts',

  // Cloud provider credentials.
  '**/.aws/credentials',
  '**/.aws/config',
  '**/.boto',
  '**/.azure/**',
  '**/.config/gcloud/**',
  '**/.config/doctl/**',
  '**/.kube/config',
  '**/.docker/config.json',
  '**/credentials',
  '**/credentials.json',

  // Common secret-file names and patterns.
  '**/*.secret',
  '**/*.secrets',
  '**/secrets.json',
  '**/secrets.yaml',
  '**/secrets.yml',
  '**/.netrc',
  '**/.pgpass',
  '**/.my.cnf',
  '**/.htpasswd',
  '**/service-account*.json',
  '**/service_account*.json',

  // POSIX system secrets (mostly unreadable without root but block anyway
  // so the attempt is visible in audit logs even when it would EACCES).
  '/etc/shadow',
  '/etc/gshadow',
  '/etc/passwd-',
  '/etc/sudoers',
  '/etc/sudoers.d/**',

  // Editor/IDE artefacts known to contain session tokens.
  '**/.idea/workspace.xml',
  '**/.vscode/settings.json',

  // Process/keychain state.
  '**/Library/Keychains/**',
  '**/login.keychain*',
  '**/System.keychain*',
  '**/.cargo/credentials',
  '**/.cargo/credentials.toml',
  '**/.npmrc',
  '**/.yarnrc',
  '**/.yarnrc.yml',
  '**/.gem/credentials',
  '**/.pypirc',
  '**/.pip/pip.conf',
  '**/.git-credentials',
  '**/.git/config',
]);

/**
 * Merge operator-supplied deniedPaths with the default secret list.
 *
 * The operator list is always applied; the defaults are appended so
 * they cannot be weakened — only extended. A duplicate pattern is
 * harmless; `micromatch` short-circuits on first match.
 */
export function mergeDeniedPaths(operatorPatterns: readonly string[] | undefined): string[] {
  const extra = operatorPatterns ?? [];
  return [...extra, ...SECRET_PATH_PATTERNS];
}
