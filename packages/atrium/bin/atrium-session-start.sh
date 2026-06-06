#!/usr/bin/env bash
# atrium-session-start.sh — Claude Code SessionStart hook
#
# Fires when Claude Code boots a new session. Reads the JSON event from
# stdin (fields: cwd, sessionId, transcript), checks the operator's CWD
# allowlist in ~/.batiste/firm-memory/atrium-hooks.json, and — if matched —
# kicks off a background `batiste-fm ingest cc-sessions` for that CWD slug
# so prior turns are auto-ingested into Firm Memory before the operator
# starts a long task. Never blocks session boot: backgrounded with disown,
# exits 0 even when batiste-fm is missing or the FM root isn't writable.
#
# Per the v1.4 "invisible Atrium" promise: the operator never types
# `batiste-fm ingest` — this hook does it for them.
#
# Stdout: one informational line ("# Atrium: ingesting prior sessions ...")
# Stderr: never used; failures are silent and logged to ~/.batiste/firm-memory/.audit/hooks.log.

set -u

FM_ROOT="${BATISTE_FM_ROOT:-$HOME/.batiste/firm-memory}"
HOOKS_CONFIG="$FM_ROOT/atrium-hooks.json"
LOG_DIR="$FM_ROOT/.audit"
LOG_FILE="$LOG_DIR/hooks.log"

# Always exit 0 — never break a Claude Code session because of us.
trap 'exit 0' EXIT

# Read JSON event from stdin (best-effort; tolerate empty or non-JSON).
event_json=""
if [ ! -t 0 ]; then
  event_json="$(cat 2>/dev/null || true)"
fi

# Extract cwd. Try `jq` first, fall back to a portable grep so the hook
# works on a stock macOS install where jq isn't on PATH by default.
extract_field() {
  local field="$1"
  local json="$2"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$json" | jq -r --arg f "$field" '.[$f] // empty' 2>/dev/null
  else
    printf '%s' "$json" \
      | tr -d '\n' \
      | grep -oE "\"$field\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" \
      | head -n1 \
      | sed -E "s/.*\"$field\"[[:space:]]*:[[:space:]]*\"([^\"]*)\".*/\1/"
  fi
}

cwd="$(extract_field cwd "$event_json")"
[ -z "$cwd" ] && cwd="$PWD"

# Read allowlist from atrium-hooks.json. Missing config = silent no-op
# (operator hasn't run `batiste-fm install hooks` yet, or chose to disable).
if [ ! -f "$HOOKS_CONFIG" ]; then
  exit 0
fi

allowlist_match=0
if command -v jq >/dev/null 2>&1; then
  while IFS= read -r needle; do
    [ -z "$needle" ] && continue
    case "$cwd" in
      *"$needle"*) allowlist_match=1; break;;
    esac
  done < <(jq -r '.cwd_allowlist[]? // empty' "$HOOKS_CONFIG" 2>/dev/null)
else
  # Portable fallback: pull the cwd_allowlist array as a flat string.
  raw="$(tr -d '\n' < "$HOOKS_CONFIG" \
    | grep -oE '"cwd_allowlist"[[:space:]]*:[[:space:]]*\[[^]]*\]' \
    | sed -E 's/.*\[(.*)\].*/\1/' \
    | tr ',' '\n' \
    | sed -E 's/^[[:space:]]*"//;s/"[[:space:]]*$//')"
  while IFS= read -r needle; do
    [ -z "$needle" ] && continue
    case "$cwd" in
      *"$needle"*) allowlist_match=1; break;;
    esac
  done <<EOF
$raw
EOF
fi

[ "$allowlist_match" -eq 1 ] || exit 0

# Slugify the cwd the same way Claude Code names ~/.claude/projects dirs:
# replace `/` with `-`, drop a leading `-`. We pass it as --cwd-filter so
# only sessions for THIS repo get re-ingested.
slug="$(printf '%s' "$cwd" | sed -E 's|/|-|g; s|^-||')"

mkdir -p "$LOG_DIR" 2>/dev/null || true

# Locate batiste-fm. PATH first, then a couple of common workspace bin
# locations so the hook still works during local dev.
batiste_fm=""
if command -v batiste-fm >/dev/null 2>&1; then
  batiste_fm="batiste-fm"
elif [ -x "$HOME/.batiste/bin/batiste-fm" ]; then
  batiste_fm="$HOME/.batiste/bin/batiste-fm"
fi

if [ -z "$batiste_fm" ]; then
  printf '[%s] session-start: batiste-fm not on PATH; skipping ingest for cwd=%s\n' \
    "$(date -u +%FT%TZ)" "$cwd" >>"$LOG_FILE" 2>/dev/null || true
  printf '# Atrium: batiste-fm not installed; skipping background ingest for %s.\n' "$cwd"
  exit 0
fi

# Background ingest. --max-turns 0 = no cap (full incremental re-scan).
# `disown` so the process keeps running after the hook exits.
{
  printf '[%s] session-start: ingesting cwd=%s slug=%s\n' \
    "$(date -u +%FT%TZ)" "$cwd" "$slug" >>"$LOG_FILE" 2>/dev/null || true
  nohup "$batiste_fm" ingest cc-sessions --cwd-filter "$slug" --max-turns 0 \
    >>"$LOG_FILE" 2>&1 &
  disown 2>/dev/null || true
} >/dev/null 2>&1

printf '# Atrium: ingesting prior sessions for %s in background.\n' "$cwd"
exit 0
