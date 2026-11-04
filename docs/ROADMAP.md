# Batiste — Roadmap

Atualizado 2026-06-18. Regra deste documento: item marcado **entregue** tem
comando de verificação ao lado — se o comando não prova, o item não entra.
Committed ≠ shipped; o próprio gate `repo-hygiene` cobra isso de nós. Item do
trilho unificado (decisão 2026-06-10, Batiste × Silv.IA) só vira **entregue**
aqui depois de shipado E provado por comando — `em progresso` enquanto não.

## Entregue e verificável

| Capacidade | Pacote | Verificação |
|---|---|---|
| Executor DAG paralelo | `@batiste-aidk/parallel` | `pnpm --filter @batiste-aidk/parallel test` |
| Substrato AST multi-linguagem (TS/JS/Py/Go/Rust via tree-sitter) | `@batiste-aidk/graph` | `pnpm --filter @batiste-aidk/graph test` |
| Hooks de sessão (SessionStart, UserPromptSubmit, PreToolUse) | `@batiste-aidk/atrium` | `pnpm --filter @batiste-aidk/atrium test` |
| Espelhamento encriptado p/ Drive (AES-256-GCM) | `atrium/commands/sync-drive` | `rg -l sync-drive packages/atrium/src` |
| Relatório de tokens por período | `atrium/commands/token-report` | `pnpm --filter @batiste-aidk/atrium test -- token-report` |
| Vault GVS: validador + index (6 eixos, frontmatter schema) | `@batiste-aidk/gvs` | `batiste-direct vault_validate '{"path":"<vault>"}'` |
| Família de gates de disciplina | `repo-hygiene`, `deploy-lineage`, `dfam-preflight`, `ui-consistency`, `credential-preflight` | `node packages/repo-hygiene/hygiene.mjs --help` + suíte de cada pacote |
| Gate de integridade de pitch/demo (teatro = falha) | `@batiste-aidk/pitch-integrity` | `pnpm --filter @batiste-aidk/pitch-integrity test` (17/17) |
| Fechamento de task por commit (`Task-done:` trailer → reconcile DAG + stale-check) | `manage_task` (`@batiste-aidk/code`) | `batiste-direct manage_task '{"action":"reconcile"}'` (commit `9fe58ce`; a própria task `batiste-task-sync` foi fechada por esse mecanismo com a SHA como evidência) |

Suíte completa do monorepo: `pnpm test` — 37/37 tasks verdes em 2026-06-10
(re-medir antes de publicar número novo; `pitch-integrity` e o reconcile do
`manage_task` entraram depois e ainda não foram recontados no total agregado).

## Em curso

O trilho abaixo segue a ordem de construção da decisão **2026-06-10 — Roadmap
unificado Batiste × Silv.IA** (a Silv.IA é o fio organizador; cada item carrega
prova-de-done por comando e um consumidor real na casa). Estado abaixo é o que o
TaskLog do Batiste reporta — nenhum item promovido a "entregue" sem prova shell.

- **[trilho #1] `batiste init` — fiação instalável.** Bootstrap que instala
  pre-commit + hooks de sessão + template de CI + `.hygiene.json` no repo-alvo
  em um comando. Lição operacional de 2026-06-10: gate sem invocação automática
  vira doutrina — achamos um repo de produção com todos os gates disponíveis e
  nenhum instalado. **Status: planejado** (nenhuma task de `batiste init`
  fechada no TaskLog; o comando ainda não existe em `packages/cli`).
- **[trilho #3] Pipeline de stamp para notas de audit.** O validador GVS expôs
  ~50 notas do eixo Audit sem `manifest`/`stamp_hash` em vault real; o pipeline
  precisa ser executável sobre o vault inteiro — hash fabricado é proibido por
  construção. **Status: pendente** (TaskLog `vault-restamp-audit-notes` =
  pending). Done = `vault_validate` → 0 erros.
- **[trilho #4] Vault Graph RAG com peso por fonte.** Projeção do vault GVS em
  grafo consultável com peso por fonte (graphology). Hoje `@batiste-aidk/graph`
  tem peso de aresta **genérico** (`EdgeData.weight?`, consumido pelos
  clusterers da fase 2) — **não** há ponderação por proveniência de fonte ainda.
  **Status: em progresso** (TaskLog `batiste-graph-rag-source-weighting` =
  pending; trabalho desta onda pode avançar o item, mas só vira "entregue" com
  a prova: query → resposta com citações de notas + caminho no grafo). O
  benchmark adversarial vs adaptive-chunking (Ekimetrics) depende deste item e
  está spec-only — sem claim de superioridade sem rodar.
- **`@batiste-aidk/graph` fases 3+4** — enforcement de escopo no nível AST.
  **Status: em progresso** (fechamento de gap DD-blocking; trilho #7).
- **Cockpit multi-página** sobre o substrato existente. **Status: planejado**
  (trilho #7; substrato Kairos/firm cockpit).

## Próximo (v1.5+)

Continuação do trilho unificado (todos **planejados**, nenhum shipado):

- **[trilho #2] `orchestrate_agents` v1 — torneio como workflow nativo**
  (gerar → julgar → verificar → gate) sobre `@batiste-aidk/parallel`. Hoje o
  padrão torneio foi provado **no harness do Claude** (redesign do Urania), não
  nativo no Batiste. Done = re-rodar o torneio do Urania via `batiste-direct`.
  Banca multimodal (juízes julgando screenshot) entra como upgrade quando o
  torneio for nativo.
- **[trilho #5] Mermaid re-render 1:1 na Silv.IA** (paridade de interação) —
  hoje 0% de paridade. Done = click-test matrix do Mermaid passando na versão
  Silv.IA.
- **[trilho #6] Personas RLS-aware + coaching** (`rls`/`memory`/`atrium`) — o
  "JARVIS" do plano v1 da Fran. Done = persona só enxerga o que o RLS permite,
  demonstrável.
- **[trilho #6b] Conector Microsoft Graph + SSO EntraID** (Teams/Outlook/
  Calendar → vault/Firm Memory via gateway DPA). Done = thread real do Teams
  ingerida e consultável com audit.

- **CAG governado (fusão RAG+CAG).** Firm Memory já é o "R": recupera chunk,
  nunca o corpus (ADR-0002). O "C" — cachear corpus frio direto no KV/prompt
  cache do modelo (`cache_control: ephemeral` na API Anthropic) — é a peça que
  falta. O ganho do CAG é latência/custo em dado que muda raramente; o risco,
  segundo a própria literatura, são dois: *(a)* o cache fica visível a toda
  query e *(b)* RBAC sobre cache é difícil sem um cache por papel. Ambos já têm
  resposta nativa aqui: o campo `sensitivity` dos schemas `PromptEntry`/`FactEntry`
  vira o discriminador quente/frio e cacheável/não-cacheável; `scope`/`rls`
  particionam a chave de cache por papel (resolve *b*); `audit` registra o que
  entrou no cache (resolve *a*). IP sensível permanece retrieval-only — só a
  fatia fria, baixa-sensibilidade e escopada vai pro cache. Hipótese de
  posicionamento, não shipped: o diferencial é tornar CAG seguro pra enterprise
  com RBAC, não o cache em si.
- Federation entre deployments (opt-in, audit-logged) — protocolo ADR-0005.
- Reranker cross-encoder no retrieval top-K (crítico quando corpus > 10k entradas).
- Paridade Windows/Linux no cold-setup (Keychain → Credential Manager / libsecret).
- Absorção do legado `seu-claude` — ADR-0003.

## Política de claims deste roadmap

Não publicamos números de economia de tokens. O benchmark interno que sugeria
ganho expressivo não sobreviveu à verificação adversarial contra baseline
competente; até existir medição robusta em escala, o `token-report` reporta o
seu dado no seu deployment — sem claim universal. Toda capacidade listada acima
segue o mesmo padrão: prova por comando, ou não está na lista.
