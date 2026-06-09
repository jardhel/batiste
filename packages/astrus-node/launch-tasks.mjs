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
  // ===== GOAL (2026-06-08): Astrus em produção, MAJU-1 comprável =====
  ["completed",   "🎯 GOAL: Astrus BUYABLE no ar", "FEITO E2E: astrus.cachola.tech vende MAJU-1 via Stripe cs_live (4 línguas). Bug raiz = phone_number_collection malformado, NÃO a chave (sk_live ok). Waitlist grava KV; cobertura/CSP ok"],
  ["completed",   "Checkout: corrigir phone_number_collection", "Stripe queria [enabled]=true; cs_live verificado pt/en/nl/zh; .assetsignore esconde dev files; deploy prod"],
  ["completed",   "Astrus i18n gap (cobertura.js/maju.html) → 4-lang", "Pente-fino: gap REAL, não cache. cobertura.js T(pt,en) servia PT pra NL/ZH; ~33 strings; corrigido por agente, audit 10/10. FALTA deploy"],
  ["completed",   "cachola.tech: matar vazamento interno", "pitch-defesa/red-team/Silv.IA/Griphon PDF estavam PÚBLICOS (deploy da pasta Downloads sem auditar). Removidos do deploy; user purgou o cache de edge"],
  ["completed",   "Sereno (app.astrus): 4-lang + botões", "Sem langswitch; login=caixa de erro. Add PT/EN/NL/ZH (128 chaves)+'coming soon' neutro; tsc+10/10. FALTA deploy"],
  ["completed",   "MAJU-1 dome: DfAM fix (Adam) + manual", "Orelhas/pilares mergulhavam (z=0/2.2 vs pé 3.0)→suporte. Flush z=3.0, fundo plano, STL regen; manual PDF c/ design note; REPLY_ADAM.txt"],
  ["completed",   "Cookie consent 4-lang (todas as páginas)", "Componente reusável; cabado em mermaid/cachola.tech/astrus-front/Sereno. FALTA deploy"],
  ["completed",   "Mermaid demo: Acme + personas físicos", "Effect Photonics/Stijn removidos do build público; personas=Tesla/Einstein/Curie/Kao/Feynman; zero leak no bundle"],
  ["completed",   "Mermaid: portão lead profissional + e-NDA", "/demo/ = gate 4-lang → /api/demo-access grava aceite no KV + cookie HMAC → middleware gateia /demo/app/"],
  ["completed", "Mermaid: app nativo 4-línguas", "Agente Claude Code editando products/mermaid/src (i18n infra+LangSwitch+abas). RESSALVA: execução FORA do Batiste"],
  ["completed",     "Mermaid: tema híbrido Light/Dark/Dracula + favicon", "Tokens semânticos (Metabase+landing+app antigo), switcher Slack-like; após i18n pra não conflitar no src"],
  ["completed",     "Deploy lote (autorizado): mermaid+astrus-front+sereno+cachola.tech", "mermaid leva gate+i18n+tema+cookie; cada deploy precisa autorização explícita"],
  // ===== Batiste-native — a falha de fundo do dia: ops rodando FORA do Batiste =====
  ["completed",     "Gate @batiste-aidk/deploy-lineage", "Recusa deploy de fonte untracked/dirty/fora do registro; carimba SHA via @batiste-aidk/audit. O gate que FALTOU (deployei cru o dia todo; o classificador do harness virou o gate de fato)"],
  ["completed",     "Gate @batiste-aidk/dfam-preflight", "Reprova STL: fundo não-coplanar / overhang>55° / não-manifold / fora do bed / feature<mín. O assert 'fundo plano' teria pego o bug do Adam (Adam virou nosso QA)"],
  ["completed",     "DEPLOYMENTS.md — registro verificado", "domínio→projeto Pages→fonte git→comando que prova. Lineage de deploy que nunca existiu"],
  ["completed",     "Commitar fontes untracked + .gitignore", "astrus-front/mermaid-landing/cacholatech/argus estavam ?? no git; cachola.tech vinha de Downloads. Ignorar node_modules/.wrangler/dist"],
  ["pending",     "Rodar paralelização via @batiste-aidk/parallel", "Hoje paralelizei com sub-agentes do Claude Code, não pelo parallel+TaskLog do Batiste. Migrar pra dogfood real"],
  ["pending",     "QA NeoFeed PDF pra Fran (LaTeX)", "build pandoc→xelatex; suavizar meta-coaching interno"],
  // ===== Astrus auth/tiers (2026-06-08) =====
  ["completed",   "Astrus auth CORE (magic-link backend)", "Web Crypto edge (não @batiste-aidk/auth Node-only); /api/auth/{request,verify,me,logout} + _lib/{auth,tiers}; deployado pelo gate; verificado: me=anon, request=ok(email-pendente), verify(bad)=400, logout=302, checkout coexiste"],
  ["pending",     "Astrus: ativar e-mail do login (RESEND_API_KEY)", "BLOQUEIO: magic-link precisa de provedor pra entregar. Setar RESEND_API_KEY → login E2E + UI no /app/ destravam"],
  ["completed",   "Astrus: billing code (/api/subscribe + tiers)", "subscribe em modo assinatura, resolve price via _lib/tiers; deployado pelo gate; honesto 'em configuração' até price existir. Código de billing COMPLETO."],
  ["pending",     "Astrus: criar os prices Stripe (ativar tiers)", "ÚNICO bloqueio dos tiers agora: criar os ~16 prices na conta Stripe (ação de $ semi-irreversível). Aguarda 'go' do user — eu executo via function admin temp c/ a chave instalada. Aí subscribe vira cs_live."],
  ["pending",     "Astrus: UI de login + gating no /app/", "shell construível; usabilidade depende do e-mail (acima)"],
  ["pending",     "Caixa: revisar bays + janela de chuva (fit-test)", "BLOQUEIO: medir as peças na bancada quando chegarem; dfam-preflight roda no STL revisado antes dos 5 finais"],
  // ===== Crise de qualidade/consistência (2026-06-09) =====
  ["completed",   "Gate @batiste-aidk/ui-consistency + fix landing↔app", "Junior pegaria, Batiste não pegava → gate criado. Astrus/Mermaid/Argus agora GREEN (favicon/fonte/langswitch/wordmark/Beta), verificado por conteúdo, deployado pelo gate de lineage"],
  ["pending",     "Batiste README: revisar e publicar", "Reescrito 3-lentes: matou 446→438 testes, kill-switch <1ms fabricado, connectors 'proprietário'→MIT; open-core honesto; AI-tells mortos; Hive Mind rebaixado; seção dogfood honesta. AGUARDA sua revisão (não pushei)"],
  ["pending",     "Decidir naming 'Hive Mind' (bench activeloop)", "Bench: 'Hive Mind' é tagline quase-verbatim do activeloopai/hivemind (YC, mesmo domínio) + genérico. Rebaixar como marquee; liderar com orquestração-auditada. PR canon (press release Fran) também usa → candidato a /pr-audit"],
  ["pending",     "GPS Voador: OSINT/RUMINT outdated", "Outro produto (vertical eleitoral); tratar separado da crise Astrus/Mermaid"],
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
