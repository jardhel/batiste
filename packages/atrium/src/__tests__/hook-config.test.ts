/**
 * Pure-function tests for utils/hook-config.ts.
 *
 * These exercise the merge / remove logic that protects the operator's
 * existing ~/.claude/settings.json from the install command. Every
 * test asserts at least one "preservation" property — the whole point
 * of this helper is that we never clobber unrelated keys or foreign
 * hook entries.
 */

import { describe, expect, it } from 'vitest';
import {
  ATRIUM_MARKER,
  isAtriumEntry,
  mergeHooks,
  removeHooks,
  type ClaudeSettings,
  type MergePlan,
} from '../utils/hook-config.js';

const ATRIUM_SESSION = '/home/op/.claude/hooks/atrium-session-start.sh';
const ATRIUM_PROMPT = '/home/op/.claude/hooks/atrium-user-prompt.sh';
const FOREIGN_HOOK = '/home/op/.claude/hooks/my-existing-hook.sh';

describe('hook-config: mergeHooks', () => {
  it('preserves all unrelated top-level keys and foreign hook events', () => {
    const before: ClaudeSettings = {
      model: 'claude-opus-4-7',
      permissions: { allow: ['Bash(ls:*)'] },
      mcp: { servers: { batiste: { command: 'batiste-mcp' } } },
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: FOREIGN_HOOK }] },
        ],
        SessionStart: [
          { matcher: '*', hooks: [{ type: 'command', command: FOREIGN_HOOK }] },
        ],
      },
    };

    const plans: MergePlan[] = [
      { event: 'SessionStart', command: ATRIUM_SESSION, matcher: '*' },
    ];
    const after = mergeHooks(before, plans);

    // Top-level keys untouched.
    expect(after.model).toBe('claude-opus-4-7');
    expect(after.permissions).toEqual({ allow: ['Bash(ls:*)'] });
    expect(after.mcp).toEqual({ servers: { batiste: { command: 'batiste-mcp' } } });

    // Foreign hook event preserved.
    expect(after.hooks?.PreToolUse).toEqual([
      { matcher: 'Bash', hooks: [{ type: 'command', command: FOREIGN_HOOK }] },
    ]);

    // SessionStart's foreign entry kept; ours is appended to the same matcher group.
    const ss = after.hooks?.SessionStart ?? [];
    expect(ss).toHaveLength(1);
    expect(ss[0]?.matcher).toBe('*');
    const cmds = ss[0]?.hooks.map((h) => h.command);
    expect(cmds).toContain(FOREIGN_HOOK);
    expect(cmds).toContain(ATRIUM_SESSION);
  });

  it('adds new hook events when they did not exist before', () => {
    const before: ClaudeSettings = {};
    const plans: MergePlan[] = [
      { event: 'SessionStart', command: ATRIUM_SESSION, matcher: '*' },
      { event: 'UserPromptSubmit', command: ATRIUM_PROMPT, matcher: '*' },
    ];
    const after = mergeHooks(before, plans);

    expect(after.hooks?.SessionStart).toEqual([
      { matcher: '*', hooks: [{ type: 'command', command: ATRIUM_SESSION }] },
    ]);
    expect(after.hooks?.UserPromptSubmit).toEqual([
      { matcher: '*', hooks: [{ type: 'command', command: ATRIUM_PROMPT }] },
    ]);
  });

  it('is idempotent — re-adding the same hook is a no-op', () => {
    const plans: MergePlan[] = [
      { event: 'SessionStart', command: ATRIUM_SESSION, matcher: '*' },
    ];
    const once = mergeHooks({}, plans);
    const twice = mergeHooks(once, plans);
    const thrice = mergeHooks(twice, plans);

    expect(twice).toEqual(once);
    expect(thrice).toEqual(once);
    // And specifically: the hooks array under matcher "*" has exactly one entry.
    expect(thrice.hooks?.SessionStart?.[0]?.hooks).toHaveLength(1);
  });
});

describe('hook-config: removeHooks', () => {
  it('removes only Atrium-owned commands and leaves foreign entries intact', () => {
    const before: ClaudeSettings = {
      model: 'claude-opus-4-7',
      hooks: {
        SessionStart: [
          {
            matcher: '*',
            hooks: [
              { type: 'command', command: FOREIGN_HOOK },
              { type: 'command', command: ATRIUM_SESSION },
            ],
          },
        ],
        UserPromptSubmit: [
          { matcher: '*', hooks: [{ type: 'command', command: ATRIUM_PROMPT }] },
        ],
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: FOREIGN_HOOK }] },
        ],
      },
    };

    const after = removeHooks(before, ['SessionStart', 'UserPromptSubmit']);

    // SessionStart: foreign hook kept, Atrium one stripped.
    expect(after.hooks?.SessionStart).toEqual([
      { matcher: '*', hooks: [{ type: 'command', command: FOREIGN_HOOK }] },
    ]);
    // UserPromptSubmit: was entirely Atrium, now empty.
    expect(after.hooks?.UserPromptSubmit).toEqual([]);
    // PreToolUse: untouched (we never asked to clean it).
    expect(after.hooks?.PreToolUse).toEqual([
      { matcher: 'Bash', hooks: [{ type: 'command', command: FOREIGN_HOOK }] },
    ]);
    // Top-level keys untouched.
    expect(after.model).toBe('claude-opus-4-7');
  });

  it('is a no-op when there are no Atrium hooks to remove', () => {
    const before: ClaudeSettings = {
      hooks: {
        SessionStart: [
          { matcher: '*', hooks: [{ type: 'command', command: FOREIGN_HOOK }] },
        ],
      },
    };
    const after = removeHooks(before, ['SessionStart', 'UserPromptSubmit']);
    expect(after.hooks?.SessionStart).toEqual([
      { matcher: '*', hooks: [{ type: 'command', command: FOREIGN_HOOK }] },
    ]);
  });
});

describe('hook-config: isAtriumEntry', () => {
  it('flags entries whose every command carries the Atrium marker', () => {
    expect(
      isAtriumEntry({
        matcher: '*',
        hooks: [
          { type: 'command', command: ATRIUM_SESSION },
          { type: 'command', command: ATRIUM_PROMPT },
        ],
      }),
    ).toBe(true);

    // Mixed entry — operator combined Atrium + their own under one matcher.
    // We refuse to claim it (the remove path strips per-command, not per-entry).
    expect(
      isAtriumEntry({
        matcher: '*',
        hooks: [
          { type: 'command', command: ATRIUM_SESSION },
          { type: 'command', command: FOREIGN_HOOK },
        ],
      }),
    ).toBe(false);

    // Pure foreign entry — never Atrium.
    expect(
      isAtriumEntry({
        matcher: '*',
        hooks: [{ type: 'command', command: FOREIGN_HOOK }],
      }),
    ).toBe(false);

    // Custom marker.
    expect(
      isAtriumEntry(
        { matcher: '*', hooks: [{ type: 'command', command: '/x/y/foo-hook.sh' }] },
        'foo-',
      ),
    ).toBe(true);
  });

  it('treats empty hook arrays as not-ours (defensive)', () => {
    expect(isAtriumEntry({ matcher: '*', hooks: [] })).toBe(false);
  });
});

describe('hook-config: ATRIUM_MARKER constant', () => {
  it('is the substring used by the install command', () => {
    expect(ATRIUM_MARKER).toBe('atrium-');
  });
});
