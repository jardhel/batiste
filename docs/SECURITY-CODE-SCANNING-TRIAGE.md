# Triagem do Code Scanning (2026-11-07)

Base: 804 alertas abertos no commit 0b4ec37 (CodeQL 159, ESLint 641, Scorecard 4).
Regra desta triagem: consertar pela causa; dismiss só com razão técnica verificável. Alertas só fecham depois
de um novo upload do CodeQL/ESLint no CI; a coluna "previsto" é o que o conserto deve fechar.

## CodeQL: produção

| Regra | Local | Ação |
|---|---|---|
| js/shell-command-constructed-from-input (5) | `packages/code/src/indexer/git-tracker.ts` | `execSync` com string trocado por `execFileSync('git', [...])`; `sort -u \| grep` feito em JS; refs que começam com `-` ou têm NUL são recusadas. Teste: `git-tracker.test.ts` (nome de arquivo e ref com `"; touch`, `$(...)`, `--output=`). |
| js/insecure-temporary-file (5, produção) | `atrium/src/commands/sync-drive.ts`, `code/src/validation/TypeScriptValidator.ts`, `code/src/indexer/{file-index,git-aware-indexer}.ts`, `code/src/tdd/HypothesisEngine.ts` | sync-drive: `mkdtemp` (0o700) + `wx` + 0o600. TypeScriptValidator: nome aleatório + `wx` + 0o600. Índices: modo 0o600. HypothesisEngine: modo explícito 0o644 (grava o arquivo de teste/implementação do projeto, não cria temporário; o fluxo apontado vinha dos testes). Se o CodeQL ainda apontar o HypothesisEngine após o próximo scan, é falso positivo a dismissar com essa justificativa. |
| js/file-system-race (2 de packages) | `code/src/indexer/crawler.ts`, `atrium/src/commands/ingest-cc-memory.ts` | crawler: `open` + `fstat`/`read` no mesmo fd. ingest-cc-memory: `open(path,'r+')` e trata ENOENT, sem `existsSync` antes. (O terceiro, `scripts/generate-notice.mjs`, é de `scripts/`, fora desta triagem.) |
| js/polynomial-redos (3) | `auth/src/middleware.ts`, `pitch-integrity/pitch-integrity.mjs` (2) | `extractBearerToken` reescrito linear com limite de 8192; pitch-integrity: ternário por `indexOf` e regex de comentário limitada a 400 caracteres. Testes de entrada patológica nos dois pacotes. |
| js/incomplete-sanitization (2) | `auth/src/scope.ts`, `ui-consistency/font-source.mjs` | `matchGlob` escapa todo metacaractere (antes só `.`; `(`, `+`, `[` quebravam ou mudavam o padrão) e colapsa corridas de `*`. font-source: escape completo. Testes em `scope.test.ts`. |
| js/incomplete-multi-character-sanitization (4) | `deploy-integrity/deploy-integrity.mjs` | `normalizarHtml` repete a remoção até estabilizar (máx. 20 passadas). Teste com tag entrelaçada. |
| js/incomplete-hostname-regexp, js/regex/missing-regexp-anchor (2+4) | `ui-consistency/font-source.mjs`, `deploy-integrity/deploy-integrity.mjs` | host escapado e com borda (`(?<![\w.-])...(?![\w-])`); alternâncias com `^` agrupadas ou trocadas por `startsWith`/`includes`. Teste de host vizinho. |
| js/indirect-command-line-injection (4) | `repo-hygiene/hygiene.mjs`, `deploy-lineage/deploy-lineage.mjs` | `execSync` com string trocado por `execFileSync` com argv; `sourceDir`/`project` nunca passam por shell. |
| js/stack-trace-exposure (1) | `marketplace/src/gateway.ts` | 500 não devolve mais `err.message`; só erro de validação (Zod) devolve detalhe. Teste: JSON malformado dá `{"error":"Internal server error"}`. |
| js/indirect-command-line-injection + shell-command-injection-from-environment (2) | `core/src/sandbox/ProcessSandbox.ts:53` | NÃO dismissado e NÃO "consertável": `execute_sandbox` existe para executar o comando que o chamador pede (spawn sem shell, argv em array). Mitigações adicionadas em `code/src/mcp/handler.ts`: `workingDir` não pode sair da raiz do projeto e NUL é recusado (teste novo). O controle real é o escopo de ferramenta da autenticação (`auth`). Fica aberto como risco aceito documentado. |

## CodeQL: dismissados

| Regra | Pasta | Qtd | Razão |
|---|---|---|---|
| js/file-access-to-http (#1221-#1223) | `packages/cli/src/utils/http.ts` | 3 | falso positivo: o "arquivo" é o `~/.batiste/config.json` do próprio usuário (URLs e `creatorId`); o CLI fala com o endpoint que o usuário configurou. |

## CodeQL: testes/fixtures (122 alertas js/insecure-temporary-file)

Em vez de dismissar, os testes foram corrigidos: diretório com `mkdtemp` (0o700) no lugar de `join(tmpdir(), 'x-' + Date.now())` ou `/tmp/nome-fixo`, em 15 arquivos de teste de `core`, `code` e `cli`. Previsto fechar todos no próximo scan. Nenhum dismiss por "used in tests".

## ESLint (641 alertas)

- Causa de ruído real tratada: APIs deprecadas do zod 4 (`z.string().uuid()` para `z.uuid()`, `.datetime()` para `z.iso.datetime()`, `.url()` para `z.url()`, `.passthrough()` para `.loose()`, `ZodTypeAny` para `ZodType`, `ZodIssue` para `z.core.$ZodIssue`) em audit, auth, core/agents, gvs, marketplace, scope, transport e code/mcp. `no-deprecated`: 56 para 10. Os 10 restantes são `Server` do SDK MCP (low-level, uso intencional em core/transport) e `Limited` interno do atrium.
- O resto (~650: `restrict-template-expressions`, `no-non-null-assertion`, `dot-notation`, `require-await` etc.) é estilo/qualidade, não segurança. Decisão: o `strictTypeChecked` completo continua rodando no CI como relatório (`reports/eslint-quality.sarif` no artefato `ci-reports`), mas NÃO sobe ao Code Scanning. Sobe só `eslint.security.config.js` (`no-eval`, `no-implied-eval`, `no-new-func`, `no-script-url`, `no-new-wrappers`, `no-proto`, `no-extend-native`), com a etapa falhando o build se achar algo (hoje: 0 achados). O upload sem resultados fecha os alertas antigos da category `eslint`.

## Scorecard (4) — fora do escopo de código

`BranchProtectionID`, `CodeReviewID`, `FuzzingID`, `CIIBestPracticesID` dependem de configuração do repositório/processo (mantenedor único); permanecem abertos.
