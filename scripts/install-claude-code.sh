#!/usr/bin/env bash
# install-claude-code.sh — registra o Batiste como MCP server no Claude Code (CLI).
#
# Depois de rodar este script, as ferramentas do Batiste (manage_task,
# index_codebase, find_symbol, run_tdd, etc.) aparecem em TODAS as suas sessões
# do Claude Code, em qualquer pasta de projeto.
#
# Por que NÃO é um "plugin" de marketplace: o servidor do Batiste usa módulos
# nativos (better-sqlite3, tree-sitter) que vivem no node_modules deste repo.
# O cache de plugin do Claude Code copia só o manifesto, não o node_modules —
# então o servidor não funcionaria de lá. Registrar por caminho absoluto (user
# scope) é o jeito que funciona de verdade. Foi testado ponta-a-ponta.
#
# Uso:
#   bash scripts/install-claude-code.sh            # instala
#   bash scripts/install-claude-code.sh --remove   # remove
#
# Pré-requisitos (só um que não dá pra remover): Node 20+ instalado.
# O resto (pnpm) o script provisiona sozinho via corepack.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_JS="$REPO_ROOT/packages/code/dist/mcp/server.js"
SERVER_NAME="batiste"

say()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

# --- modo remover ---------------------------------------------------------
if [[ "${1:-}" == "--remove" || "${1:-}" == "-r" ]]; then
  if command -v claude >/dev/null 2>&1; then
    claude mcp remove "$SERVER_NAME" -s user >/dev/null 2>&1 || true
    ok "Batiste removido do Claude Code."
  else
    die "O comando 'claude' não foi encontrado."
  fi
  exit 0
fi

# --- 1. checa Node (único pré-req irredutível) ----------------------------
command -v node >/dev/null 2>&1 || die \
  "Node não encontrado. Instale o Node 20+ em https://nodejs.org e rode de novo."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  die "Sua versão do Node é antiga (v$(node -v)). Instale Node 20+ em https://nodejs.org."
fi
ok "Node $(node -v) encontrado."

# --- 2. checa o Claude Code -----------------------------------------------
command -v claude >/dev/null 2>&1 || die \
  "O Claude Code não foi encontrado. Instale com: npm install -g @anthropic-ai/claude-code"
ok "Claude Code $(claude --version 2>/dev/null | head -1) encontrado."

# --- 3. instala dependências (pnpm via corepack, sem instalar pnpm global) -
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
if command -v pnpm >/dev/null 2>&1; then
  PNPM=(pnpm)
elif command -v corepack >/dev/null 2>&1; then
  say "Provisionando o pnpm via corepack (não mexe no seu sistema)…"
  corepack enable >/dev/null 2>&1 || true
  PNPM=(corepack pnpm)
else
  die "Nem pnpm nem corepack disponíveis. Atualize o Node para 20+ (vem com corepack)."
fi

say "Instalando dependências do Batiste (pode demorar na primeira vez)…"
( cd "$REPO_ROOT" && "${PNPM[@]}" install --frozen-lockfile ) \
  || ( cd "$REPO_ROOT" && "${PNPM[@]}" install ) \
  || die "Falha ao instalar dependências."
ok "Dependências instaladas."

# --- 4. build se o servidor ainda não existe ------------------------------
if [[ ! -f "$SERVER_JS" ]]; then
  say "Compilando o Batiste…"
  ( cd "$REPO_ROOT" && "${PNPM[@]}" build ) || die "Falha ao compilar o Batiste."
fi
[[ -f "$SERVER_JS" ]] || die "Servidor não encontrado após o build: $SERVER_JS"
ok "Servidor do Batiste pronto."

# --- 5. teste rápido: o servidor sobe e responde? -------------------------
say "Testando o servidor…"
if node -e '
  const { spawn } = require("child_process");
  const p = spawn("node", [process.argv[1]], { env: { ...process.env, PROJECT_ROOT: process.cwd() }, stdio: ["pipe","pipe","ignore"] });
  let buf = ""; let done = false;
  p.stdout.on("data", d => { buf += d; if (buf.includes("\"result\"")) { done = true; p.kill(); process.exit(0); } });
  p.stdin.write(JSON.stringify({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2024-11-05",capabilities:{},clientInfo:{name:"t",version:"1"}}})+"\n");
  setTimeout(() => { p.kill(); process.exit(done?0:1); }, 8000);
' "$SERVER_JS" >/dev/null 2>&1; then
  ok "Servidor respondeu ao handshake MCP."
else
  die "O servidor não respondeu. Rode 'cd $REPO_ROOT && ${PNPM[*]} install' manualmente e tente de novo."
fi

# --- 6. registra no Claude Code (idempotente, user scope) -----------------
say "Registrando o Batiste no Claude Code…"
claude mcp remove "$SERVER_NAME" -s user >/dev/null 2>&1 || true
claude mcp add "$SERVER_NAME" --scope user -- node "$SERVER_JS" >/dev/null \
  || die "Falha ao registrar no Claude Code."

ok "Pronto! O Batiste está ligado no Claude Code (todas as suas pastas)."
echo
echo "  Abra qualquer projeto e rode:  claude"
echo "  Confira a conexão com:         claude mcp list"
echo "  As ferramentas começam com:    mcp__batiste__  (ex.: mcp__batiste__manage_task)"
echo
echo "  Para remover depois:           bash scripts/install-claude-code.sh --remove"
