/**
 * Safe read/merge/write for Claude Code's `~/.claude/settings.json`.
 *
 * The hooks-install subcommand has to amend a JSON file the operator
 * very likely already maintains by hand: their MCP servers, model
 * routing, allowed tools, etc. Wiping or reformatting that file would
 * be a hostile dogfood violation, so this helper guarantees three
 * properties:
 *
 *   1. **Preserve unrelated keys.** Anything outside `.hooks` is
 *      round-tripped untouched. Inside `.hooks`, hook events we don't
 *      manage (PreToolUse, PostToolUse, Notification, Stop, ...) are
 *      preserved verbatim.
 *   2. **Preserve foreign hook entries.** Within `SessionStart` /
 *      `UserPromptSubmit`, only entries whose every command path
 *      contains an Atrium-owned marker (default: `atrium-`) are
 *      considered ours. Foreign entries (an operator's pre-existing
 *      hook) are never touched.
 *   3. **Idempotency.** Re-running install with the same args produces
 *      the same file (no duplicate entries). Uninstall removes only
 *      our entries and leaves an empty `[]` (or drops the key entirely
 *      if doing so doesn't strand an empty `hooks` object).
 *
 * Pure functions: `mergeHooks` / `removeHooks` operate on parsed JSON
 * and have no I/O, which is what the unit tests exercise. The
 * `read*` / `write*` helpers are thin filesystem wrappers used by the
 * install command.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

/** Minimal shape of one entry in a Claude Code hooks array. */
export interface HookCommand {
  type: 'command';
  command: string;
  /** Optional ms timeout passed straight through to Claude Code. */
  timeout?: number;
}

export interface HookEntry {
  /** Glob/regex matcher Claude Code uses; "*" = all. */
  matcher: string;
  hooks: HookCommand[];
}

/**
 * The subset of Claude Code settings we care about. `hooks` is keyed by
 * the event name (SessionStart, UserPromptSubmit, PreToolUse, ...).
 * Everything else is preserved as-is via `Record<string, unknown>`.
 */
export type ClaudeSettings = Record<string, unknown> & {
  hooks?: Record<string, HookEntry[]>;
};

/** Marker substring that identifies an Atrium-owned hook entry. */
export const ATRIUM_MARKER = 'atrium-';

export interface MergePlan {
  /** Event name → entry to add (e.g. "SessionStart"). */
  event: string;
  /** Absolute path to the hook script that goes in `command`. */
  command: string;
  /** Defaults to "*". */
  matcher?: string;
  /** Optional timeout in ms. */
  timeout?: number;
}

/**
 * Returns true iff every command in this entry is Atrium-owned. We use
 * "every" instead of "any" so that an operator who manually combined
 * an Atrium hook with their own under one matcher still keeps their own.
 */
export function isAtriumEntry(entry: HookEntry, marker = ATRIUM_MARKER): boolean {
  if (!entry || !Array.isArray(entry.hooks) || entry.hooks.length === 0) return false;
  return entry.hooks.every((h) => typeof h?.command === 'string' && h.command.includes(marker));
}

/**
 * Merge a plan into existing settings, returning a new object. Idempotent:
 * if an entry with the same matcher + command already exists, no duplicate
 * is added.
 */
export function mergeHooks(settings: ClaudeSettings, plans: MergePlan[]): ClaudeSettings {
  // Shallow clone so callers can diff before/after if they want.
  const next: ClaudeSettings = { ...settings };
  const hooks: Record<string, HookEntry[]> = { ...(next.hooks ?? {}) };

  for (const plan of plans) {
    const matcher = plan.matcher ?? '*';
    const list = [...(hooks[plan.event] ?? [])];

    // Look for an existing entry under the same matcher we can extend
    // (so two Atrium hooks sharing matcher "*" collapse cleanly).
    const existingIdx = list.findIndex((e) => e.matcher === matcher);
    if (existingIdx >= 0) {
      const existing = list[existingIdx]!;
      const already = existing.hooks.some((h) => h.command === plan.command);
      if (!already) {
        const newHook: HookCommand = { type: 'command', command: plan.command };
        if (typeof plan.timeout === 'number') newHook.timeout = plan.timeout;
        list[existingIdx] = {
          matcher,
          hooks: [...existing.hooks, newHook],
        };
      }
    } else {
      const newHook: HookCommand = { type: 'command', command: plan.command };
      if (typeof plan.timeout === 'number') newHook.timeout = plan.timeout;
      list.push({ matcher, hooks: [newHook] });
    }
    hooks[plan.event] = list;
  }

  next.hooks = hooks;
  return next;
}

/**
 * Remove every Atrium-owned hook command from the named events. Foreign
 * entries (no Atrium marker in any command) are left untouched. Empty
 * arrays after removal are kept as `[]` so the operator can see we
 * cleaned up — drop them entirely only when the entire `hooks` object
 * would otherwise vanish.
 */
export function removeHooks(
  settings: ClaudeSettings,
  events: string[],
  marker = ATRIUM_MARKER,
): ClaudeSettings {
  const next: ClaudeSettings = { ...settings };
  if (!next.hooks) return next;
  const hooks: Record<string, HookEntry[]> = { ...next.hooks };

  for (const event of events) {
    const list = hooks[event];
    if (!Array.isArray(list)) continue;
    const cleaned: HookEntry[] = [];
    for (const entry of list) {
      if (!entry || !Array.isArray(entry.hooks)) continue;
      // Strip Atrium-owned commands from the entry; keep the rest.
      const remainingCommands = entry.hooks.filter(
        (h) => !(typeof h?.command === 'string' && h.command.includes(marker)),
      );
      if (remainingCommands.length > 0) {
        cleaned.push({ matcher: entry.matcher, hooks: remainingCommands });
      }
      // If `remainingCommands` is empty, this entry was entirely ours —
      // drop it.
    }
    hooks[event] = cleaned;
  }

  next.hooks = hooks;
  return next;
}

/**
 * Read a Claude Code settings file. If the file is missing, returns an
 * empty object (the merge helpers handle that case). Throws on
 * malformed JSON — we'd rather fail loudly than silently overwrite.
 */
export async function readSettingsFile(path: string): Promise<ClaudeSettings> {
  if (!existsSync(path)) return {};
  const raw = await readFile(path, 'utf8');
  if (raw.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Settings file is not a JSON object: ${path}`);
    }
    return parsed as ClaudeSettings;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse Claude Code settings at ${path}: ${msg}`);
  }
}

/**
 * Write the settings file, formatting with two-space indentation
 * (Claude Code's own default) and a trailing newline.
 */
export async function writeSettingsFile(path: string, settings: ClaudeSettings): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const serialized = JSON.stringify(settings, null, 2) + '\n';
  await writeFile(path, serialized, 'utf8');
}
