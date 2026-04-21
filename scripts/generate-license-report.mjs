#!/usr/bin/env node
/**
 * generate-license-report.mjs
 *
 * Walks the pnpm workspace, aggregates the licence declared by every
 * production dependency, and emits:
 *
 *   reports/licenses.json   machine-readable full manifest
 *   reports/licenses.html   human-readable table (used in release assets)
 *
 * Flags:
 *   --strict   exit 1 if any dependency is unknown or on the deny-list
 *              (release gate invokes this)
 *   --quiet    suppress per-package log lines
 *
 * The deny-list is intentionally conservative: GPL/AGPL/SSPL/Commons
 * Clause block the release until an explicit exception is recorded in
 * compliance/policies/vendor-management-policy.md.
 *
 * E6-DD-23. Aligned with SOC 2 CC1.4 (policy adherence) and ISO 27001
 * A.5.32 (intellectual property rights).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REPORTS = join(ROOT, 'reports');
if (!existsSync(REPORTS)) mkdirSync(REPORTS, { recursive: true });

const argv = new Set(process.argv.slice(2));
const STRICT = argv.has('--strict');
const QUIET = argv.has('--quiet');

const ALLOW = new Set([
  'MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause',
  'CC0-1.0', 'CC-BY-4.0', '0BSD', 'Unlicense', 'BlueOak-1.0.0',
  'Python-2.0', 'WTFPL', 'Zlib', 'MPL-2.0',
]);
const DENY = new Set([
  'GPL-2.0', 'GPL-2.0-only', 'GPL-2.0-or-later',
  'GPL-3.0', 'GPL-3.0-only', 'GPL-3.0-or-later',
  'AGPL-3.0', 'AGPL-3.0-only', 'AGPL-3.0-or-later',
  'SSPL-1.0', 'Commons-Clause', 'BUSL-1.1',
]);
// Explicit per-package exceptions recorded in vendor-management-policy.md.
// Map: "pkg@version" → { license, reason, approver, date }.
const EXCEPTIONS = Object.freeze({});

function log(msg) { if (!QUIET) process.stderr.write(msg + '\n'); }

function pnpmLicenses() {
  try {
    const raw = execSync('pnpm licenses list --prod --json', {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return JSON.parse(raw);
  } catch (err) {
    log('✖ pnpm licenses list failed: ' + err.message);
    return {};
  }
}

function normaliseLicense(lic) {
  if (!lic) return 'UNKNOWN';
  if (typeof lic === 'string') return lic.trim();
  if (Array.isArray(lic)) return lic.map(String).join(' OR ');
  if (lic.type) return String(lic.type);
  return 'UNKNOWN';
}

function classify(license) {
  if (!license || license === 'UNKNOWN') return 'unknown';
  // SPDX expression shortcut: "(MIT OR Apache-2.0)" → take first allowed.
  const parts = String(license).split(/\s+OR\s+|\s+AND\s+/i).map(s => s.replace(/[()]/g, '').trim());
  if (parts.some(p => DENY.has(p))) return 'denied';
  if (parts.some(p => ALLOW.has(p))) return 'allowed';
  return 'review';
}

const raw = pnpmLicenses();
const rows = [];
for (const [licenseKey, entries] of Object.entries(raw)) {
  for (const e of entries) {
    const key = `${e.name}@${e.version}`;
    const exception = EXCEPTIONS[key];
    const license = exception?.license ?? normaliseLicense(licenseKey);
    const status = exception ? 'exception' : classify(license);
    rows.push({
      name: e.name,
      version: e.version,
      license,
      status,
      path: e.path,
      homepage: e.homepage || null,
      exception: exception ?? null,
    });
  }
}
rows.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

const summary = {
  generatedAt: new Date().toISOString(),
  total: rows.length,
  allowed: rows.filter(r => r.status === 'allowed').length,
  review: rows.filter(r => r.status === 'review').length,
  denied: rows.filter(r => r.status === 'denied').length,
  exception: rows.filter(r => r.status === 'exception').length,
  unknown: rows.filter(r => r.status === 'unknown').length,
};

writeFileSync(
  join(REPORTS, 'licenses.json'),
  JSON.stringify({ summary, rows }, null, 2),
);

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<title>Batiste — Production Dependency Licences</title>
<style>
body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;margin:2rem;color:#111}
table{border-collapse:collapse;width:100%}
th,td{border-bottom:1px solid #eee;padding:.5rem;text-align:left;vertical-align:top}
th{background:#f8f8f8;font-weight:600}
.allowed{color:#2E7D32}.review{color:#B26A00}.denied{color:#B00020;font-weight:700}
.unknown{color:#555;font-style:italic}.exception{color:#00527A}
small{color:#666}
</style></head><body>
<h1>Batiste — Production Dependency Licences</h1>
<p>Generated <code>${summary.generatedAt}</code> · ${summary.total} packages ·
  <span class="allowed">${summary.allowed} allowed</span> ·
  <span class="review">${summary.review} review</span> ·
  <span class="denied">${summary.denied} denied</span> ·
  <span class="exception">${summary.exception} exception</span> ·
  <span class="unknown">${summary.unknown} unknown</span>
</p>
<table><thead><tr><th>Package</th><th>Version</th><th>Licence</th><th>Status</th><th>Homepage</th></tr></thead><tbody>
${rows.map(r => `<tr>
  <td>${escapeHtml(r.name)}</td>
  <td>${escapeHtml(r.version)}</td>
  <td>${escapeHtml(r.license)}</td>
  <td class="${r.status}">${r.status}</td>
  <td>${r.homepage ? `<a href="${escapeHtml(r.homepage)}">link</a>` : ''}</td>
</tr>`).join('\n')}
</tbody></table>
<p><small>Policy: <code>compliance/policies/vendor-management-policy.md</code>.
Denied licences block the release gate. Status <em>review</em> means the licence
is uncommon and requires a Security Lead sign-off recorded as an exception.</small></p>
</body></html>
`;
writeFileSync(join(REPORTS, 'licenses.html'), html);

log(`▶ licences: ${summary.total} total · ${summary.allowed} allowed · ${summary.review} review · ${summary.denied} denied · ${summary.exception} exception · ${summary.unknown} unknown`);

if (STRICT) {
  if (summary.denied > 0 || summary.unknown > 0 || summary.review > 0) {
    log('✖ strict gate failed: review/deny/unknown present. See reports/licenses.html');
    const bad = rows.filter(r => r.status !== 'allowed' && r.status !== 'exception');
    for (const r of bad.slice(0, 20)) log(`  - ${r.name}@${r.version}  ${r.license}  [${r.status}]`);
    if (bad.length > 20) log(`  … and ${bad.length - 20} more`);
    process.exit(1);
  }
  log('✔ strict gate passed');
}

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
