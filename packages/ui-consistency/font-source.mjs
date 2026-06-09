// @batiste-aidk/ui-consistency — CHECK: self-host fonts, never CDN.
// STATIC (no browser): scans a product's .html/.css source for live references to
// Google's webfont CDN (fonts.googleapis.com / fonts.gstatic.com). On a locked-down
// corporate Windows PC those hosts are blocked → text renders in the ugly fallback
// ("texto zuado / sem formatação"). A company selling on-prem/sovereign software
// must self-host the woff2 (font-src 'self'). This is the gate that catches it
// before a tester does.
//
// Pure functions, importable from tests without Playwright/Chrome.
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";

export const CDN_FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];
const CDN_RE = new RegExp(CDN_FONT_HOSTS.map((h) => h.replace(/\./g, "\\.")).join("|"), "i");
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".wrangler", "_scratch"]);

// Strip comment bodies so a documented "we removed fonts.gstatic" note passes.
// HTML  <!-- ... -->  and CSS  /* ... */  spans are blanked (length-preserving
// so line/column reporting downstream stays honest); per-line "#" comments
// (e.g. Cloudflare _headers) are handled where _headers is parsed.
function blankComments(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

function walk(dir, exts, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, exts, out);
    else if (exts.has(extname(name).toLowerCase())) out.push(full);
  }
  return out;
}

// Returns { offenders: [{file, line, text}], warnings: [{file, line, text}] }.
// offenders → live CDN-font refs in .html/.css (FAIL).
// warnings  → a CSP (in _headers or a <meta http-equiv> elsewhere) whose
//             font-src/style-src still trusts the CDN host (CSP allowance,
//             non-fatal but worth flagging).
export function scanForCdnFonts(sourceDir) {
  const offenders = [];
  const warnings = [];

  // 1) live CDN refs in .html / .css (comment-stripped)
  for (const file of walk(sourceDir, new Set([".html", ".css"]))) {
    let raw;
    try { raw = readFileSync(file, "utf8"); } catch { continue; }
    const stripped = blankComments(raw);
    const lines = stripped.split("\n");
    const rawLines = raw.split("\n");
    lines.forEach((line, i) => {
      if (CDN_RE.test(line)) offenders.push({ file, line: i + 1, text: rawLines[i].trim() });
    });
  }

  // 2) CSP allowance warning — Cloudflare _headers + <meta http-equiv CSP>.
  //    Only flags font-src / style-src directives that name the CDN host.
  for (const file of walk(sourceDir, new Set([".html"]))) {
    let raw;
    try { raw = readFileSync(file, "utf8"); } catch { continue; }
    for (const m of raw.matchAll(/content-security-policy[^>]*content\s*=\s*["']([^"']+)["']/gi)) {
      cspWarn(file, m[1], warnings);
    }
  }
  for (const file of walk(sourceDir, new Set([""]))) {
    if (!file.endsWith("/_headers")) continue;
    let raw;
    try { raw = readFileSync(file, "utf8"); } catch { continue; }
    for (const rawLine of raw.split("\n")) {
      const line = rawLine.trim();
      if (line.startsWith("#")) continue; // documented comment in _headers
      const m = line.match(/content-security-policy\s*:\s*(.+)$/i);
      if (m) cspWarn(file, m[1], warnings);
    }
  }

  return { offenders, warnings };
}

function cspWarn(file, csp, warnings) {
  for (const directive of csp.split(";")) {
    const d = directive.trim();
    if (/^(font-src|style-src)\b/i.test(d) && CDN_RE.test(d)) {
      warnings.push({ file, line: 0, text: d });
    }
  }
}

export const CDN_FONT_FAIL_MSG =
  "CDN webfont reference found — self-host the woff2 (font-src 'self'); CDN fonts break on locked-down/corporate networks.";

// Convenience for CLI: scan, print, return failure count.
export function reportCdnFonts(name, sourceDir) {
  const { offenders, warnings } = scanForCdnFonts(sourceDir);
  console.log(`\n## ${name} — font-source (self-host, never CDN)`);
  for (const w of warnings) {
    console.log(`  ⚠ CSP still trusts CDN font host: ${w.file}\n      ${w.text}`);
  }
  if (offenders.length === 0) {
    console.log("  ✓ no live CDN webfont references in .html/.css");
    return 0;
  }
  console.log(`  ✗ ${CDN_FONT_FAIL_MSG}`);
  for (const o of offenders) {
    console.log(`      ${o.file}:${o.line}  ${o.text}`);
  }
  return offenders.length;
}
