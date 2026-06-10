# Batiste — Roadmap

Atualizado 2026-06-10. Regra deste documento: item marcado **entregue** tem
comando de verificação ao lado — se o comando não prova, o item não entra.
Committed ≠ shipped; o próprio gate `repo-hygiene` cobra isso de nós.

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

Suíte completa do monorepo: `pnpm test` — 37/37 tasks verdes em 2026-06-10.

## Em curso

- **Fiação de enforcement como produto.** Lição operacional de 2026-06-10: gate
  sem invocação automática vira doutrina — encontramos um repo de produção com
  todos os gates disponíveis e nenhum instalado. Próximo passo: bootstrap
  (`batiste init`) que instala pre-commit, hooks de sessão e template de CI no
  repo-alvo em um comando.
- **Vault Graph RAG.** Projeção do vault GVS em grafo consultável com peso por
  fonte (stub atual → graphology). O caso de uso real existe: um vault de
  produção com 500+ notas versionadas em git pedindo recuperação estrutural.
- **Pipeline de stamp para notas de audit.** O validador GVS expôs notas do eixo
  Audit sem `manifest`/`stamp_hash` em vault real. O pipeline de stamp precisa
  ser executável sobre vault inteiro — hash fabricado é proibido por construção.
- **`@batiste-aidk/graph` fases 3+4** — enforcement de escopo no nível AST.
- **Cockpit multi-página** sobre o substrato existente.

## Próximo (v1.5+)

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
