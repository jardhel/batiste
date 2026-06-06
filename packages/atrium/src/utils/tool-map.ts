/**
 * Tool mapping — Batiste-by-default enforcement table.
 *
 * The third Atrium hook (PreToolUse, see `bin/atrium-tool-mapping.sh`)
 * uses this to nudge Claude Code when a native tool call has a
 * Batiste-tool equivalent. The table itself is the single source of
 * truth: at install time, `install-hooks.ts` serializes it to
 * `~/.batiste/firm-memory/tool-map.json` so the bash hook can read it
 * without re-implementing the rules in shell.
 *
 * Origin: CLAUDE.md "Tool mapping — Batiste-first" table. This file
 * is a structural-enforcement copy of that human-facing table — when
 * the table in CLAUDE.md changes, this file should be updated to match
 * (and the test below pins the rule count + shape so drift is visible).
 *
 * Severity:
 *   - 'hint'  — soft nudge; sometimes the native tool is the right call
 *               (e.g. `grep` for plain-text search). Fires every time
 *               but framed as advisory.
 *   - 'warn'  — strong nudge; the Batiste tool is almost always correct
 *               (e.g. TaskCreate vs persistent manage_task DAG).
 */

/** Patterns the bash hook can use to refine when a rule fires. */
export interface InputMatcher {
  /**
   * Extended regex tested against `tool_input.command` (Bash only, in
   * practice). When set, the rule only fires if the regex matches.
   * Empty/undefined = always fire for this `nativeTool`.
   */
  commandRegex?: string;
}

export type Severity = 'hint' | 'warn';

export interface ToolMapEntry {
  /** Native Claude Code tool name (e.g. "Bash", "TaskCreate"). */
  nativeTool: string;
  /** Optional refinement; defaults to "always fire". */
  inputMatcher: InputMatcher;
  /** The Batiste MCP tool the operator should reach for instead. */
  batisteEquivalent: string;
  /** One-line user-facing nudge surfaced via PreToolUse hook output. */
  reason: string;
  /** UI hint vs strong recommendation. */
  severity: Severity;
}

/**
 * The mapping. Order matters only for stable output: the bash hook
 * iterates in array order and concatenates messages.
 */
export const TOOL_MAP: readonly ToolMapEntry[] = [
  {
    nativeTool: 'Bash',
    inputMatcher: { commandRegex: '^\\s*(grep|rg|ag)\\b' },
    batisteEquivalent: 'mcp__batiste__find_symbol',
    reason:
      'Symbol search → use find_symbol (LSP + tree-sitter aware). Plain-text grep is fine; symbol search is not.',
    severity: 'hint',
  },
  {
    nativeTool: 'Bash',
    inputMatcher: { commandRegex: '\\b(tsc|typecheck|eslint)\\b' },
    batisteEquivalent: 'mcp__batiste__validate_code',
    reason:
      'validate_code runs eslint + tsc together with structured truncation. Native pnpm typecheck/eslint is acceptable for full-build verification but flagged here.',
    severity: 'hint',
  },
  {
    nativeTool: 'TaskCreate',
    inputMatcher: {},
    batisteEquivalent: 'mcp__batiste__manage_task',
    reason:
      'manage_task is the persistent DAG (parent/child, idempotent). TaskCreate is per-session only.',
    severity: 'warn',
  },
  {
    nativeTool: 'TaskUpdate',
    inputMatcher: {},
    batisteEquivalent: 'mcp__batiste__manage_task',
    reason: 'Same — manage_task with action=update.',
    severity: 'warn',
  },
  // Additional discovered rules (CLAUDE.md table rows that weren't in
  // the initial seed but are still binding):
  {
    nativeTool: 'Bash',
    inputMatcher: { commandRegex: '\\bgrep\\b.*\\b(import|require|from)\\b' },
    batisteEquivalent: 'mcp__batiste__analyze_dependency',
    reason:
      'Grep-for-imports → use analyze_dependency (structured import graph, surfaces circulars).',
    severity: 'hint',
  },
  {
    // Note: dash boundaries (`\b--fix\b`) misbehave under BSD grep
    // because `-` is not a word character, so we match `--fix` as a
    // literal token preceded by a space or start-of-line.
    nativeTool: 'Bash',
    inputMatcher: { commandRegex: '\\beslint\\b.*(^|\\s)--fix(\\s|$)' },
    batisteEquivalent: 'mcp__batiste__auto_fix',
    reason:
      'auto_fix runs eslint-with-fix then re-verifies via tsc. Prefer it over raw `eslint --fix`.',
    severity: 'hint',
  },
];

/**
 * Find every rule that matches a (toolName, toolInput) pair. Used by
 * the install-hooks command for sanity checks and by the bash-side
 * tests. The bash hook re-implements the same logic over JSON.
 */
export function lookup(
  toolName: string,
  toolInput: Record<string, unknown> | undefined,
): ToolMapEntry[] {
  const matches: ToolMapEntry[] = [];
  for (const rule of TOOL_MAP) {
    if (rule.nativeTool !== toolName) continue;
    const cmdRegex = rule.inputMatcher.commandRegex;
    if (cmdRegex) {
      const command = typeof toolInput?.command === 'string' ? toolInput.command : '';
      if (!command) continue;
      try {
        if (!new RegExp(cmdRegex).test(command)) continue;
      } catch {
        // Malformed regex in the table → skip the rule rather than
        // crash the hook. Tests pin the regex shapes, so this is
        // defensive only.
        continue;
      }
    }
    matches.push(rule);
  }
  return matches;
}

/**
 * Serialize the map for the bash hook. Kept as a separate function so
 * tests can pin the exact JSON shape the shell side parses.
 */
export interface SerializedToolMap {
  version: 1;
  rules: Array<{
    nativeTool: string;
    commandRegex: string | null;
    batisteEquivalent: string;
    reason: string;
    severity: Severity;
  }>;
}

export function serializeToolMap(): SerializedToolMap {
  return {
    version: 1,
    rules: TOOL_MAP.map((r) => ({
      nativeTool: r.nativeTool,
      commandRegex: r.inputMatcher.commandRegex ?? null,
      batisteEquivalent: r.batisteEquivalent,
      reason: r.reason,
      severity: r.severity,
    })),
  };
}
