# @batiste-aidk/tasklog-hygiene

O gate do TaskLog: **o backlog não cresce em silêncio.** Nasceu em 2026-11-04 com o board em 239 tarefas
(134 pendentes, 15 running, 76 pendentes com mais de 60 dias, 31 `proposta-*` paradas) e 6 tarefas cujo
texto dizia "FALTA deploy" já publicadas e nunca fechadas. Nenhum gate olhava o TaskLog; a regra
"fecha o que fez" era doutrina escrita, o modo de falha que só gate impede.

```bash
node packages/tasklog-hygiene/tasklog-hygiene.mjs [check] [--repo <raiz>] [--stale-days 30] [--running-hours 48] [--no-prod] [--json] [--warn-only] [--list 10]
node packages/tasklog-hygiene/tasklog-hygiene.mjs report [--repo <raiz>] [--months 6] [--json]
```

Lê o TaskLog por `batiste-direct manage_task list` (override: `BATISTE_DIRECT`, ou `--tasks-file`). Exit **0** passa,
**1** bloqueia, **3** TaskLog ilegível (o gate NÃO rodou: nunca finge que passou).

| regra | reprova quando | sugestão impressa |
|---|---|---|
| `stale` | pendente/running sem update há mais de N dias (30), sem `renewedUntil` vigente **com motivo** | `archive` com reason, ou `renew`, ou `close` com proof |
| `running-orfa` | running sem update há mais de 48 h (sem batimento: agente/sessão morreu) | `archive` ou `update` |
| `falta-publicado` | label/`state` diz `FALTA deploy/commit`, o produto (nome no label, tag `deploy:<produto>`) está **no ar == HEAD** pelo `prova-no-ar` e a árvore do produto está limpa | o comando `close` exato, copiável, com a prova |
| `completed-sem-prova` | aviso; `--strict-proof --proof-since AAAA-MM-DD` reprova as concluídas depois da data sem `closed`/`reconciledFromCommit`/`links` | `close` com proof |

`report` é o burn-down: criadas × concluídas × arquivadas por mês, saldo, idade p50/p90/max e faixas das
abertas, top prefixos, % de concluídas com prova. `--json` para registrar em release.

## Como o board para de apodrecer

1. **Estado fora do label.** `manage_task create/update` aceita `state {next, gate}`, `links {commit, deploy, release, url}`,
   `phase`, `tags`, `note` (append-only). Label é título (até 120 chars; acima disso o `create` recusa).
2. **Fechar com prova.** `close` exige `proof`; `archive` exige `reason`; `renew` exige `until` e `reason`.
   `update` para `completed` sem `proof`/`reason` é recusado. `completed` e arquivada são terminais (reabrir exige `reopen` + `reason`).
3. **Triagem em lote.** `manage_task '{"action":"triage"}'` lista candidatas (obsoletas pelo texto, duplicatas, grupos
   de prefixo parados, running órfãs, filhas de pai concluído). Dry-run por padrão; `apply:true` + `confirm:"TRIAGE"` arquiva.
4. **Commit fecha tarefa.** `Task-done: <id|8 chars|label>` no corpo do commit; o gancho `post-commit` da casa roda `reconcile`.
   Trailer ambíguo (label duplicado) não fecha ninguém: vem em `ambiguous`.
5. **Fim de sessão.** O `repo-hygiene` roda este gate como CHECK 7 (`.hygiene.json` → `tasklog`). Exit 1 = a sessão não terminou.

Testes: `node --test packages/tasklog-hygiene/tasklog-hygiene.test.mjs`.

## Regra `correlatas-abertas`

Tarefas abertas parecidas (não só de mesmo nome) são medidas pelo motor de `packages/code/src/mcp/task-similarity.ts` (o mesmo do `manage_task create` e `triage`). Par com score >= 0.80 é a mesma tarefa: reprova (exit 1) e imprime o `manage_task merge` exato (alvo = maior fase, depois o mais antigo). Par com 0.50 a 0.79 é correlata: aparece como aviso no relatório e em `avisos` no `--json`, sem reprovar. Label idêntico fica com `duplicata-aberta`. O gate importa o `.ts` direto (Node >= 22.18); se não carregar, avisa que a regra não rodou.

