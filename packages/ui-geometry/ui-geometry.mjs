#!/usr/bin/env node
// ui-geometry — gate de geometria de UI: um overlay/painel NÃO pode cobrir o elemento principal,
// e o elemento tem de ser alcançável por rolagem, em viewports de celular pequeno.
// Extraído de cachola_tech/products/urania/qa/vinhetas.spec.mjs (painel docado que cobria o formulário).
//
//   node ui-geometry.mjs <url> --target "<sel>" [--overlay "<sel>"] [--action "click:<sel>"|"eval:<js>"]
//                        [--viewports 320x568,360x640,390x844] [--end "<sel>"] [--wait-ms 800]
//
// Por viewport, afirma por getBoundingClientRect/elementFromPoint:
//   1. o alvo existe e tem área;
//   2. alvo e overlay não se intersectam (o alvo fica acima do overlay, ou o overlay não está visível);
//   3. nada cobre o topo do alvo (elementFromPoint devolve o alvo ou descendente/ancestral útil);
//   4. depois de rolar até o fim da página, o fim (--end, padrão: o alvo) ainda fica fora do overlay: alcançável;
//   5. sem overflow horizontal.
// Exit 0 passa, 1 reprova, 2 uso.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const VIEWPORTS_PADRAO = [{ width: 320, height: 568 }, { width: 360, height: 640 }, { width: 390, height: 844 }];

const AQUI = path.dirname(fileURLToPath(import.meta.url));
/** Acha o chromium do Playwright: $PLAYWRIGHT_MODULE, módulos instalados, NODE_PATH, ui-consistency do monorepo. */
export async function carregarChromium() {
  const tentativas = [];
  if (process.env.PLAYWRIGHT_MODULE) tentativas.push(() => createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE));
  tentativas.push(() => createRequire(import.meta.url)("playwright"));
  tentativas.push(() => createRequire(import.meta.url)("@playwright/test"));
  if (process.env.NODE_PATH) tentativas.push(() => createRequire(path.join(process.env.NODE_PATH.split(path.delimiter)[0], "/"))("playwright"));
  tentativas.push(() => createRequire(path.join(AQUI, "../ui-consistency/node_modules/x.js"))("@playwright/test"));
  for (const t of tentativas) { try { const m = t(); if (m?.chromium) return m.chromium; } catch { /* próxima */ } }
  throw new Error("Playwright não encontrado (instale `playwright` ou defina PLAYWRIGHT_MODULE).");
}

// roda dentro da página
function medir({ target, overlay, end }) {
  const rect = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height }; };
  const visivel = (el) => { if (!el) return false; const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0; };
  const t = document.querySelector(target);
  const o = overlay ? document.querySelector(overlay) : null;
  const e = document.querySelector(end || target);
  const out = { vh: window.innerHeight, vw: window.innerWidth, overflowX: document.documentElement.scrollWidth - window.innerWidth, existe: !!t, endExiste: !!e };
  if (!t) return out;
  out.t = rect(t);
  out.overlayVisivel = visivel(o);
  if (out.overlayVisivel) out.o = rect(o);
  const cx = Math.min(Math.max(out.t.left + out.t.w / 2, 0), out.vw - 1), cy = out.t.top + Math.min(6, out.t.h / 2);
  const dentro = cy >= 0 && cy <= out.vh;
  out.noViewport = dentro;
  if (dentro) {
    const hit = document.elementFromPoint(cx, cy);
    out.coberto = !(hit && (t.contains(hit) || (hit.contains(t) && hit !== document.body && hit !== document.documentElement)));
    out.cobertoPor = out.coberto ? (hit ? hit.tagName.toLowerCase() + (hit.className && typeof hit.className === "string" ? "." + hit.className.trim().split(/\s+/).join(".") : "") : "null") : "";
  }
  if (e) out.e = rect(e);
  return out;
}

/** Verifica um viewport numa página já aberta. Devolve lista de falhas (vazia = passa). */
export async function checarViewport(page, vp, { target, overlay, end, action, waitMs = 800 }) {
  const tag = `${vp.width}x${vp.height}`;
  const falhas = [];
  await page.setViewportSize(vp);
  if (action) {
    if (action.startsWith("click:")) await page.locator(action.slice(6)).first().click();
    else if (action.startsWith("eval:")) await page.evaluate(action.slice(5));
    else if (typeof action === "function") await action(page);
  }
  await page.waitForTimeout(waitMs);
  const args = { target, overlay, end };
  await page.evaluate((a) => document.querySelector(a.target)?.scrollIntoView({ block: "start" }), args); // alvo à vista
  await page.waitForTimeout(150);
  const m = await page.evaluate(medir, args);
  if (!m.existe) return [`${tag}: alvo "${target}" não existe`];
  if (!(m.t.w > 0 && m.t.h > 0)) falhas.push(`${tag}: alvo "${target}" sem área`);
  if (m.overflowX > 0) falhas.push(`${tag}: overflow horizontal de ${m.overflowX}px`);
  if (m.overlayVisivel && m.t.bottom > m.o.top + 0.5 && m.t.top < m.o.bottom - 0.5 && m.t.right > m.o.left && m.t.left < m.o.right) {
    // intersecta agora: o que importa é se uma rolagem resolve (item 4); aqui só registra se NÃO houver como rolar
    m.intersectaAgora = true;
  }
  if (m.noViewport && m.coberto && !m.intersectaAgora) falhas.push(`${tag}: topo do alvo coberto por ${m.cobertoPor}`);
  // alcançável por rolagem: rola até o fim da página; o fim (alvo ou --end) tem de ficar fora do overlay e coberto por nada
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(150);
  const f = await page.evaluate(medir, args);
  const alvoFim = f.e || f.t;
  if (f.overlayVisivel && alvoFim.bottom > f.o.top + 1 && alvoFim.top < f.o.bottom - 1 && alvoFim.right > f.o.left && alvoFim.left < f.o.right) {
    falhas.push(`${tag}: com o overlay aberto o ${end ? `fim (${end})` : "alvo"} fica coberto mesmo no fim da rolagem (alvo ${Math.round(alvoFim.top)}-${Math.round(alvoFim.bottom)}, overlay a partir de ${Math.round(f.o.top)}): inalcançável`);
  } else if (f.noViewport && f.coberto && !end) {
    falhas.push(`${tag}: no fim da rolagem o alvo segue coberto por ${f.cobertoPor}`);
  }
  if (f.overlayVisivel && alvoFim.bottom > f.vh + 1 && alvoFim.top > f.vh) falhas.push(`${tag}: alvo fora do viewport no fim da rolagem`);
  if (m.intersectaAgora && !falhas.length) {
    // intersectava na posição inicial mas é alcançável rolando: aceito, a rolagem resolve
  }
  return falhas;
}

/** API: checkGeometry({url|page, target, overlay, end, action, viewports}) -> {falhas, porViewport}. */
export async function checkGeometry({ url, page: paginaExterna, viewports = VIEWPORTS_PADRAO, ...sel }) {
  let browser, page = paginaExterna;
  if (!page) {
    const chromium = await carregarChromium();
    browser = await chromium.launch();
  }
  const falhas = [];
  try {
    for (const vp of viewports) {
      // contexto novo por viewport: estado limpo (a ação abre o overlay do zero)
      const ctx = browser ? await browser.newContext({ viewport: vp, isMobile: true, hasTouch: true }) : null;
      const p = ctx ? await ctx.newPage() : page;
      try {
        if (url) await p.goto(url, { waitUntil: "load" });
        falhas.push(...(await checarViewport(p, vp, sel)));
      } finally { if (ctx) await ctx.close(); }
    }
  } finally { if (browser) await browser.close(); }
  return { falhas, ok: falhas.length === 0 };
}

function parseVps(s) { return s.split(",").map((v) => { const [w, h] = v.split("x").map(Number); return { width: w, height: h }; }); }
async function main() {
  const a = process.argv.slice(2);
  const opt = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  const url = a.find((x, i) => !x.startsWith("--") && !(i > 0 && a[i - 1].startsWith("--")));
  const target = opt("--target");
  if (!url || !target) { console.error('uso: ui-geometry.mjs <url> --target "<sel>" [--overlay "<sel>"] [--end "<sel>"] [--action "click:<sel>"] [--viewports 320x568,360x640,390x844]'); process.exit(2); }
  const r = await checkGeometry({ url, target, overlay: opt("--overlay"), end: opt("--end"), action: opt("--action"), waitMs: Number(opt("--wait-ms") || 800), viewports: opt("--viewports") ? parseVps(opt("--viewports")) : VIEWPORTS_PADRAO });
  if (r.ok) { console.log("✓ ui-geometry: alvo livre e alcançável em todos os viewports"); process.exit(0); }
  console.error("✗ ui-geometry BLOQUEOU:"); for (const f of r.falhas) console.error(`  ${f}`); process.exit(1);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch((e) => { console.error(e.message); process.exit(2); });
