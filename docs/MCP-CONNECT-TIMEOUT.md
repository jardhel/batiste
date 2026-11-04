# MCP batiste: CONNECT_TIMEOUT (diagnóstico de 2026-11-04)

## O que está provado

- Logs do cliente (`~/Library/Caches/claude-cli-nodejs/-Users-jardhel-Documents-git-cachola-tech/mcp-logs-batiste`):
  11 conexões entre 07/10 e 26/10; **5 terminaram em `CONNECT_TIMEOUT` (30 s)** e 6 conectaram em ~150-270 ms.
- Nas 5 falhas **não existe** a linha `Server stderr: @batiste-aidk/code MCP Server started (stdio)`; nas 6 que
  funcionaram ela aparece 120-240 ms depois de `Starting connection`. Ou seja: nas falhas o servidor não chegou
  a escutar em 30 s.
- O servidor, em si, é rápido e determinístico: uma sonda stdio (spawn do `dist/mcp/server.js` + `initialize` JSON-RPC; hoje é o `MCP ping` do
  `batiste-direct doctor`) respondeu em 139-157 ms, três vezes seguidas, também com `env -i` e caminho absoluto do node.
- `~/.claude.json` configura `{"command":"node","args":[".../packages/code/dist/mcp/server.js"],"env":{}}`: depende do
  PATH do cliente achar `node` (está em `/opt/homebrew/bin`). Com PATH mínimo o spawn falha na hora
  (`env: node: No such file or directory`), o que se esperaria como erro de spawn, não como timeout (não verificado no cliente).

## Causa raiz (PROVADA em 2026-11-04): arquivos do servidor evictados pelo iCloud

`~/Documents` é sincronizado pelo iCloud. Com "Otimizar armazenamento" o macOS evicta arquivos pouco usados
(flag `SF_DATALESS`) e o **primeiro read de cada um bloqueia até o download**. O node carrega os arquivos do servidor
um a um, em série.

Evidência (todas medições desta máquina):

- `find . -flags +dataless` no repo: 20 237 arquivos evictados, 17 048 só em `node_modules/.pnpm` e `packages`
  (inclui `@modelcontextprotocol/sdk`, `zod`, `.node` do tree-sitter).
- Rastreio do carregamento (hook de `load` do ESM): o servidor lê 223 arquivos ESM + addons nativos (398 no manifest).
- Reprodução: `brctl evict` nos 230 arquivos carregados e o handshake `initialize` exato do cliente
  (`node dist/mcp/server.js`, cwd = cachola_tech, stdin): **358 143 ms** frio contra **128 ms** quente.
  O processo ficou parado em estado `S` baixando ~0,6 arquivo/s (220 evictados -> 0 em 5 min 58 s). Limite do cliente: 30 000 ms.
- Casa com os logs do cliente: as falhas não têm `MCP Server started` (o servidor nem chegou a escutar) e a de 26/10
  ocorreu 3 min depois do boot da máquina (`sysctl kern.boottime` = 13:47:41; falha 13:50:42 local); os sucessos
  de 12-16/10 vieram com os arquivos quentes. Os `server/discover` e `Method not found` NÃO são a causa (o servidor
  responde `-32601` imediatamente: testado).
- Descartados com medição: `node` fora do PATH (spawn falharia na hora), SQLite/WAL (boot de 40 ms e não abre DB no
  boot), dist defasado (`doctor` verde), zumbis (`pgrep` só mostrou processos desta sessão).

Limite do que se sabe: não há log do servidor das 5 falhas históricas (o `boot-log` é de hoje), então a ligação
falhas-passadas = eviction é inferência forte (mesmo sintoma, mesmo mecanismo reproduzido), não observação direta.

## Conserto

`dist/mcp/launch.js` (src: `launch.ts`, `materialize.ts`) substitui `server.js` no comando do cliente. Antes de importar o
servidor ele lê o manifest `~/.batiste/mcp-closure.json` (fora do iCloud; gravado sozinho no primeiro boot, ou com
`BATISTE_RECORD=1`), acha quais arquivos estão evictados (`find -flags +dataless`, só metadata) e os baixa com 32
leitores paralelos. Medição: 230 arquivos frios em **9,4 s** em paralelo (contra ~6 min em série); handshake frio completo
pelo launcher com 268 arquivos evictados: **26 167 ms** (warm 24 926 ms). Isto passa do limite de 30 s por pouco:
o iCloud limita o download a ~11 arquivos/s qualquer que seja o paralelismo, então o launcher é mitigação, não cura.

Cura recomendada (NÃO aplicada, mexe na árvore de trabalho e em mídia sincronizada): tirar o runtime do iCloud
(por ex. checkout/build do batiste fora de `~/Documents`, ou `node_modules.nosync` + symlink feito com a árvore já
materializada: renomear arquivos ainda dataless pode perdê-los). `batiste-direct doctor` mostra `iCloud: N/M arquivos
do servidor EVICTADOS` e vira FALHA/aviso enquanto houver.

Testes: `node --test packages/code/test/materialize.node.test.mjs` (lógica sempre; `BATISTE_ICLOUD_TEST=1` evicta
12 arquivos de `docs/` de verdade e prova que `materialize` zera os dataless).

Config sugerida para `~/.claude.json` (`mcpServers.batiste`; não aplicada):

```
"command": "/opt/homebrew/bin/node",
"args": ["/Users/jardhel/Documents/git/batiste/packages/code/dist/mcp/launch.js"]
```

## Observabilidade (já existente)

1. `packages/code/src/mcp/boot-log.ts` é o PRIMEIRO import do `server.ts` e grava em `$DATA_DIR/mcp-boot.log` uma
   linha JSON `boot` (pid, node, cwd, ms) antes de tree-sitter/better-sqlite3 carregarem, e `listening` quando o
   transporte está de pé. Leitura numa próxima falha:
   - só `boot`: travou carregando dependências (disco/iCloud);
   - `boot` + `listening`: servidor ok, o atraso foi do cliente;
   - nenhuma linha: o node nem executou o servidor (spawn/PATH).
2. A guarda de entrypoint `import.meta.url === file://${argv[1]}` (saía com 0 e sem servir se o caminho tivesse
   symlink, espaço ou caractere escapado) virou comparação por `realpath`.
3. `batiste-direct doctor` mede o handshake (`MCP ping`), compara o build com o `src` (dist defasado) e lê o
   `tasks.db`. É também o fallback: com o MCP fora, `batiste-direct manage_task ...` continua sendo o caminho.

## Recomendação de configuração (não aplicada: é config do usuário)

Ver "Config sugerida" acima (caminho absoluto do node tira também a dependência do PATH do cliente).
