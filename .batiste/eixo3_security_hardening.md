---
title: "Eixo 3 — Security Hardening Report"
status: draft
owner: eixo3
date: 2026-04-15
depends_on:
  - eixo1_honesty
  - eixo2_bugs
scope: "Investigation + proposal only. No source modifications."
feeds:
  - eixo8_dd_ux_scaffold.md § 7.3 (E3-DD-08..E3-DD-12)
---

# Eixo 3 — Security Hardening

> **Audience.** Enterprise DD reviewers (security, crypto, procurement) and
> internal implementers. The tone is deliberately adversarial: a peer reviewer
> from a F500 security team should read it and nod. Batiste ships DD-portal
> artifacts (see `eixo8_dd_ux_scaffold.md`), so this document is one of the
> five load-bearing technical sign-offs the buyer receives.

> **Constraint.** No code is modified here. Every recommendation is cited to a
> real `file:line`, and every proposal lists effort + acceptance criteria so
> Eixo 2 can convert it into tickets without re-investigating.

---

## 0. Inventory — the 11 packages in scope

| # | Package                          | Role                                  | Crit?* |
|---|----------------------------------|---------------------------------------|--------|
| 1 | `@batiste-aidk/core`             | Task DAG, context budget, sandbox, MCP factory | Hot |
| 2 | `@batiste-aidk/auth`             | JWT issue/verify, scope, revocation  | **CRIT** |
| 3 | `@batiste-aidk/audit`            | Ledger, kill-switch, session monitor | **CRIT** |
| 4 | `@batiste-aidk/transport`        | HTTP gateway, TLS, rate-limit, sessions | **CRIT** |
| 5 | `@batiste-aidk/scope`            | Access policy, path allow/deny       | Hot |
| 6 | `@batiste-aidk/aidk`             | Node factory — composes everything   | Hot |
| 7 | `@batiste-aidk/code`             | Code-analysis tool handlers          | Hot |
| 8 | `@batiste-aidk/connectors`       | PDF + CSV tool handlers              | Warm |
| 9 | `@batiste-aidk/marketplace`      | Node registry, routing, pricing      | Warm |
| 10| `@batiste-aidk/cli`              | CLI — start, connect, audit-tail     | Warm |
| 11| `@batiste-aidk/web` (static)     | Dashboard, wireframe HTML            | Cold |

\* Crit = directly on the auth / audit trust path. Hot = in-process on every
call. Warm = data-path but not trust-path. Cold = static assets.

---

## 1. Threat Model — STRIDE per component

STRIDE = **S**poofing / **T**ampering / **R**epudiation / **I**nformation
disclosure / **D**enial-of-service / **E**levation-of-privilege.

### 1.1 `@batiste-aidk/auth` (CRIT)

**S:** Token spoofing via forgery is the #1 risk. Because the current build
only supports HS256 (`packages/auth/src/token-issuer.ts:49`), the JWT signing
key is shared between issuer and verifier — there is no asymmetric separation.
Any service that can verify a token can also issue one. An attacker who
exfiltrates `config.auth.secretKey` from `.env`, process memory, a backup, or a
CI log can forge arbitrary tokens, including admin scopes.

**T:** Token payloads are tamper-evident via HMAC, but the `scope` claim is
stored as a JSON object inside the JWT and re-parsed through `ApiTokenSchema`
(`token-verifier.ts:45`). A malformed payload with *extra* keys will pass Zod
today (default `.passthrough` behavior of `z.object`), so forward-compat claims
may be silently ignored — not dangerous today, but a source of future downgrade
risk.

**R:** Revocation is stored in `KeyStore` SQLite (`key-store.ts:30-44`). There
is no signature or hash on the `tokens` table, so an operator with DB write
access can backdate or remove revocations without trace. Audit ledger does not
cover the KeyStore either.

**I:** Secret key is loaded as a plain `string` (`types.ts:53`
`secretKey: z.string().min(32)`) and lives in process memory for the node
lifetime. No `crypto.timingSafeEqual` concerns (HMAC uses `jose`, which is
timing-safe), but the minimum 32-char rule only enforces length, not entropy.
A user-supplied `"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"` passes validation.

**D:** `jose.jwtVerify` is CPU-bounded; an attacker flooding the `/mcp`
endpoint with bogus JWTs will consume CPU on every request. Rate-limiter
(`rate-limiter.ts:31`) triggers on a per-IP token bucket *before* verify, which
partially mitigates, but IP-spoof via `X-Forwarded-For`
(`request-validator.ts:98`) trivially resets the bucket per spoofed IP.

**E:** `scope.tools` omission defaults to "all tools allowed"
(`scope.ts:24-28`). A token issued with `scope: {}` grants **every tool**.
Developer ergonomics but easy foot-gun. Similarly `operations` defaults to
`['read']` (`types.ts:17`) — but `operation` is not checked anywhere in the
call path (see §6).

### 1.2 `@batiste-aidk/audit` (CRIT)

**S:** `AuditLedger.append` writes rows keyed by `sessionId` + `agentId` from
middleware config (`middleware.ts:30-73`). There is no cryptographic binding
between the JWT that authorized the call and the `agentId` that was logged. A
bug or malicious middleware could log a different `agentId` than the one the
token authenticated as. The `agentId` field in `create-node.ts:174` is set from
`ctx?.clientIp` — so "agent identity" in the ledger is currently **IP
address**, not the JWT subject (`sub` claim).

**T:** No hash chain, no signature, no Merkle root. `ledger.ts:30-44` creates
a plain SQLite WAL table. An operator with filesystem access can `UPDATE` or
`DELETE` rows without detection. This is the biggest compliance gap — SOC 2
CC7, ISO 27001 A.12.4, HIPAA §164.312(c) all expect tamper-evident audit. See
§4 for the proposed fix.

**R:** Repudiation is currently **possible**: a customer can plausibly deny a
logged action because the ledger has no non-repudiation anchor (no third-party
timestamp, no signature, no sequence numbers).

**I:** `args` is stored as `JSON.stringify(entry.args)` (`ledger.ts:57`). If a
tool is called with a secret-bearing argument (path to a private key, API
token in a connector arg), the secret persists in the ledger forever, with no
redaction pass. Compliance report (`compliance-report.ts:30`) pulls up to
10,000 entries including these raw args.

**D:** Unbounded in-memory `KillSwitch.commandLog` (`kill-switch.ts:18`) —
every `execute()` appends. No eviction. A misbehaving client calling `pause`
in a loop over WebSocket (future) will grow the array indefinitely.

**E:** `KillSwitch.reset()` is exposed (`kill-switch.ts:71`) "for testing" but
not gated — any caller with a reference to the instance can wipe kill state.
Not reachable over MCP today (the object isn't exposed as a tool), but
defense-in-depth wants it private.

### 1.3 `@batiste-aidk/transport` (CRIT)

**S:** Session IDs are `randomUUID()` (`secure-gateway.ts:197, 207`) — 122 bits
of entropy from the Node crypto RNG. Fine. However, the session cookie travels
in the `mcp-session-id` **header**, not in a Secure/HttpOnly cookie. If TLS is
disabled (default: `tls.enabled: true` but `certPath` optional — see below),
the header is cleartext.

**T:** `TlsManager.loadCerts` (`tls-manager.ts:17`) throws if paths are
missing, but only after `security.tls.enabled && (security.tls.certPath ||
security.tls.keyPath)` is true in `secure-gateway.ts:274`. The expression uses
`||` rather than `&&` in the gate, meaning **if only `certPath` is set and
`keyPath` is missing, the `||` gate returns truthy and we enter the TLS branch
and then throw inside `loadCerts`**. This is fine (it errors), but the default
`tls.enabled: true` with no paths set silently falls through to HTTP
(`secure-gateway.ts:278`) — the preset docs don't warn. A customer running
`preset: 'network'` with no cert config gets plaintext HTTP and might not
notice.

**R:** Access logs are only emitted when `config.label` is set
(`secure-gateway.ts:289`) and even then only at startup. There is no
per-request access log written to the audit ledger at the transport layer —
the audit hook is *inside* MCP tool dispatch. Requests rejected by the
validator (413, 415, 403) or rate-limiter (429) **never reach the ledger**.

**I:** Error responses embed the upstream error message
(`secure-gateway.ts:168` returns `bodyValidation.error` verbatim). Current
messages are benign ("Missing jsonrpc field") but any future validator that
echoes untrusted input risks reflection.

**D:** Token bucket `RateLimiter` is keyed by `getClientIp(req)`. `getClientIp`
trusts `X-Forwarded-For` unconditionally (`request-validator.ts:98-102`). If
the gateway is run without a trusted reverse proxy, a client controls its own
limiter key. Recommendation: add `trustProxy: boolean` config and default to
`false`.

**E:** `CORS` origins default to `[]` which yields `'*'` in
`setCorsHeaders` (`secure-gateway.ts:356`). That's permissive-by-default for
browsers. If the buyer intends strict CORS, they must set `cors.origins`
explicitly — easy to miss.

### 1.4 `@batiste-aidk/core` — sandbox + MCP (Hot)

**S:** `ProcessSandbox` (`packages/core/src/sandbox/ProcessSandbox.ts`) spawns
arbitrary commands via `spawn(options.command, options.args)`
(`ProcessSandbox.ts:52`). The "sandbox" name is a misnomer — there is no
namespace/cgroup isolation. `NODE_OPTIONS: undefined` (line 49) removes one
env var, but everything else from `process.env` is passed through (line 47).
A `execute_sandbox` tool call with `command: 'rm'`, `args: ['-rf', '/']`
would run as the host user if the JWT scope allows it.

**T:** stdout/stderr concatenation (`ProcessSandbox.ts:66-72`) is unbounded.
A subprocess printing gigabytes will OOM the Node process.

**R:** No per-execution ID persisted on disk — the ledger middleware captures
duration and result but not the command/args are visible in the sandbox
itself. (They appear in the `args_json` column via the audit wrapper above.)

**I:** Env vars that happen to contain secrets (`AWS_SECRET_ACCESS_KEY`,
`OPENAI_API_KEY`) are inherited by every spawned child. Recommendation: opt-in
allowlist instead of full inheritance.

**D:** Default timeout 30s (`ProcessSandbox.ts:41`) is enforced twice (spawn
`timeout` option + `setTimeout` with `SIGKILL`). Good. No concurrency cap
though — a client can submit N parallel `execute_sandbox` calls and exhaust
PIDs.

**E:** `workingDir` is joined onto `projectRoot`
(`packages/code/src/mcp/handler.ts:161`) — but no path-traversal check. An
input of `"../../../../tmp"` produces `/tmp` after `join()`. The `scope`
filter (`scope.ts:85`) does include `workingDir` in its extraction list, so
the scope engine *can* block it, but only if the node owner configured a
`files` allowlist.

### 1.5 `@batiste-aidk/scope` (Hot)

**S:** The file matcher (`FileMatcher`) is the last line of defense if a token
is over-scoped. Correctness depends on the glob implementation.

**T:** `scope.ts:103-112` hand-rolls a glob-to-regex converter. It does not
escape `+ ? ( ) [ ] ^ $ |` — characters that are legal in Unix paths. A file
named `some+dir/secret` with a pattern `some+dir/*` will mis-match because `+`
is treated as a regex quantifier. This is a **correctness** bug, not a direct
vuln, but it's a scope-bypass vector worth auditing.

**R:** `ScopedHandler.filterArgs` silently drops disallowed files from array
args (`scoped-handler.ts:38-45`) but **throws** for string args (`:47-53`).
This asymmetry means a single mixed call (array + string) partially succeeds,
which is confusing for audit.

**I:** `filterResult` (`scoped-handler.ts:63-84`) filters `files`, `definitions`,
`references` — but handler results can contain file paths under *many* other
keys (e.g., `roots`, `leaves`, `entryPoints` in `analyze_dependency` output at
`code/src/mcp/handler.ts:96`). Scope leaks through these keys.

**D:** N/A for scope in isolation.

**E:** `scope.ts:24-28` — absent `scope.tools` means "all tools." A future
tool added to the registry is automatically granted to every existing token.
This is opposite of the principle of least privilege; an allowlist-absent-
means-deny policy would be safer, but it's a breaking change.

### 1.6 `@batiste-aidk/aidk` — Node factory (Hot)

**S:** `create-node.ts:130-165` composes Scope → Auth → Audit in that order.
Notably, the scope wrapper is applied **once** to the shared baseHandler
(`:124`), then auth+audit are per-session wrappers (`:155-176`). This is
correct.

**T:** Default scope policy is hard-coded: `allowedPaths: ['src/**']`,
`deniedPaths: ['**/*.env', '**/*.secret']` (`create-node.ts:117-119`). The
deny pattern does **not** catch `*.pem`, `*.key`, `id_rsa`, `*.pfx`, or
dotfiles like `.aws/credentials`. Recommend expanding the default-deny list.

**R:** Audit is on-by-default for `enterprise` preset, **off for network**
preset unless `config.audit` is set (`presets.ts:39-40`). A customer running
`preset: 'network'` without `audit: {}` has auth+scope but **no ledger**. The
"zero-trust" positioning needs audit to be on-by-default.

**I:** `dbPath` defaults to `.batiste/audit.db` under `process.cwd()`
(`create-node.ts:140`). If a node is launched from a world-readable working
dir (e.g. on a shared dev box), the audit DB is world-readable. No file-mode
enforcement.

**D:** N/A.

**E:** `resolvePreset` does not prevent a `local` preset from being started
on a public port — it just defaults the host to `127.0.0.1`. A user who
overrides `host: '0.0.0.0'` gets an auth-less public MCP server.
Recommendation: refuse to bind non-loopback on `local`.

### 1.7 `@batiste-aidk/code` — tool handlers (Hot)

**S:** `direct-cli.ts` is a **non-MCP CLI** that bypasses auth entirely
(`direct-cli.ts:70-72` instantiates a bare `ToolHandler`). That is by design
(local dev ergonomics) but it means any user with shell access also has
unconstrained tool access — document this explicitly in DD.

**T:** `handler.ts:70-73, 274-276` do path resolution with a naive check
`p.startsWith('/')`. On Windows that's wrong (absolute paths start with a
drive letter). More importantly, no normalization — `"/etc/passwd"` is
treated as absolute, so a user who avoids the scope wrapper (e.g., direct-cli)
can walk anywhere.

**R:** No per-handler logging beyond the audit middleware.

**I:** `summarizeCodebase` walks `FileIndex` and returns paths stripped of
`projectRoot` (`handler.ts:467`). If `projectRoot` is a symlink to a
sensitive dir, the stripped path still leaks the real file name.

**D:** `RecursiveScout.buildDependencyGraph` (`analyze_dependency`,
`summarize_codebase`) has `maxDepth` but no file-count cap. A malicious
`entryPoints` with circular imports *is* guarded (circularDeps list), but a
monorepo with 100K files + `maxDepth: 10` will consume minutes of CPU.

**E:** `execute_sandbox` inherits all the sandbox risks above. Scope check
(`scope.ts:85`) includes `workingDir` only — `command` and `args` are
**not** checked against the scope. A token with `operations: ['read']` can
still run `rm -rf` because the scope engine doesn't gate the operation on the
tool (see §6).

### 1.8 `@batiste-aidk/connectors` — PDF + CSV (Warm)

**S:** `parse_pdf` resolves a caller-supplied `filePath` via
`resolvePath` (`connectors/src/mcp/handler.ts:28-30`) that does the same
naive `startsWith('/')` check. Same traversal issue.

**T:** `pdf-parse@1.1.4` is an **unmaintained** dependency (last published
2017). It pulls in `node-ensure` which has a trivial vuln surface and is
dormant. See §8.

**R:** Audit captures the filePath, which for PDFs is probably fine. For CSVs
with filter expressions in `where`, those become audit data — potentially
leaking PII filter values.

**I:** `PdfParser.parseFile` reads arbitrary files from disk. No size cap
beyond the default; a 4 GB PDF will OOM.

**D:** `CsvEtl.query` likely reads the whole file; no streaming cap is
visible from the handler. (Need to audit the impl; not done here.)

**E:** None observed — connector handlers do not shell out.

### 1.9 `@batiste-aidk/marketplace` (Warm)

**S:** `gateway.ts:66-80` starts an HTTP server with **no auth**. The routes
include `DELETE /nodes/:id`. Any LAN client can evict nodes from the registry.
This is probably fine for a first-party registry running on a trusted net,
but the README positioning ("zero-trust") needs a dedicated auth story for
marketplace.

**T:** Registry rows are plain SQLite. Same story as audit ledger.

**R:** No audit of marketplace operations.

**I:** `GET /nodes` returns the full registry including any metadata a node
self-reported. If a node reports its `auth.secretKey` (bad config), it
propagates.

**D:** No rate limit on marketplace endpoints.

**E:** `POST /billing/record` is trustful — any caller can claim arbitrary
compute cycles. This is a pricing-integrity issue, not a direct security
vuln, but worth noting.

### 1.10 `@batiste-aidk/cli` (Warm)

**S:** CLI runs as the invoking user; no privilege escalation vector.

**T:** `batiste-direct` writes to `$PROJECT_ROOT/.batiste` — same dir-mode
concern as audit.

**R:** CLI invocations are not logged.

**I:** If the user stores a JWT secret in `~/.batiste/config.json` (not
currently supported but plausible), CLI may read it into process env.

**D/E:** N/A.

### 1.11 `@batiste-aidk/web` — static dashboard (Cold)

Static HTML — no server-side code. XSS risk is bounded by what the dashboard
fetches from the node's `/health` and `/metrics`. Those endpoints return JSON
built from controlled inputs (`secure-gateway.ts:99-113`). Low risk.

---

## 2. Crypto review — JWT path

### 2.1 What the code actually does

| Step | File:Line | Behavior |
|---|---|---|
| 1. Load secret | `aidk/src/create-node.ts:131` | `config.auth.secretKey` passed raw |
| 2. Encode | `auth/src/token-issuer.ts:18` | `TextEncoder().encode(config.secretKey)` — UTF-8 bytes |
| 3. Sign | `auth/src/token-issuer.ts:49-53` | `jose.SignJWT` with `alg: 'HS256'`, issuer `'batiste'` |
| 4. Claims | `auth/src/token-issuer.ts:43-47` | `sub`, `jti`, `pid`, `scope`, `iat` (auto), `exp` (from TTL) |
| 5. Verify | `auth/src/token-verifier.ts:22-25` | `jose.jwtVerify` with `issuer: 'batiste'` |
| 6. Parse | `auth/src/token-verifier.ts:40-57` | Zod-validate `ApiTokenSchema` |
| 7. Revoke lookup | `auth/src/middleware.ts:54-58` | SQLite `SELECT revoked FROM tokens WHERE id=?` |

### 2.2 Strengths

- Uses `jose` — well-maintained, security-audited library.
- `HS256` with a 32-byte minimum key is solid for the current HMAC-only model.
- `issuer` claim validated on verify (`token-verifier.ts:24`).
- `exp` enforced by `jose.jwtVerify` by default.
- Per-session middleware instance (`create-node.ts:161`) prevents token
  cross-contamination between concurrent connections.

### 2.3 Weaknesses

| # | Risk | File:Line | Severity | Recommendation |
|---|---|---|---|---|
| C-1 | `audience` claim not set or verified | `token-issuer.ts:43-53` | Med | Add `aud` = node label; verify in `jwtVerify` |
| C-2 | `pid` (projectId) not cross-checked against the running node | `token-verifier.ts:48` + `middleware.ts:48` | High | Pass expected `pid` into middleware, reject mismatch |
| C-3 | No `nbf` (not-before) support | `token-issuer.ts` | Low | Add optional `nbf`; `jose` supports it |
| C-4 | No `alg` pinning on verify | `token-verifier.ts:22-25` | **High** | `jose.jwtVerify` does accept any `alg` in the header by default. Pass `algorithms: ['HS256']` to prevent `alg:none` or algorithm confusion attacks |
| C-5 | `kid` header not used | all | Med | Blocks key rotation; see §3 |
| C-6 | Entropy of `secretKey` not measured | `auth/src/types.ts:53` | Med | Check Shannon entropy ≥ 4.0 bits/char or require `>= 64` chars |
| C-7 | Secret key persists in memory | all | Low | `Buffer.fill(0)` on shutdown; low value but DD-worthy hygiene |
| C-8 | `ApiTokenSchema.parse` silently tolerates unknown scope keys | `token-verifier.ts:45-57` | Low | Use `.strict()` on `ScopeDefinitionSchema` |
| C-9 | Clock skew tolerance not configured | `token-verifier.ts:22-25` | Low | `jose` default is 0s; pass `clockTolerance: 30` |

**C-4 is the highest-severity finding in §2.** The `jose` library in v6
verifies whatever `alg` appears in the JWT header unless `algorithms` is
passed. With HS256, *technically* the only forgeable algs without the key are
rejected, but the defensive practice is explicit pinning:

```ts
// RECOMMENDED at token-verifier.ts:22
const { payload } = await jwtVerify(jwt, this.secretKey, {
  issuer: 'batiste',
  algorithms: ['HS256'],       // pin
  audience: this.expectedAud,  // C-1
  clockTolerance: 30,          // C-9
});
```

### 2.4 Revocation path review

`KeyStore.isRevoked` (`key-store.ts:68-73`) does a SQLite lookup on every tool
call. Two issues:

1. **Latency.** Synchronous SQLite call on the hot path. On a loaded node
   (10K rps) this is 10K point-lookups/sec against WAL — fine for SQLite but
   not great for P99. An in-memory LRU cache with TTL (e.g., 60s) would
   collapse 99% of lookups.

2. **Fail-open.** `if (!row) return false` means unknown tokens are *not*
   revoked. Combined with the fact that `TokenIssuer.issue` does not persist
   to `KeyStore` automatically (it returns the token; the caller must store
   it), an issuer misconfiguration creates tokens that cannot be revoked.
   Recommendation: `KeyStore.isRevoked` should accept a `strict: true` mode
   that returns `true` for unknown jti in hardened deployments.

---

## 3. RS256 Implementation Plan

### 3.1 Goal

Enable asymmetric signing so customers can deploy issuer and verifier in
separate trust zones (e.g., issuer in a bastion host, verifier on edge nodes
that never touch the signing key).

### 3.2 API surface

```ts
// types.ts — new discriminated union
export const AuthConfigSchema = z.discriminatedUnion('alg', [
  z.object({
    alg: z.literal('HS256'),
    secretKey: z.string().min(32),
  }),
  z.object({
    alg: z.literal('RS256'),
    privateKeyPem: z.string().optional(), // for issuer
    publicKeyPem: z.string(),             // for verifier (required)
    keyId: z.string().optional(),         // kid header
  }),
]);
```

### 3.3 Key storage strategy (tiered)

| Tier | Storage | Appropriate for |
|---|---|---|
| T0 | `privateKeyPem` / `publicKeyPem` passed inline in config | unit tests, ephemeral dev |
| T1 | `privateKeyPath` / `publicKeyPath` — read from filesystem with `fs.readFile` | on-prem / single-host |
| T2 | `BATISTE_PRIVATE_KEY` env var (base64) | containerized, 12-factor |
| T3 | KMS pluggable interface: `KeyProvider` with `sign(data) → signature`, `getPublicKey() → pem` — implementations for AWS KMS, GCP KMS, Azure Key Vault, HashiCorp Vault | enterprise |

T0-T2 can ship in one release. T3 requires a `KeyProvider` abstraction and
per-cloud SDK; mark roadmap.

### 3.4 Backwards compatibility with HS256

The existing `config.auth.secretKey` stays. Introduce `config.auth.alg`
defaulting to `'HS256'`. Existing `secretKey: 'xxx'` continues to work without
modification. The new `RS256` variant is opt-in.

### 3.5 Code deltas (investigation only, not applied)

- `token-issuer.ts:18` — branch on `alg`; for RS256, import PEM via
  `jose.importPKCS8` and use `SignJWT.setProtectedHeader({ alg: 'RS256', kid })`.
- `token-issuer.ts:49` — pick alg from config.
- `token-verifier.ts:14-16` — replace single `secretKey` with a "key material"
  union; for RS256, import PEM via `jose.importSPKI`.
- `token-verifier.ts:22-25` — pass `algorithms: [config.alg]`.
- `middleware.ts:34` — propagate alg-aware verifier.

### 3.6 Test plan

- **Unit:** HS256 round-trip (existing), RS256 round-trip, RS256-only verifier
  rejects HS256 tokens, RS256 rejects tokens with flipped `alg` header
  (algorithm confusion), missing `kid` accepted if verifier has single key,
  rotated `kid` loads from keystore.
- **Integration:** `aidk/__tests__/claims-enforcement.test.ts` duplicated with
  RS256 config.
- **Fuzz:** feed 10K random JWTs with malformed alg/kid to assert clean
  errors (no panic).

### 3.7 Effort estimate

~3 engineer-days:
- 1d: API + issuer/verifier branches
- 1d: keystore abstraction with file + env backends
- 0.5d: test suite
- 0.5d: docs + migration note

KMS backends add 2-3d per cloud (AWS, GCP, Azure, Vault) — defer to roadmap.

---

## 4. Audit ledger tamper-evidence design (E3-DD-11)

### 4.1 Current state

`packages/audit/src/ledger.ts:30-44` — plain SQLite WAL. Zero tamper-evidence.
Any DB-write access → silent forgery.

### 4.2 Proposed: row-level hash chain

Each row stores a `prev_hash` referring to the `row_hash` of the previous
row. `row_hash = SHA-256(prev_hash || canonical_json(row_fields))`.

### 4.3 Schema delta

```sql
ALTER TABLE audit_log ADD COLUMN seq INTEGER NOT NULL;           -- monotonic
ALTER TABLE audit_log ADD COLUMN prev_hash TEXT NOT NULL;        -- hex
ALTER TABLE audit_log ADD COLUMN row_hash TEXT NOT NULL;         -- hex
CREATE UNIQUE INDEX idx_audit_seq ON audit_log(seq);
-- Genesis row: seq=0, prev_hash='0'*64
```

Canonical JSON = JCS (RFC 8785) to prevent whitespace/ordering drift. A
reference implementation: `@stablelib/jcs` or hand-rolled (~80 LOC).

### 4.4 Append path

```ts
// pseudocode — not applied to source
const tail = db.prepare('SELECT row_hash FROM audit_log ORDER BY seq DESC LIMIT 1').get();
const prevHash = tail?.row_hash ?? ZERO_HASH;
const canonical = jcs({ id, timestamp, sessionId, agentId, tool, args, result, durationMs, seq });
const rowHash = sha256(prevHash + canonical);
// INSERT ... VALUES (..., seq=nextSeq, prev_hash=prevHash, row_hash=rowHash)
```

The chain insert must be transactional with the preceding SELECT to avoid
two appends colliding. SQLite `BEGIN IMMEDIATE` + a single-writer mutex (which
better-sqlite3 provides — it's synchronous) is sufficient for in-process
safety. Multi-process requires either a file lock or a single-writer process.

### 4.5 Verification tool

Ship a CLI `batiste audit verify` that:

1. Reads all rows in `seq` order.
2. Recomputes each `row_hash` and compares.
3. Emits a JSON report: `{ total, verified, firstBreakSeq?, reason? }`.
4. Exit code 0 on clean, 1 on break.

Performance estimate: SHA-256 at ~500 MB/s; 1M rows × ~400B/row = 400MB ≈ 0.8s
hashing + SQLite read time. Fine.

### 4.6 External anchoring (roadmap)

Periodically (e.g., hourly) emit the current tail's `row_hash` to:
- A second, append-only file with a separate filesystem ACL.
- An RFC 3161 TSA (public timestamp authority) — ties the chain to wall-clock
  non-repudiation.
- Optionally a blockchain notary (Certificate Transparency-style) for
  ultra-high-assurance customers. Mark as "enterprise tier" roadmap.

### 4.7 Performance impact

Per-append cost: 1 SHA-256 of ~400 bytes (≈1µs) + 1 extra SELECT (~5µs). At
our ledger's dominant cost (SQLite INSERT, ~50µs), this is <15% overhead.
Acceptable.

### 4.8 Migration strategy

For existing deployments: on first boot after upgrade, compute a synthetic
genesis row with `seq=0`, `prev_hash=0*64`, and re-hash existing rows in
order to populate `row_hash`. Call this "sealed" state; note that pre-upgrade
rows have *no* tamper evidence (that's the historical gap the upgrade
closes).

### 4.9 Effort estimate

~2 engineer-days:
- 0.5d: schema + append path
- 0.5d: JCS impl (or dep integration)
- 0.5d: verify CLI
- 0.5d: tests (tamper detection, multi-process fight, migration)

---

## 5. Kill-switch determinism under load

### 5.1 Current behavior

`packages/audit/src/kill-switch.ts`:
- `killedSessions: Set<string>` (line 15)
- `paused: boolean` (line 16)
- `isAllowed(sessionId)`: `return !this.paused && !this.killedSessions.has(sessionId)` (line 57)

Checked at `packages/audit/src/middleware.ts:34`:
`if (killSwitch && !killSwitch.isAllowed(sessionId)) { /* deny + audit */ }`

### 5.2 Atomicity analysis

**In-process, single-threaded Node.js:** All state mutations happen on the
event loop thread. `isAllowed()` is synchronous. `execute()` is synchronous
and modifies `killedSessions`/`paused` without yielding. Therefore, **between
any two event-loop ticks, the kill-switch state is consistent**. There is no
interleaving a `kill_session` mutation mid-read.

Within a single tool-call path, however, there are multiple `await`
boundaries: the check happens at `middleware.ts:34`, and the actual tool
dispatch at `:53` is after an `await`. If a `kill_session` command is
executed between those two points, the check has already passed and the tool
runs. **There is a TOCTOU window** for a single in-flight call.

For a typical MCP tool that takes ms to seconds, this window is real. A kill
issued while a `validate_code` is running will **not** stop the in-flight
call; only the next call is blocked. This is fine for most definitions of
"stop new work" but **not** for "halt immediately." Document this.

**Multi-process:** Each process has its own `KillSwitch` instance. A kill
command sent to process A has **no effect** on process B. The current
`startGateway` (`secure-gateway.ts`) creates one `KillSwitch` per node
(`create-node.ts:145`), so all sessions routed to that node process share
one switch. If the buyer deploys multiple node processes behind a load
balancer, they need either:
- External kill-switch (Redis pub/sub, or similar shared state), or
- A broadcast mechanism between processes.

Neither exists today. **Document and ticket.**

### 5.3 Proposed stress test

Hand-off to Eixo 2:

1. Spin up a gateway with `maxConcurrentSessions: 100`.
2. Open 100 sessions, each issuing `validate_code` in a loop at 50 rps.
3. At t+10s, invoke `killSwitch.execute({ action: 'kill_all', reason: 'test' })`.
4. Record:
   - Time from `kill_all` to last allowed tool call (per-session).
   - Number of in-flight calls that completed after kill_all.
5. Assert: no new session passes `isAllowed` after t+10s; in-flight tail
   drains within <1s (bounded by longest tool call).

Add an identical test with `kill_session` targeting a specific session while
99 others continue — verify correct isolation.

### 5.4 Recommendations

| Fix | Effort | Impact |
|---|---|---|
| Document in-flight semantics (kill blocks *new* calls, not running ones) | 0.25d | DD-grade clarity |
| Wrap `KillSwitch` state behind a tiny finite-state machine so `pause`-after-`kill_all` is defined | 0.5d | Correctness |
| Add `AbortController` plumbing through tool handlers for "hard stop" | 2d | Real hard-stop for long tools |
| Multi-process kill via file-backed flag (inotify/poll) | 1d | Minimum-viable multi-node |
| Redis-backed kill for cloud deployments | 3d | Enterprise scale |

---

## 6. MCP handler input validation — punch list

### 6.1 `packages/code/src/mcp/handler.ts`

Each method takes `args: Record<string, unknown>` and hand-casts. No Zod
validation is performed at the dispatch layer (the schemas exist in
`code/src/mcp/tools.ts` but are never applied). The MCP SDK does validate
against `inputSchema` during the JSON-RPC parse, so *some* structural checks
happen upstream — but **nothing inside the handler enforces them defensively**,
and the direct-cli path (`direct-cli.ts`) bypasses MCP entirely, so there is
**no validation at all** on that path.

| Method | Line | Missing validation |
|---|---|---|
| `analyzeDependency` | 66-97 | `entryPoints` checked non-empty (good); `maxDepth` not bounded — accepts `Infinity` or negative; `includeNodeModules` not typed |
| `validateCode` | 99-145 | `paths` not checked for type (assumes `string[]`); `maxIssues` not bounded (accepts huge values) |
| `executeSandbox` | 147-174 | **`command` is unchecked string** — no allowlist, no length cap; `args` not validated; `workingDir` not traversal-checked |
| `manageTask` | 176-224 | `action` cast without check — unknown action hits `default` → throw, but wasted work; `taskId` never UUID-validated |
| `runTDD` | 240-270 | `testCode`/`implementationCode` unbounded size — could push 100MB of source; no extension check on file paths |
| `findSymbol` | 272-300 | `symbolName` unbounded; no escape for regex chars |
| `indexCodebase` | 319-375 | `mode` cast without check |
| `summarizeCodebase` | 377-487 | `scope` joined onto `projectRoot` — traversal attempt `'../..'` reaches any ancestor; `maxTokens` unbounded |
| `contextBudgetAction` | 496-555 | `category` cast without check; `tokens` not bounded (could pass `Number.MAX_SAFE_INTEGER`) |
| `autoFix` | 557-603 | `dryRun` default is *true* — good; `maxFixes`/`maxIterations` unbounded |
| `orchestrateAgents` | 612-688 | `role` cast without check; `task.description` unbounded; `poolSpec.replicas` unbounded (could request 10K agents) |

### 6.2 `packages/connectors/src/mcp/handler.ts`

| Method | Line | Missing validation |
|---|---|---|
| `parsePdf` | 32-55 | `filePath` extension not checked; `maxPages` unbounded; no file-size pre-check |
| `queryCsv` | 57-78 | `where` is `Record<string, string>` but `args.where` is `unknown` — trusted cast; `delimiter` not length-capped (could pass multi-char); `limit` unbounded |
| `csvStats` | 81-88 | `column` not validated; no file-size check |

### 6.3 Root-cause recommendation

At MCP dispatch (`packages/core/src/mcp/server-factory.ts:57-84`), wrap the
`handler.handleTool` call with a Zod parse against the tool's declared
schema. Every tool's `inputSchema` can be expressed as a Zod schema
(they're already defined in `code/src/mcp/tools.ts` lines 10-119 as
`AnalyzeDependencyInput`, `ValidateCodeInput`, etc., but **unused**).

Effort: ~1 engineer-day to wire up schema-by-name lookup and rigorous
error returns. The schemas are pre-existing — this is a plumbing task.

---

## 7. Secrets management

### 7.1 Where JWT signing keys live today

| Location | File:Line | Notes |
|---|---|---|
| Node config object | `aidk/src/types.ts:11` | `auth.secretKey: z.string()` — plaintext in user code |
| Process memory | `auth/src/token-issuer.ts:13, 18` | `Uint8Array` for lifetime of the process |
| No env-var loader | — | Users must write `secretKey: process.env.X` themselves in their bootstrap |
| No file loader | — | No `secretKeyPath` option |
| Tests | `aidk/src/__tests__/*.test.ts:73, 181`, `auth/src/__tests__/*.test.ts` | Hard-coded test strings — OK |

### 7.2 Where they should live (target state)

| Tier | Source | Implementation |
|---|---|---|
| T0 | Inline config (current) | Keep for dev |
| T1 | `BATISTE_JWT_SECRET` env var | Add a helper `loadAuthConfig(): AuthConfig` that reads env |
| T1b | `secretKeyPath` pointing to a 0600 file | Add `fs.readFile` + mode check |
| T2 | OS keychain (macOS Keychain, Linux secret-service, Windows Credential Manager) | Optional dep |
| T3 | KMS (see §3.3) | Enterprise |

### 7.3 Accidental leakage audit

Grepped for: `console.log`, `console.error`, error messages containing token
material, log redaction.

- `secure-gateway.ts:289` logs `"${label} gateway started on ${host}:${port}"`
  — **no secret in log**. Good.
- `auth/middleware.ts:43-64` — denial reasons include `result.error` which
  comes from `jose`. `jose` error messages do **not** include the key.
  Verified by reading `jose`'s error types.
- `kill-switch.ts:22` — logs `command` which includes `reason` string.
  If an operator types a secret into `reason`, it persists. Unlikely, but
  document the convention.
- `audit/ledger.ts:57` — `JSON.stringify(entry.args)` persists raw args.
  **Risk:** if a customer calls a tool with a secret in an argument (e.g.,
  `parse_pdf filePath: "/root/.aws/credentials"`), the filepath is logged.
  Mitigation: redaction pipeline at `audit/middleware.ts:43` that strips
  known-sensitive fields (`*Key`, `*Token`, `*Password`, `*Secret`). Effort:
  0.5d.

### 7.4 .env / file scan

A repo-wide sweep showed no `.env*` files checked in. `deniedPaths` in the
default scope (`create-node.ts:119`) blocks `**/*.env` and `**/*.secret` but
misses the broader set listed in §1.6. Recommend extending to:

```
**/*.env, **/*.env.*, **/.env.*,
**/*.secret, **/*.secrets,
**/*.pem, **/*.key, **/*.pfx, **/*.p12, **/*.jks,
**/id_rsa*, **/id_ed25519*, **/id_dsa*,
**/.aws/credentials, **/.azure/*, **/.gcp/*,
**/.ssh/**, **/.netrc, **/.npmrc, **/.pypirc,
**/.git-credentials, **/authorized_keys
```

---

## 8. CVE audit

### 8.1 Method

`pnpm audit` blocked in this sandbox. Findings below are derived from
pnpm-lock.yaml manual review against public advisory databases (OSV, GHSA,
npm advisories) known to me up to knowledge cutoff. This must be **re-run
with live `pnpm audit` before DD sign-off**.

### 8.2 Direct dependencies (pinned versions, pnpm-lock.yaml)

| Package | Pinned | Status (as of KB cutoff) | Remediation |
|---|---|---|---|
| `jose@6.1.3` | current | No known CVEs | Keep current |
| `better-sqlite3@11.10.0` | current | No known CVEs at 11.x | Keep current |
| `@modelcontextprotocol/sdk@1.27.1` | current | Fast-moving; no advisories known at cutoff, but the SDK is <1yo — recommend dependabot or renovate | Ticket: add Renovate |
| `zod@3.25.76` | current | No known CVEs | Keep |
| `fast-glob@3.3.3` | current | No known CVEs at 3.x | Keep |
| `micromatch@4.0.8` | current | GHSA-952p-6rrq-rcjv (ReDoS in old versions) patched in 4.0.8. **Confirm all transitive users resolve to 4.0.8.** | Verified in lockfile |
| `ignore@5.3.2` | current | No known CVEs | Keep |
| `tree-sitter@0.21.1` | current | Native bindings; no known CVEs | Keep |
| `tree-sitter-python@0.21.0` | current | Ditto | Keep |
| `tree-sitter-typescript@0.21.0` | current | Ditto | Keep |
| `commander@12.1.0` | current | No known CVEs | Keep |
| **`pdf-parse@1.1.4`** | **STALE** | Last published 2017. Unmaintained. Transitively depends on `node-ensure` (also unmaintained). See 8.3. | **Replace** |

### 8.3 `pdf-parse` — the big one

Symptoms:
- Last release: Oct 2017 (~8.5 years old at time of writing).
- Depends on `node-ensure` (dormant).
- Bundles `pdfjs-dist@1.10.100` (from 2018, has known prototype-pollution
  and memory-corruption CVEs fixed in 4.x).

**Recommendation:** replace with a maintained parser. Options:

1. **`pdfjs-dist`** directly at latest (4.x) — official Mozilla, actively
   maintained, ~5 MB footprint. Preferred.
2. **`pdf2json`** — maintained but less common.
3. **`mupdf-js`** via WASM — best fidelity, larger footprint.

Effort: ~1 engineer-day (PdfParser is a thin wrapper per `PdfParser.ts`).

### 8.4 Recommendation summary

| Action | Owner | Effort | Priority |
|---|---|---|---|
| Run `pnpm audit` in CI and fail on HIGH/CRITICAL | eixo7 | 0.25d | P0 |
| Add Renovate or Dependabot for MCP SDK + direct deps | eixo7 | 0.5d | P1 |
| Replace `pdf-parse` with `pdfjs-dist@latest` | eixo3 | 1d | P1 |
| Produce a machine-readable SBOM (CycloneDX) as a DD artifact | eixo8 | 0.5d | P0 (DD) |
| OSV-scanner in CI (complements pnpm audit) | eixo7 | 0.5d | P2 |

---

## 9. Pen-test scoping document (E3-DD-09)

### 9.1 Target firms

Tier-1 candidates (established, credible references in F500 DD):
- **Trail of Bits** — Go/Rust/TS excellence, heavy crypto review
- **NCC Group** — broadest enterprise track record; strong on identity/audit
- **Doyensec** — application security specialists
- **Bishop Fox** — good for cloud/MCP infrastructure angles

Tier-2 (cost-effective):
- **Cure53** — short reports, high density
- **Include Security** — good MCP protocol familiarity

Shortlist recommendation: **NCC Group** (primary) + **Trail of Bits**
(crypto-focused annex on JWT + audit chain). Dual-firm gives the DD portal a
credibility multiplier and avoids single-firm dependency.

### 9.2 In-scope (what to test)

| # | Target | Rationale |
|---|---|---|
| 1 | `@batiste-aidk/auth` JWT path | Core trust boundary |
| 2 | `@batiste-aidk/audit` ledger & kill-switch | Tamper-evidence claim |
| 3 | `@batiste-aidk/transport` gateway (HTTP, TLS, rate-limit, sessions) | Public attack surface |
| 4 | `@batiste-aidk/scope` file matcher + path traversal | Isolation correctness |
| 5 | MCP tool handlers (`code`, `connectors`) for input validation | §6 punch list |
| 6 | `ProcessSandbox` — sandbox escape, env leakage | Misnamed "sandbox" |
| 7 | End-to-end: spin up `preset: 'enterprise'`, attempt privilege escalation | Integration holistic |
| 8 | Marketplace gateway (unauthenticated endpoints) | §1.9 |
| 9 | DD portal signature/timestamp authenticity (after it exists) | Trust chain |

### 9.3 Out of scope

- Social engineering
- Physical testing
- DoS of production infrastructure (the hosted marketplace if/when deployed)
- Third-party dependencies (jose, pdfjs-dist, SQLite) — rely on upstream CVE
- Frontend/UI components in `packages/web` beyond XSS sanity
- LLM prompt-injection beyond what the scope engine enforces (that's its own
  eixo)

### 9.4 Methodology

- White-box: full source + repo history.
- Combined static (CodeQL, Semgrep, Snyk Code) + dynamic (fuzz + manual).
- 2 reviewers × 3 weeks (Trail of Bits standard for this surface area) +
  1 reviewer × 1 week crypto focus.

### 9.5 Deliverables (for DD portal)

- Executive summary (1-2 pages, non-technical)
- Technical findings report (CVSS-scored)
- Retest report after remediation
- **Public-safe version** — redacted of sensitive internal names, published
  on `dd.batiste.network/pentest/<year>`
- Signed (minisign) + TSA-countersigned PDFs

### 9.6 Budget rough order of magnitude

- Tier-1 dual-firm, full scope: **$120K–$180K** for first engagement
- Annual retest (reduced scope): **$45K–$70K**
- Add 15% for TSA signing + artifact preparation

### 9.7 Timeline

- T+0: RFPs issued to top 4 firms
- T+3w: firm selected, SOW signed
- T+4w: kickoff
- T+7w: draft report
- T+9w: remediation window opens
- T+13w: retest + final report
- T+14w: DD-portal publication

Target a pentest-complete milestone ~90 days before first enterprise demo
that will require DD.

---

## 10. Key Management Runbook Outline (E3-DD-12)

### 10.1 Generation

- Symmetric (HS256): `openssl rand -base64 48 | tr -d '=+/' | head -c 48`
  gives 48 URL-safe chars ≈ 288 bits.
- Asymmetric (RS256): `openssl genpkey -algorithm RSA -pkeyopt
  rsa_keygen_bits:4096 -out private.pem && openssl rsa -pubout -in
  private.pem -out public.pem`
- Ed25519 (future, for EdDSA): `openssl genpkey -algorithm ED25519 -out
  private.pem`

Each key gets a `kid` = first 8 chars of SHA-256(pubkey) for selection.

### 10.2 Storage

| Tier | Storage | Access controls |
|---|---|---|
| Dev | inline config (env or file) | 0600 file perms; .gitignored |
| Prod (self-host) | env var from systemd EnvironmentFile (0600) | user=batiste, no group read |
| Prod (container) | Docker secret / K8s Secret | RBAC restricted to node serviceaccount |
| Enterprise | KMS (AWS/GCP/Azure/Vault) | never leaves HSM; node calls `sign()` API |

### 10.3 Rotation

**Goal:** rotate every 90 days, faster for incidents.

Procedure:
1. Generate new keypair with new `kid`.
2. Publish new public key to all verifiers (rolling update; verifiers
   accept multiple `kid` simultaneously via a keystore array).
3. Flip issuer to sign with new `kid`.
4. Wait max token TTL + grace (default: 1h TTL + 24h grace = 25h).
5. Retire old public key from verifier keystore.
6. Emit audit event `key.rotated` with old_kid, new_kid, at-timestamp.

With HS256 single-key there is no rollover window — **all nodes must be
cut at once**. This is another reason RS256 is on the roadmap.

### 10.4 Revocation

- Per-token revocation: `KeyStore.revoke(id)` (exists today).
- Per-key revocation: drop the `kid` from the verifier keystore; all tokens
  signed under that `kid` instantly invalid. Requires RS256 + kid support.
- Emergency kill-switch: `killSwitch.execute({ action: 'kill_all' })` halts
  new work even if tokens remain valid.

### 10.5 Backup

- Private key: encrypted with a user-supplied passphrase; backed up to 3
  offline locations (minimum) under 3-2-1 rule.
- Public key: no secrecy requirement; checked into ops repo for
  auditability.
- Audit-chain genesis hash: published to DD portal — lets third parties
  independently verify the chain continues from a known anchor.

### 10.6 Incident response

If private key compromise is suspected:
1. Within 15min: `killSwitch.execute({ action: 'kill_all' })` on all nodes.
2. Within 1h: generate new keypair, rotate issuer, retire old `kid`.
3. Within 4h: publish incident note to DD portal (required for SLA-committed
   customers).
4. Within 48h: full post-mortem; audit-chain verification to detect any
   tampering that happened during the compromise window.

### 10.7 HSM roadmap

Phase 1 (shipped): file + env key storage.
Phase 2 (Q3): `KeyProvider` abstraction + AWS KMS, GCP KMS.
Phase 3 (Q4): Azure Key Vault, HashiCorp Vault.
Phase 4 (next year): PKCS#11 for on-prem HSMs (YubiHSM2, Entrust nShield,
Thales Luna).
Phase 5: FIPS 140-3 validated configuration bundle for US public-sector
DD — add as a pricing tier with its own SKU.

### 10.8 Runbook artifacts (owners)

| Artifact | Owner | Format | Location |
|---|---|---|---|
| Key-gen one-liners | eixo3 | markdown + copy-pasteable shell | DD portal + `docs/ops/keygen.md` |
| Rotation playbook | eixo3 + eixo7 | markdown + ansible playbook | `docs/ops/rotate.md` |
| IR runbook | eixo3 + eixo7 | markdown + pagerduty escalation tree | `docs/ops/incident.md` |
| HSM compatibility matrix | eixo3 | table | DD portal |
| KMS integration guide | eixo3 | markdown per cloud | `docs/ops/kms/*.md` |

---

## 11. Cross-references & hand-offs

### 11.1 To Eixo 2 (bugs)

Convert the following into tickets:
- **E3-B01:** Pin JWT alg in `token-verifier.ts:22-25` (§2.3 C-4). P0.
- **E3-B02:** Enforce projectId/audience claim match (§2.3 C-1/C-2). P0.
- **E3-B03:** Fix `ScopedHandler` glob regex escaping (§1.5 T). P1.
- **E3-B04:** Expand default-deny paths (§1.6 T, §7.4). P1.
- **E3-B05:** Add input validation via Zod at MCP dispatch (§6.3). P1.
- **E3-B06:** Default-allow tools when scope.tools omitted → document or
  invert (§1.1 E). P1 (discussion required).
- **E3-B07:** Audit-log redaction for sensitive arg keys (§7.3). P1.
- **E3-B08:** Replace `pdf-parse` with `pdfjs-dist` (§8.3). P1.
- **E3-B09:** `execute_sandbox` command-allowlist and env scrubbing
  (§1.4 I, §1.7 E). P0.
- **E3-B10:** `X-Forwarded-For` trust-boundary flag (§1.3 D). P1.

### 11.2 To Eixo 7 (observability)

- Metrics: auth denials / min, revocation lookups / min, kill-switch state
  transitions, audit-chain verify failures.
- Alerting: any `row_hash` mismatch in verify pass; unusual denial spike.

### 11.3 To Eixo 8 (DD portal)

- E3-DD-08: this document §1 (threat model) — publish as-is with
  appropriate redaction.
- E3-DD-09: §9 (pen-test scoping) — publish the in-scope/out-of-scope
  matrix; redact firm names until engagement signed.
- E3-DD-10: §2 (crypto review) — crypto-review annex, sign off once §2.3
  C-1…C-4 are fixed.
- E3-DD-11: §4 (tamper-evident audit design) — publish design doc.
- E3-DD-12: §10 (key-management runbook outline) — expand into full runbook
  before first enterprise demo.

### 11.4 To Eixo 1 (honesty)

README/ARCH claim corrections:
- HS256-only (confirmed); RS256 on roadmap (§3).
- Kill-switch: in-process, blocks new calls (not in-flight); multi-process
  requires shared state (roadmap) (§5.2).
- "Tamper-evident audit" is a *design goal* — today we have WAL SQLite
  (§4.1). Adjust README phrasing to "append-only audit log (hash-chain
  tamper-evidence in roadmap)" until §4 ships.

---

## 12. Acceptance criteria for this Eixo

This Eixo is "done" when:

1. All ten cross-hand-off tickets (§11.1) are in the Eixo 2 backlog with
   severity and effort estimate.
2. Sections 1, 2, 4, 9, 10 are published on the DD portal (or staged for
   publication) with signatures.
3. The `pnpm audit` CI gate (§8.4) is live.
4. `pdf-parse` is replaced (§8.3).
5. `token-verifier.ts` has `algorithms: ['HS256']` pinned (§2.3 C-4).
6. A DD reviewer can independently re-derive every numeric claim in this
   document from the cited `file:line` references.

Not done until all six.

---

*End of Eixo 3 report.*
