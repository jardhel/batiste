# Batiste × Cowork — Dogfooding

> Cowork é o modo desktop do Claude para workflows de automação em cima de arquivos. O Batiste roda **dentro** do Cowork como MCP server — isso é dogfooding público: toda chamada agentica (AST analysis, TDD, AutoFix, codebase summarise, context budgeting) passa pelo **mesmo caminho zero-trust** que nós vendemos para o cliente.

## Por que a integração importa

A integração Cowork × Batiste fecha o loop entre produto e uso real:

- **Scope-first** — cada ferramenta é path-scoped antes do handler rodar. Quando o Cowork pede análise de um arquivo, o deny-list do Batiste é avaliado primeiro; se o arquivo é bloqueado, o handler nunca recebe o request.
- **Auth obrigatório** — JWTs verificados em toda chamada. Tokens expirados ou adulterados são rejeitados antes da execução, mesmo no dogfood.
- **Audit append-only** — cada tool call, resultado e timing é escrito no ledger SQLite WAL. O próprio desenvolvimento do Batiste vira prova de auditoria.
- **Kill switch < 1ms** — se algo saiu errado numa sessão do Cowork, `batiste audit kill --all` revoga tudo antes da próxima chamada sair.

Resultado: a infra que protege agentes do cliente é a mesma que protege os agentes que escrevem o próprio Batiste.

## Instalar em 1 comando

```bash
bash scripts/install-cowork.sh
```

O script registra `batiste` como MCP server em `~/Library/Application Support/Claude/claude_desktop_config.json`, faz backup da config anterior e é idempotente (pode rodar N vezes). Para remover: `BATISTE_REMOVE=1 bash scripts/install-cowork.sh`.

Depois, reinicie o Claude Desktop e abra uma sessão em Cowork mode. Peça "liste as ferramentas do batiste" e você verá as 11 MCP tools expostas pelo `@batiste-aidk/code`.

## Instalar manualmente

Se preferir editar à mão, cole o conteúdo de [`.batiste/cowork-config.example.json`](../.batiste/cowork-config.example.json) dentro de `mcpServers` no `claude_desktop_config.json`.

## Prova social — o que falar em público

Três mensagens prontas para tweet / deck / landing:

1. "Batiste roda o próprio Batiste. O MCP server do `@batiste-aidk/code` é carregado como conector do Cowork mode — cada tool call no nosso repo passa por Scope → Auth → Audit."
2. "Kill switch testado em produção todo dia: se alguma ferramenta do Batiste se comporta mal dentro do Cowork, a gente derruba tudo em < 1ms antes da próxima chamada sair."
3. "Audit ledger append-only da sessão de desenvolvimento do próprio Batiste é público — cada AST analysis, TDD run e AutoFix fica registrado. Dogfooding com paper trail."

## Verificar que está ativo

Numa sessão do Cowork:

```
voce: liste as ferramentas do batiste
claude: [retorna 11 tools: find_symbol, analyze_dependency, run_tdd, auto_fix, ...]
```

Para confirmar do lado do ledger:

```bash
batiste audit tail --follow
```

Cada pergunta que você faz no Cowork deve aparecer como entrada append-only no ledger.
