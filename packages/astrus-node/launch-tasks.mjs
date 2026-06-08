// Dogfood: rastrear o programa cachola.tech/launch no TaskLog do Batiste
// (@batiste-aidk/audit), não em tracker de terceiro. Idempotente (dedup por subject).
// uso: node launch-tasks.mjs            -> seed + lista
//      node launch-tasks.mjs list       -> só lista
//      node launch-tasks.mjs set "<subject>" <status>
import * as audit from "@batiste-aidk/audit";
import { randomUUID } from "node:crypto";
const tl = new audit.TaskLog("cachola-launch.db");
if (typeof tl.init === "function") await tl.init();

const PROGRAM = [
  ["completed",   "Q&A entrevista NeoFeed (walk-back dos números)", "Prep da entrevista; números refutados, defesa abstrata, open-core. releases/2026-06-08-neofeed-interview-prep-v1/"],
  ["completed",   "Kit Claude Design cachola.tech (casa de produto, 4-lang)", "Reposicionamento + portfolio + copy PT/EN/NL/ZH. products/cacholatech/claude-design-kit/"],
  ["completed",   "Post LinkedIn auto-promoção (PT+EN)", "Envelope PR-safe, recibos no lugar de slogan. products/cacholatech/comms/"],
  ["completed",   "STL MAJU-1 (closed/body/lid) + componentes", "Geometria afinada; esp32/bme280/yl83/cable. products/maju-landing/viewer/"],
  ["in_progress", "Security headers tunados em todas as páginas", "CSP/HSTS/frame por site. cachola.tech=ouro; teaser+maju feito (deploy); falta Sereno + Argus (repos separados)"],
  ["pending",     "Hardening das Functions (método+origem+rate-limit)", "/api/lead e /api/checkout: restringir método, checar origin, rate-limit KV"],
  ["pending",     "Turnstile nos forms (lead+checkout)", "CAPTCHA invisível + verificação server-side; skill turnstile-spin (precisa API CF)"],
  ["pending",     "E-mail de aviso de lead/pré-venda", "Hoje lead cai no KV em silêncio; wirar notificação (MailChannels/Resend)"],
  ["pending",     "STL família (1S/2/R) + watermark Cachola Tech", "R do maju-R.scad; 1S/2 do chassi compartilhado; watermark no SCAD -> regen tudo (sem stale)"],
  ["pending",     "Gate de higiene: check de derivado stale", "Ponto cego: gate passou com STL velho. Falhar se derivado (.stl/.png) mais velho que fonte (.scad)"],
];

const arg = process.argv[2];
if (arg === "set") {
  const all = await tl.list();
  const t = all.find((x) => x.subject === process.argv[3]);
  if (t) { await tl.update(t.id, { status: process.argv[4], updatedAt: new Date().toISOString() }); console.log("ok:", t.subject, "->", process.argv[4]); }
  else console.log("não achei:", process.argv[3]);
} else if (arg !== "list") {
  const existing = new Map((await tl.list()).map((t) => [t.subject, t]));
  for (const [status, subject, description] of PROGRAM) {
    const now = new Date().toISOString();
    if (existing.has(subject)) { await tl.update(existing.get(subject).id, { status, description, updatedAt: now }); }
    else { await tl.create({ id: randomUUID(), createdAt: now, updatedAt: now, status, subject, description, stream: "cachola-launch", sessionId: "cachola-launch", metadata: {} }); }
  }
}
const all = await tl.list();
const order = { in_progress: 0, pending: 1, completed: 2 };
all.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
const icon = { completed: "✔", in_progress: "▶", pending: "·" };
console.log(`\nTaskLog Batiste · cachola-launch (${all.length}):`);
for (const t of all) console.log(` ${icon[t.status] || "?"} [${t.status}] ${t.subject}`);
