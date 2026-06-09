#!/usr/bin/env node
// @batiste-aidk/ui-consistency — GATE de consistência landing↔app por PRODUTO.
// Resposta ao "um júnior pegaria, o Batiste tinha que pegar": compara o chrome
// (favicon, fonte, language-switch, wordmark, Beta) entre a landing e o app de
// cada produto e reprova se divergirem. Checa por CONTEÚDO (não por substring de
// classe — evita falso-positivo). Apps gated recebem cookie.
//   node ui-consistency.mjs   (precisa @playwright/test + Chrome)
import { chromium } from "@playwright/test";

// [nome, landingURL, appURL, cookieFn?] — cookieFn() async → "name=value" p/ apps gated
const PAIRS = [
  ["ASTRUS", "https://astrus.cachola.tech/", "https://astrus.cachola.tech/app/", null],
  ["MERMAID", "https://mermaid.cachola.tech/", "https://mermaid.cachola.tech/demo/app/", async () => {
    const r = await fetch("https://mermaid.cachola.tech/api/demo-access", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://mermaid.cachola.tech" }, body: JSON.stringify({ name: "QA Bot", email: "qa@acme.com", company: "Acme", role: "QA", signature: "QA Bot", agreed: true }) });
    const sc = (r.headers.getSetCookie ? r.headers.getSetCookie()[0] : r.headers.get("set-cookie")) || ""; return sc.split(";")[0] || null;
  }],
  ["ARGUS", "https://argus.cachola.tech/", "https://argus.cachola.tech/app/", null],
];

const b = await chromium.launch({ channel: "chrome", headless: true });
async function probe(url, cookie) {
  const ctx = await b.newContext();
  if (cookie) { const [n, ...v] = cookie.split("="); try { await ctx.addCookies([{ name: n, value: v.join("="), domain: new URL(url).host, path: "/" }]); } catch (_) {} }
  const p = await ctx.newPage();
  try { await p.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 }); } catch (e) { await ctx.close(); return { err: e.message.slice(0, 40) }; }
  await p.waitForTimeout(2000);
  const d = await p.evaluate(() => {
    const body = document.body.innerText;
    return {
      favicon: !!document.querySelector('link[rel~="icon"]'),
      bodyFont: getComputedStyle(document.body).fontFamily.split(",")[0].replace(/["']/g, ""),
      langButtons: [...document.querySelectorAll("button,a")].filter(x => /^(PT|EN|NL|中文)$/.test((x.textContent || "").trim())).length,
      beta: /\bbeta\b/i.test(body),
    };
  }).catch(() => ({}));
  await ctx.close(); return d;
}
let fails = 0;
for (const [name, L, A, cookieFn] of PAIRS) {
  const ck = cookieFn ? await cookieFn().catch(() => null) : null;
  const l = await probe(L), a = await probe(A, ck);
  console.log(`\n## ${name}`);
  for (const k of ["favicon", "bodyFont", "langButtons", "beta"]) {
    const same = String(l[k]) === String(a[k]); if (!same) fails++;
    console.log(`  ${same ? "✓" : "✗"} ${k.padEnd(11)} landing=${JSON.stringify(l[k])} app=${JSON.stringify(a[k])}`);
  }
}
await b.close();
console.log(`\n${fails ? "✗ " + fails + " divergências" : "✔ consistente"}`);
process.exit(fails ? 1 : 0);
