#!/usr/bin/env bash
# install-cowork.sh — registra o Batiste como MCP server no Claude Desktop / Cowork.
#
# Dogfooding: quando o Batiste é o "backend" das sessões do Cowork, cada AST
# analysis, TDD run, AutoFix e codebase summarise passa pelo caminho zero-trust
# (Scope → Auth → Audit) do próprio Batiste. A melhor prova social que existe.
#
# Idempotente: pode rodar N vezes. Usa jq para fazer merge seguro.
#
# Uso:
#   bash scripts/install-cowork.sh              # instala
#   BATISTE_REMOVE=1 bash scripts/install-cowork.sh   # remove a entrada
#
# Requer: macOS, jq, node 20+, Batiste já buildado (pnpm build).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_JS="$REPO_ROOT/packages/code/dist/mcp/server.js"
DATA_DIR="$REPO_ROOT/.batiste"
CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Este instalador assume macOS (Claude Desktop). Ajuste CONFIG para o seu SO." >&2
  exit 1
fi

command -v jq >/dev/null 2>&1 || { echo "jq não encontrado. Instale com: brew install jq" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "node não encontrado. Instale Node 20+." >&2; exit 1; }

if [[ ! -f "$SERVER_JS" ]]; then
  echo "dist ausente: $SERVER_JS" >&2
  echo "Rode: pnpm install && pnpm build" >&2
  exit 1
fi

mkdir -p "$(dirname "$CONFIG")"
[[ -f "$CONFIG" ]] || echo '{"mcpServers":{}}' > "$CONFIG"

# Backup antes de qualquer mutação
cp "$CONFIG" "$CONFIG.bak.$(date +%Y%m%d-%H%M%S)"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

if [[ "${BATISTE_REMOVE:-0}" == "1" ]]; then
  jq 'del(.mcpServers.batiste)' "$CONFIG" > "$TMP"
  mv "$TMP" "$CONFIG"
  echo "Batiste removido do Cowork. Reinicie o Claude Desktop."
  exit 0
fi

jq \
  --arg cmd "node" \
  --arg arg "$SERVER_JS" \
  --arg root "$REPO_ROOT" \
  --arg data "$DATA_DIR" \
  '
  .mcpServers //= {} |
  .mcpServers.batiste = {
    "command": $cmd,
    "args": [$arg],
    "env": {
      "PROJECT_ROOT": $root,
      "DATA_DIR": $data,
      "NODE_ENV": "production"
    }
  }
  ' "$CONFIG" > "$TMP"
mv "$TMP" "$CONFIG"

echo "Batiste registrado no Cowork."
echo "  config: $CONFIG"
echo "  server: $SERVER_JS"
echo
echo "Próximo passo: reinicie o Claude Desktop (Cmd+Q e abra de novo)."
echo "Depois, numa nova sessão do Cowork, peça: 'liste as ferramentas do batiste'."
