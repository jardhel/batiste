#!/usr/bin/env node
/**
 * publish-npm.mjs — the "terraform" of npm publication for Batiste.
 *
 * Declarative, repeatable, idempotent. Reads scripts/npm-publish.config.json
 * (the manifest), validates each MIT package's publish-readiness, and runs
 * `npm publish --dry-run --access public` per package in dependency order.
 *
 * SAFETY (irreversible + IP):
 *   - DEFAULT = dry-run. Nothing is ever published without --yes-publish.
 *   - Only MIT packages declared in the manifest are touched. Proprietary
 *     (UNLICENSED / no-license) packages are NEVER in scope.
 *   - Before ANY package is dry-run/published, the script re-verifies on disk
 *     that license === "MIT" and private !== true. A proprietary package that
 *     somehow appears in the manifest hard-aborts the whole run.
 *   - Real publish requires BOTH --yes-publish AND a logged-in `npm whoami`.
 *     Otherwise it aborts with an instruction and exits non-zero.
 *
 * Usage:
 *   node scripts/publish-npm.mjs                 # dry-run (default)
 *   node scripts/publish-npm.mjs --dry-run       # explicit dry-run
 *   node scripts/publish-npm.mjs --yes-publish   # REAL publish (founder only, must be `npm login`-ed)
 *   node scripts/publish-npm.mjs --json          # machine-readable summary on stdout
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const PKG_DIR = join(REPO_ROOT, 'packages');
const CONFIG_PATH = join(__dirname, 'npm-publish.config.json');

const args = process.argv.slice(2);
const REAL_PUBLISH = args.includes('--yes-publish');
const JSON_OUT = args.includes('--json');
const DRY_RUN = !REAL_PUBLISH; // dry-run is always the default

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};
const log = (...a) => { if (!JSON_OUT) console.log(...a); };
const err = (...a) => console.error(...a);

function die(msg) {
  err(`${C.red}${C.bold}ABORT:${C.reset} ${msg}`);
  process.exit(1);
}

// ── Load manifest ───────────────────────────────────────────────────────────
if (!existsSync(CONFIG_PATH)) die(`manifest not found: ${CONFIG_PATH}`);
const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
const REQUIRED_LICENSE = config.requiredLicense || 'MIT';
const ORG = config.org || '@batiste-aidk';

// Flatten manifest into an ordered list of {dir, level}
const ordered = [];
for (const lvl of config.levels) {
  for (const dir of lvl.packages) ordered.push({ dir, level: lvl.level });
}

// ── Readiness validation (per MIT package) ──────────────────────────────────
function readPkg(dir) {
  const p = join(PKG_DIR, dir, 'package.json');
  if (!existsSync(p)) return { error: `package.json missing at ${p}` };
  try {
    return { json: JSON.parse(readFileSync(p, 'utf8')), path: p };
  } catch (e) {
    return { error: `invalid JSON in ${p}: ${e.message}` };
  }
}

function validateReadiness(dir, pkg) {
  const gaps = [];
  const pkgRoot = join(PKG_DIR, dir);

  // HARD license/private guard — the IP gate. These are fatal, not "gaps".
  if (pkg.license !== REQUIRED_LICENSE) {
    return { fatal: `license is "${pkg.license}", expected "${REQUIRED_LICENSE}". Proprietary package must NOT be in the publish manifest.` };
  }
  if (pkg.private === true) {
    return { fatal: `private:true — refuse to publish a package marked private.` };
  }

  // name
  if (!pkg.name) gaps.push('missing "name"');
  else if (!pkg.name.startsWith(`${ORG}/`)) gaps.push(`name "${pkg.name}" not under org "${ORG}/"`);
  // version
  if (!pkg.version) gaps.push('missing "version"');
  // entry point
  if (!pkg.exports && !pkg.main && !pkg.bin) gaps.push('no "exports", "main" or "bin" entry point');
  // file whitelist (files[] OR .npmignore)
  const hasFiles = Array.isArray(pkg.files) && pkg.files.length > 0;
  const hasNpmignore = existsSync(join(pkgRoot, '.npmignore'));
  if (!hasFiles && !hasNpmignore) gaps.push('no "files" field and no .npmignore (would publish whole dir)');
  // publishConfig access:public
  if (!pkg.publishConfig || pkg.publishConfig.access !== 'public') {
    gaps.push('missing publishConfig.access:"public" (relying on --access flag only)');
  }
  // README (warn-level — npm publishes fine without one, but it is a readiness gap)
  if (!existsSync(join(pkgRoot, 'README.md'))) gaps.push('no README.md');
  // dist built (entry resolves)
  const entry = pkg.main || (pkg.exports && pkg.exports['.'] && (pkg.exports['.'].import || pkg.exports['.'].default || pkg.exports['.']));
  if (typeof entry === 'string') {
    if (!existsSync(join(pkgRoot, entry))) gaps.push(`entry "${entry}" not built (run build first)`);
  } else if (Array.isArray(pkg.files) && pkg.files.includes('dist') && !existsSync(join(pkgRoot, 'dist'))) {
    gaps.push('dist/ not built (run build first)');
  }

  return { gaps };
}

// ── npm whoami ──────────────────────────────────────────────────────────────
function npmWhoami() {
  try {
    const out = execFileSync('npm', ['whoami'], { stdio: ['ignore', 'pipe', 'ignore'] });
    return out.toString().trim();
  } catch {
    return null;
  }
}

// ── Dry-run / publish a single package, parse tarball stats ─────────────────
function publishPackage(dir, real, version) {
  const cwd = join(PKG_DIR, dir);
  const npmArgs = ['publish', '--access', 'public'];
  // Prerelease versions (x.y.z-alpha/beta/rc/next) require an explicit dist-tag
  // so they don't move `latest`. Mirror that in dry-run for an honest result.
  if (typeof version === 'string' && /-(alpha|beta|rc|next|canary)/i.test(version)) {
    npmArgs.push('--tag', 'next');
  }
  if (!real) npmArgs.push('--dry-run');
  // --json gives us a stable structured tarball summary on stdout
  npmArgs.push('--json');

  let stdout = '', stderr = '', failed = false;
  try {
    stdout = execFileSync('npm', npmArgs, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  } catch (e) {
    failed = true;
    stdout = (e.stdout || '').toString();
    stderr = (e.stderr || '').toString();
  }

  // npm publish --json emits { "<pkg-name>": { id, size, unpackedSize, files[], entryCount, ... } }
  let parsed = null;
  try { parsed = JSON.parse(stdout); } catch { /* fall through */ }
  // Unwrap the single package-name key.
  let info = parsed;
  if (parsed && typeof parsed === 'object' && !parsed.id) {
    const keys = Object.keys(parsed);
    if (keys.length === 1 && parsed[keys[0]] && typeof parsed[keys[0]] === 'object') {
      info = parsed[keys[0]];
    }
  }

  const stats = info ? {
    id: info.id,
    name: info.name,
    version: info.version,
    files: info.entryCount ?? (Array.isArray(info.files) ? info.files.length : null),
    size: info.size ?? null,
    unpackedSize: info.unpackedSize ?? null,
    shasum: info.shasum ?? null,
  } : null;

  return { failed, stats, stdout, stderr };
}

function fmtBytes(n) {
  if (n == null) return '?';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

// ── Main ────────────────────────────────────────────────────────────────────
log(`${C.bold}${C.cyan}Batiste npm publish pipeline${C.reset}  ${C.dim}(${DRY_RUN ? 'DRY-RUN' : 'REAL PUBLISH'})${C.reset}`);
log(`${C.dim}manifest: ${CONFIG_PATH}${C.reset}\n`);

// Pre-flight: real publish requires login.
let whoami = null;
if (REAL_PUBLISH) {
  whoami = npmWhoami();
  if (!whoami) {
    die(`--yes-publish given but \`npm whoami\` is NOT logged in.\n` +
        `       The founder must run: ${C.bold}npm login${C.reset} (org ${ORG}, with 2FA).\n` +
        `       Refusing to publish without an authenticated session.`);
  }
  log(`${C.green}npm whoami:${C.reset} ${whoami}\n`);
}

const results = [];
let readinessFailures = 0;

for (const { dir, level } of ordered) {
  const { json: pkg, error } = readPkg(dir);
  if (error) {
    readinessFailures++;
    results.push({ dir, level, ok: false, gaps: [error], fatal: null, stats: null });
    log(`${C.red}✗${C.reset} [L${level}] ${dir}: ${error}`);
    continue;
  }

  const { fatal, gaps } = validateReadiness(dir, pkg);
  if (fatal) {
    // IP gate — this is unrecoverable; do NOT even dry-run it, and stop the run.
    err(`${C.red}${C.bold}✗ IP GATE [L${level}] ${dir} (${pkg.name}): ${fatal}${C.reset}`);
    die(`proprietary/private package present in publish set. Fix the manifest. Nothing published.`);
  }

  // Warn-level (non-blocking) gaps: these don't stop a correct publish because
  // the pipeline passes `--access public` on the CLI and README is optional.
  const isWarn = (g) =>
    g.includes('no README.md') ||
    g.includes('publishConfig.access');
  const blockingGaps = gaps.filter((g) => !isWarn(g));
  const ready = blockingGaps.length === 0;

  if (!ready) {
    readinessFailures++;
    results.push({ dir, level, name: pkg.name, version: pkg.version, ok: false, gaps, stats: null });
    log(`${C.yellow}⚠${C.reset} [L${level}] ${pkg.name}@${pkg.version} — NOT READY:`);
    for (const g of gaps) log(`    ${C.yellow}•${C.reset} ${g}`);
    log(`    ${C.dim}(skipping ${DRY_RUN ? 'dry-run' : 'publish'} for this package)${C.reset}`);
    continue;
  }

  // Run dry-run / publish
  const { failed, stats, stderr } = publishPackage(dir, REAL_PUBLISH, pkg.version);
  if (failed) {
    results.push({ dir, level, name: pkg.name, version: pkg.version, ok: false, gaps, stats, error: stderr.trim() });
    log(`${C.red}✗${C.reset} [L${level}] ${pkg.name}@${pkg.version} — ${DRY_RUN ? 'dry-run' : 'publish'} FAILED`);
    if (stderr.trim()) log(`    ${C.dim}${stderr.trim().split('\n').slice(0, 4).join('\n    ')}${C.reset}`);
    continue;
  }

  const warnGaps = gaps; // include README warnings for transparency
  results.push({ dir, level, name: pkg.name, version: pkg.version, ok: true, gaps: warnGaps, stats });
  const s = stats || {};
  log(`${C.green}✓${C.reset} [L${level}] ${C.bold}${pkg.name}@${pkg.version}${C.reset}` +
      `  files=${s.files ?? '?'}  tarball=${fmtBytes(s.size)}  unpacked=${fmtBytes(s.unpackedSize)}` +
      (DRY_RUN ? `  ${C.dim}(dry-run)${C.reset}` : `  ${C.green}PUBLISHED${C.reset}`));
  if (warnGaps.length) for (const g of warnGaps) log(`    ${C.dim}note: ${g}${C.reset}`);
}

// ── Summary ─────────────────────────────────────────────────────────────────
const ok = results.filter((r) => r.ok);
const bad = results.filter((r) => !r.ok);

log(`\n${C.bold}Summary${C.reset}  (${DRY_RUN ? 'DRY-RUN' : 'REAL'})`);
log(`  publishable (ready): ${C.green}${ok.length}${C.reset}/${results.length}`);
if (bad.length) log(`  not ready / failed:  ${C.yellow}${bad.length}${C.reset}`);
log(`  proprietary (held private, never published): ${config.proprietaryDoNotPublish.join(', ')}`);

if (JSON_OUT) {
  process.stdout.write(JSON.stringify({
    mode: DRY_RUN ? 'dry-run' : 'real',
    whoami,
    ready: ok.map((r) => ({ name: r.name, version: r.version, level: r.level, stats: r.stats })),
    notReady: bad.map((r) => ({ dir: r.dir, name: r.name, version: r.version, gaps: r.gaps, error: r.error })),
    proprietaryHeldPrivate: config.proprietaryDoNotPublish,
  }, null, 2) + '\n');
}

if (readinessFailures > 0) {
  log(`\n${C.yellow}${readinessFailures} package(s) need readiness fixes before a real publish.${C.reset}`);
  // Dry-run with gaps is informational (exit 0 unless a hard error occurred).
}

if (REAL_PUBLISH && bad.length > 0) {
  die(`real publish requested but ${bad.length} package(s) failed/were-not-ready. See above.`);
}

if (DRY_RUN) {
  log(`\n${C.dim}This was a dry-run. Nothing was published.` +
      ` Real publish: ${C.reset}${C.bold}node scripts/publish-npm.mjs --yes-publish${C.reset}` +
      `${C.dim} (founder, after \`npm login\`).${C.reset}`);
}
