import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { checkGeometry, carregarChromium } from "../ui-geometry.mjs";

const fx = (n) => pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", n)).href;
let skip = false;
try { const c = await carregarChromium(); const b = await c.launch(); await b.close(); } catch (e) { skip = `Playwright/Chromium indisponível: ${String(e.message).split("\n")[0]}`; }

test("fixture que reprova: painel fixo cobre o botão e a rolagem não resolve", { skip }, async () => {
  const r = await checkGeometry({ url: fx("bad.html"), target: "#cta", overlay: "#painel" });
  assert.equal(r.ok, false);
  assert.equal(r.falhas.length >= 2, true, r.falhas.join("\n")); // 320x568 e 360x640 (em 390x844 a página cabe acima do painel)
  assert.match(r.falhas[0], /inalcançável/);
});
test("fixture que passa: painel reserva espaço e o botão fica acima dele", { skip }, async () => {
  const r = await checkGeometry({ url: fx("good.html"), target: "#cta", overlay: "#painel" });
  assert.deepEqual(r.falhas, []);
});
test("alvo inexistente reprova", { skip }, async () => {
  const r = await checkGeometry({ url: fx("good.html"), target: "#nao-existe", viewports: [{ width: 320, height: 568 }] });
  assert.equal(r.ok, false); assert.match(r.falhas[0], /não existe/);
});
test("--action abre o overlay (eval) e a verificação roda depois da ação", { skip }, async () => {
  const r = await checkGeometry({ url: fx("good.html"), target: "#cta", overlay: "#painel", action: "eval:document.getElementById('painel').style.height='90vh'", viewports: [{ width: 390, height: 844 }] });
  assert.equal(r.ok, false, "painel de 90vh passa a cobrir o botão (padding só reserva 40vh)");
});
