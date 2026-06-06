#!/usr/bin/env bash
# atrium-tool-mapping.sh — Claude Code PreToolUse hook
#
# The structural enforcement layer for the "Batiste-by-default" working
# agreement (CLAUDE.md). Reads the JSON event Claude Code emits before
# every tool call (`{tool_name, tool_input, ...}`), looks up matching
# rules from ~/.batiste/firm-memory/tool-map.json (seeded by
# `batiste-fm install hooks --enable-tool-mapping`), and emits a
# one-line nudge when the agent is about to use a native tool that has
# a Batiste equivalent.
#
# Hard rule: NEVER block. Decision is always implicit-allow. Exit 0 on
# every code path — including jq-missing, malformed JSON, missing
# tool-map file, regex errors. The hook is a nudge, not a gate; if it
# breaks, agent productivity must not break with it.
#
# Output contract:
#   - When at least one rule matches, emits the Claude Code PreToolUse
#     `hookSpecificOutput.additionalContext` envelope so the matched
#     messages get injected as system context for the next turn.
#   - When jq is missing, falls back to a plain stdout line (graceful
#     degradation — the message still surfaces, just not via the
#     official envelope).
#   - When nothing matches, emits nothing and exits 0.
#
# Logged failures (best-effort) go to ~/.batiste/firm-memory/.audit/hooks.log.

set -u

FM_ROOT="${BATISTE_FM_ROOT:-$HOME/.batiste/firm-memory}"
TOOL_MAP_FILE="$FM_ROOT/tool-map.json"
LOG_DIR="$FM_ROOT/.audit"
LOG_FILE="$LOG_DIR/hooks.log"

# Always exit 0 — never break a tool call because of us.
trap 'exit 0' EXIT

mkdir -p "$LOG_DIR" 2>/dev/null || true

# Read JSON event from stdin (best-effort; tolerate empty / non-JSON).
event_json=""
if [ ! -t 0 ]; then
  event_json="$(cat 2>/dev/null || true)"
fi

# Missing tool-map = silent no-op (operator hasn't run install with
# --enable-tool-mapping yet).
[ -f "$TOOL_MAP_FILE" ] || exit 0
[ -n "$event_json" ] || exit 0

# Helper: extract a top-level string field (works without jq).
extract_string_field() {
  local field="$1"
  local json="$2"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$json" | jq -r --arg f "$field" '.[$f] // empty' 2>/dev/null
  else
    printf '%s' "$json" \
      | tr '\n' ' ' \
      | sed -nE "s/.*\"$field\"[[:space:]]*:[[:space:]]*\"((\\\\.|[^\"\\\\])*)\".*/\1/p" \
      | head -n1 \
      | sed -E 's/\\n/ /g; s/\\"/"/g; s/\\\\/\\/g'
  fi
}

# Helper: extract `tool_input.command` (nested). Same jq-or-fallback.
extract_command_field() {
  local json="$1"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$json" | jq -r '.tool_input.command // empty' 2>/dev/null
  else
    # Fallback: pull `tool_input` object as raw text and re-grep for
    # `"command":"..."` inside it. Imperfect for nested escapes but
    # adequate for the bash-command shape Claude Code emits.
    printf '%s' "$json" \
      | tr '\n' ' ' \
      | sed -nE 's/.*"command"[[:space:]]*:[[:space:]]*"((\\.|[^"\\])*)".*/\1/p' \
      | head -n1 \
      | sed -E 's/\\n/ /g; s/\\"/"/g; s/\\\\/\\/g'
  fi
}

tool_name="$(extract_string_field tool_name "$event_json")"
[ -n "$tool_name" ] || exit 0

tool_command="$(extract_command_field "$event_json")"

# Build the matched-message list. Two paths:
#   - jq present: iterate rules from the JSON file.
#   - jq missing: degrade to "no nudge" (we refuse to re-implement the
#     full table in shell-only sed).
matched=""
if command -v jq >/dev/null 2>&1; then
  # Stream each rule as one compact JSON object per line. We then
  # decode fields with `jq -r` per rule so that backslashes inside
  # commandRegex survive intact (TSV / @csv would re-escape them and
  # break the regex match below).
  while IFS= read -r rule_json; do
    [ -n "$rule_json" ] || continue
    r_native="$(printf '%s' "$rule_json" | jq -r '.nativeTool // empty' 2>/dev/null)"
    [ "$r_native" = "$tool_name" ] || continue
    r_regex="$(printf '%s' "$rule_json" | jq -r '.commandRegex // empty' 2>/dev/null)"
    if [ -n "$r_regex" ] && [ "$r_regex" != "null" ]; then
      [ -n "$tool_command" ] || continue
      if ! printf '%s' "$tool_command" | grep -Eq "$r_regex" 2>/dev/null; then
        continue
      fi
    fi
    r_equiv="$(printf '%s' "$rule_json" | jq -r '.batisteEquivalent // empty' 2>/dev/null)"
    r_reason="$(printf '%s' "$rule_json" | jq -r '.reason // empty' 2>/dev/null)"
    line="[Batiste-by-default] ${r_reason} -> use ${r_equiv}"
    if [ -z "$matched" ]; then
      matched="$line"
    else
      matched="$matched"$'\n'"$line"
    fi
  done < <(jq -c '.rules[]?' "$TOOL_MAP_FILE" 2>/dev/null)
else
  printf '[%s] tool-mapping: jq missing; nudge skipped (tool=%s)\n' \
    "$(date -u +%FT%TZ)" "$tool_name" >>"$LOG_FILE" 2>/dev/null || true
  exit 0
fi

# No matches → silent.
[ -n "$matched" ] || exit 0

# Log the nudge (audit-friendly).
printf '[%s] tool-mapping: nudge tool=%s msgs=%d\n' \
  "$(date -u +%FT%TZ)" "$tool_name" "$(printf '%s\n' "$matched" | wc -l | tr -d ' ')" \
  >>"$LOG_FILE" 2>/dev/null || true

# Emit the PreToolUse envelope. jq is guaranteed to be present here
# (we early-exited above otherwise), so build the JSON via jq for
# correct escaping of the multi-line additionalContext.
envelope="$(jq -n \
  --arg ctx "$matched" \
  '{ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: $ctx } }' \
  2>/dev/null)"

if [ -n "$envelope" ]; then
  printf '%s\n' "$envelope"
else
  # Degrade: emit the raw lines so they at least appear in the hook log.
  printf '%s\n' "$matched"
fi

exit 0
