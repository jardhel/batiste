#!/usr/bin/env bash
# atrium-user-prompt.sh — Claude Code UserPromptSubmit hook
#
# Fires every time the operator submits a prompt. Reads `{prompt: "..."}`
# from stdin and prints the (possibly RAG-augmented) prompt to stdout.
# Claude Code uses stdout as the prompt that actually reaches the model,
# so any failure path MUST echo the original prompt — silently degrading
# is a hard requirement (per the v1.4 "never block the user" rule).
#
# When the operator's query is non-trivial (>=20 chars) and Firm Memory
# returns hits above min-score, we prepend an <atrium-context> block
# carrying provenance (id, score, source, cwd) so Claude can decide what
# to trust. The operator never sees this; it's invisible enrichment.
#
# Disable per-deployment by setting `retrieve_injection_enabled: false`
# in ~/.batiste/firm-memory/atrium-hooks.json.

set -u

FM_ROOT="${BATISTE_FM_ROOT:-$HOME/.batiste/firm-memory}"
HOOKS_CONFIG="$FM_ROOT/atrium-hooks.json"
LOG_DIR="$FM_ROOT/.audit"
LOG_FILE="$LOG_DIR/hooks.log"
MIN_LEN=20
LIMIT=3
MIN_SCORE=0.4

mkdir -p "$LOG_DIR" 2>/dev/null || true

# Read full stdin (the JSON event Claude Code passes in).
event_json=""
if [ ! -t 0 ]; then
  event_json="$(cat 2>/dev/null || true)"
fi

# Helper: extract a top-level string field from JSON. Prefers jq, falls
# back to a portable grep that handles escaped quotes well enough for
# the prompt field shape Claude Code emits.
extract_string_field() {
  local field="$1"
  local json="$2"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$json" | jq -r --arg f "$field" '.[$f] // empty' 2>/dev/null
  else
    # Strip just enough to find "<field>":"...". Doesn't handle nested
    # objects or escaped JSON characters perfectly — for our purposes
    # (extracting a prompt) it's the lesser of two evils vs. requiring jq.
    printf '%s' "$json" \
      | tr '\n' ' ' \
      | sed -nE "s/.*\"$field\"[[:space:]]*:[[:space:]]*\"((\\\\.|[^\"\\\\])*)\".*/\1/p" \
      | head -n1 \
      | sed -E 's/\\n/ /g; s/\\"/"/g; s/\\\\/\\/g'
  fi
}

# Extract a boolean field from a JSON config file. Returns "true" / "false"
# or empty when absent.
extract_bool_field() {
  local field="$1"
  local file="$2"
  [ -f "$file" ] || { printf ''; return; }
  if command -v jq >/dev/null 2>&1; then
    jq -r --arg f "$field" '.[$f] // empty' "$file" 2>/dev/null
  else
    tr -d '\n' <"$file" \
      | grep -oE "\"$field\"[[:space:]]*:[[:space:]]*(true|false)" \
      | head -n1 \
      | sed -E "s/.*:[[:space:]]*//"
  fi
}

prompt="$(extract_string_field prompt "$event_json")"

# Pass-through fallback emitter — used in every error path.
passthrough() {
  if [ -n "$prompt" ]; then
    printf '%s\n' "$prompt"
  else
    # If we couldn't parse, echo the raw stdin so we don't drop the user
    # input on the floor.
    printf '%s' "$event_json"
  fi
  exit 0
}

# Check disable switch.
enabled="$(extract_bool_field retrieve_injection_enabled "$HOOKS_CONFIG")"
if [ "$enabled" = "false" ]; then
  passthrough
fi

# Skip noise: very short prompts (e.g. `ls`, `/help`, `y`).
prompt_len=${#prompt}
if [ "$prompt_len" -lt "$MIN_LEN" ]; then
  passthrough
fi

# Locate batiste-fm. If not installed, degrade silently.
batiste_fm=""
if command -v batiste-fm >/dev/null 2>&1; then
  batiste_fm="batiste-fm"
elif [ -x "$HOME/.batiste/bin/batiste-fm" ]; then
  batiste_fm="$HOME/.batiste/bin/batiste-fm"
fi

if [ -z "$batiste_fm" ]; then
  passthrough
fi

# Run retrieve. Failure → pass through.
retrieve_json=""
if ! retrieve_json="$("$batiste_fm" retrieve "$prompt" --json --limit "$LIMIT" --min-score "$MIN_SCORE" 2>>"$LOG_FILE")"; then
  printf '[%s] user-prompt: retrieve failed; passthrough\n' \
    "$(date -u +%FT%TZ)" >>"$LOG_FILE" 2>/dev/null || true
  passthrough
fi

# Parse hit count + per-hit fields. Without jq we cannot safely render
# the context block — degrade gracefully.
if ! command -v jq >/dev/null 2>&1; then
  printf '[%s] user-prompt: jq missing; passthrough\n' \
    "$(date -u +%FT%TZ)" >>"$LOG_FILE" 2>/dev/null || true
  passthrough
fi

hit_count="$(printf '%s' "$retrieve_json" | jq -r '.hits | length' 2>/dev/null || printf '0')"
if [ -z "$hit_count" ] || [ "$hit_count" = "0" ] || [ "$hit_count" = "null" ]; then
  passthrough
fi

# Render the augmented prompt. Body is truncated to ~400 chars per hit.
context_block="$(
  printf '%s' "$retrieve_json" | jq -r --argjson n "$hit_count" '
    "<atrium-context source=\"firm-memory\" hits=\"" + ($n|tostring) + "\">\n" +
    ([.hits[] | (
      "<hit id=\"" + (.entry.id // "") + "\" score=\"" + ((.score // 0)|tostring) + "\" source=\"" + (.reason // "hybrid") + "\" cwd=\"" + ((.entry.tags // []) | map(select(startswith("cwd:"))) | (.[0] // "") | sub("^cwd:"; "")) + "\">\n" +
      "<title>" + ((.entry.title // "") | gsub("[<>]"; "")) + "</title>\n" +
      "<body>" + ((.entry.body // "") | gsub("[<>]"; "") | .[0:400]) + (if ((.entry.body // "")|length) > 400 then "..." else "" end) + "</body>\n" +
      "</hit>"
    )] | join("\n")) + "\n</atrium-context>"
  ' 2>/dev/null
)"

if [ -z "$context_block" ]; then
  passthrough
fi

printf '%s\n\n<user-prompt>\n%s\n</user-prompt>\n' "$context_block" "$prompt"
exit 0
