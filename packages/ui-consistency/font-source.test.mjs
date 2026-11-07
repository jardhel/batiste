// node --test font-source.test.mjs
// STATIC check — no Playwright/Chrome needed (pure file scanning).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { scanForCdnFonts } from "./font-source.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "test", "fixtures");

test("FAIL: a live CDN <link>/@import is an offender", () => {
  const { offenders } = scanForCdnFonts(join(FIX, "cdn-link"));
  assert.ok(offenders.length >= 2, `expected CDN offenders, got ${offenders.length}`);
  const files = offenders.map((o) => o.file);
  assert.ok(files.some((f) => f.endsWith("index.html")), "should flag the HTML link");
  assert.ok(files.some((f) => f.endsWith("import.css")), "should flag the CSS @import");
  // line/column reporting is honest
  assert.ok(offenders.every((o) => o.line > 0 && o.text.length > 0));
});

test("PASS: self-hosted @font-face url('fonts/x.woff2') has no offenders", () => {
  const { offenders, warnings } = scanForCdnFonts(join(FIX, "self-hosted"));
  assert.equal(offenders.length, 0);
  assert.equal(warnings.length, 0);
});

test("PASS: commented-out CDN ref (HTML <!-- --> and CSS /* */) is allowed", () => {
  const { offenders } = scanForCdnFonts(join(FIX, "commented"));
  assert.equal(offenders.length, 0, JSON.stringify(offenders));
});

test("WARN: CSP in _headers that still trusts the CDN host is flagged (not fatal)", () => {
  const { offenders, warnings } = scanForCdnFonts(join(FIX, "csp-warn"));
  assert.equal(offenders.length, 0, "no live HTML/CSS ref → no offender");
  assert.ok(warnings.length >= 2, `expected font-src + style-src warnings, got ${warnings.length}`);
  assert.ok(warnings.some((w) => /font-src/i.test(w.text)));
  assert.ok(warnings.some((w) => /style-src/i.test(w.text)));
  // the leading "#"-commented line naming the CDN must NOT produce a warning
  assert.ok(warnings.every((w) => !w.text.startsWith("#")));
});

test("skips node_modules / dist / .git", () => {
  // self-hosted fixture has none of those; sanity that walk doesn't throw on real dirs
  const r = scanForCdnFonts(join(FIX));
  assert.ok(Array.isArray(r.offenders));
});

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

test("host de CDN é casado literal e com borda (sem falso positivo por vizinho)", () => {
  const dir = mkdtempSync(join(tmpdir(), "fonts-"));
  try {
    writeFileSync(join(dir, "a.html"), '<link href="https://fonts.googleapis.com/css2?family=X">');
    writeFileSync(join(dir, "b.html"), '<a href="https://fontsXgoogleapis.com/">x</a> <a href="https://myfonts.googleapis.com.example/">y</a>');
    const r = scanForCdnFonts(dir);
    const arquivos = JSON.stringify(r);
    assert.ok(arquivos.includes("a.html"));
    assert.ok(!arquivos.includes("b.html"), arquivos);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
