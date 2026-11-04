# secret-scan

Gate de pre-commit contra credencial/token em arquivo versionado. Nasceu do incidente de 2026-10-17 (senhas de sala hardcoded como `fallback:`, secret com fallback que virou o secret efetivo em produção, tokens `?t=` inteiros em releases). Começou em `tools/` do repo da casa e foi promovido a pacote do Batiste em 2026-10-18: a disciplina é o produto.

```bash
node packages/secret-scan/secret-scan.mjs                      # arquivos staged (o que o pre-commit roda)
node packages/secret-scan/secret-scan.mjs --all                # todos os git ls-files (auditoria)
node packages/secret-scan/secret-scan.mjs <arquivo…>           # arquivos explícitos
node packages/secret-scan/secret-scan.mjs --allowlist <json>   # allowlist do repo
npm test                                                       # 8 testes (node:test), repos git temporários
```

Rode dentro do repo alvo. Sai `0` (limpo) ou `1` (**bloqueia**). A API `scan({root, modo, files, allowlist})` é exportada.

## Padrões que bloqueiam

| # | Classe |
|---|---|
| 1 | `fallback:`/`secretFallback:` com literal em `functions/` ou `tools/` |
| 2 | `env.<NOME-credencial> \|\| "literal"` (só quando o nome cheira a credencial) |
| 3 | atribuição de string literal a variável cujo nome é PASS, PASSWORD, SENHA, SECRET, TOKEN ou API_KEY |
| 4 | `senha: <valor>` em `*.md`/`*.txt` |
| 5 | token JWT/Thalia inteiro (`eyJ….<assinatura>`, `?t=eyJ…`) |
| 6 | prefixos de provedor (`sk_live_`, `whsec_`, `sk-ant-`, `AKIA`, `AIza`, `gh*_`, `xox*-`) |
| 7 | `Bearer <token>` literal e `user:pass@` em URL |
| 8 | chave PEM e `.env`/`.dev.vars`/`.pem`/`id_rsa` staged (só `*.example` passa) |
| 9 | entropia alta (hex de 40+ ou base64 de 48+ entre aspas) |

## Allowlist

Ordem de busca: `--allowlist`, `$SECRET_SCAN_ALLOWLIST`, `<raiz>/.secret-scan.allowlist.json`, a genérica deste pacote. Quatro mecanismos: `paths`, `pathPatterns`, `values`, `pins` (path + sha256 da linha exata), mais `lineAllow`. Nunca "passa dessa vez". A allowlist específica de cada repo vive no repo (no caso da casa, `tools/secret-scan/allowlist.json`).

## Licença (proposta)

`UNLICENSED` + `private: true`, o mesmo dos gates irmãos (`repo-hygiene`, `credential-preflight`, `pitch-integrity`, `ui-consistency`: proprietário, código-fonte visível). MIT ficou para os pacotes de runtime (`core`, `auth`, `audit`...). Isto é uma proposta: a licença final é do founder, e o `LICENSE` da raiz não foi alterado.
