/**
 * Tests for utils/tool-map.ts — the Batiste-by-default enforcement
 * table consumed by the PreToolUse hook (atrium-tool-mapping.sh).
 *
 * These pin:
 *   1. The shape of TOOL_MAP entries (the bash hook reads serializeToolMap()).
 *   2. The `lookup(toolName, toolInput)` helper that matches rules to a
 *      pending tool call. The hook re-implements this in shell, so
 *      these tests are also a contract for the bash side.
 *   3. The serialized form (commandRegex collapsed to nullable string).
 */

import { describe, expect, it } from 'vitest';
import {
  TOOL_MAP,
  lookup,
  serializeToolMap,
  type ToolMapEntry,
} from '../utils/tool-map.js';

describe('tool-map: TOOL_MAP shape', () => {
  it('every entry has the required fields and a known severity', () => {
    expect(TOOL_MAP.length).toBeGreaterThanOrEqual(4);
    for (const entry of TOOL_MAP) {
      expect(typeof entry.nativeTool).toBe('string');
      expect(entry.nativeTool.length).toBeGreaterThan(0);
      expect(typeof entry.batisteEquivalent).toBe('string');
      expect(entry.batisteEquivalent.startsWith('mcp__batiste__')).toBe(true);
      expect(typeof entry.reason).toBe('string');
      expect(entry.reason.length).toBeGreaterThan(0);
      expect(['hint', 'warn']).toContain(entry.severity);
      expect(typeof entry.inputMatcher).toBe('object');
      // commandRegex must be a valid extended regex when present.
      if (entry.inputMatcher.commandRegex) {
        expect(() => new RegExp(entry.inputMatcher.commandRegex!)).not.toThrow();
      }
    }
  });

  it('contains the four seed rules from the install spec', () => {
    const seedShapes: Array<Pick<ToolMapEntry, 'nativeTool' | 'batisteEquivalent'>> = [
      { nativeTool: 'Bash', batisteEquivalent: 'mcp__batiste__find_symbol' },
      { nativeTool: 'Bash', batisteEquivalent: 'mcp__batiste__validate_code' },
      { nativeTool: 'TaskCreate', batisteEquivalent: 'mcp__batiste__manage_task' },
      { nativeTool: 'TaskUpdate', batisteEquivalent: 'mcp__batiste__manage_task' },
    ];
    for (const seed of seedShapes) {
      expect(
        TOOL_MAP.some(
          (r) => r.nativeTool === seed.nativeTool && r.batisteEquivalent === seed.batisteEquivalent,
        ),
      ).toBe(true);
    }
  });
});

describe('tool-map: lookup()', () => {
  it('matches Bash(grep ...) to find_symbol', () => {
    const hits = lookup('Bash', { command: 'grep -r foo packages/' });
    const eqs = hits.map((h) => h.batisteEquivalent);
    expect(eqs).toContain('mcp__batiste__find_symbol');
  });

  it('matches Bash(pnpm tsc ...) to validate_code', () => {
    const hits = lookup('Bash', { command: 'pnpm -r tsc --noEmit' });
    const eqs = hits.map((h) => h.batisteEquivalent);
    expect(eqs).toContain('mcp__batiste__validate_code');
  });

  it('does not fire for an unrelated Bash command (echo)', () => {
    const hits = lookup('Bash', { command: 'echo hello' });
    expect(hits).toEqual([]);
  });

  it('always fires for TaskCreate / TaskUpdate regardless of input', () => {
    const tcHits = lookup('TaskCreate', {});
    const tuHits = lookup('TaskUpdate', { description: 'whatever' });
    expect(tcHits.length).toBeGreaterThan(0);
    expect(tuHits.length).toBeGreaterThan(0);
    for (const h of [...tcHits, ...tuHits]) {
      expect(h.batisteEquivalent).toBe('mcp__batiste__manage_task');
    }
  });

  it('does not fire for unmapped tool names (Read)', () => {
    expect(lookup('Read', { file_path: '/etc/passwd' })).toEqual([]);
  });
});

describe('tool-map: serializeToolMap()', () => {
  it('emits version 1 with the same rule count as TOOL_MAP', () => {
    const ser = serializeToolMap();
    expect(ser.version).toBe(1);
    expect(ser.rules).toHaveLength(TOOL_MAP.length);
    for (const rule of ser.rules) {
      expect(typeof rule.nativeTool).toBe('string');
      expect(typeof rule.batisteEquivalent).toBe('string');
      expect(typeof rule.reason).toBe('string');
      expect(['hint', 'warn']).toContain(rule.severity);
      // commandRegex is null OR a non-empty string.
      expect(rule.commandRegex === null || typeof rule.commandRegex === 'string').toBe(true);
      if (rule.commandRegex !== null) {
        expect(rule.commandRegex.length).toBeGreaterThan(0);
      }
    }
  });

  it('round-trips to JSON without losing fields the bash hook needs', () => {
    const ser = serializeToolMap();
    const json = JSON.stringify(ser);
    const back = JSON.parse(json) as typeof ser;
    expect(back.version).toBe(1);
    expect(back.rules).toEqual(ser.rules);
  });
});
