import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ConcurrentEditError,
  EditConcurrencyGuard,
} from './EditConcurrencyGuard.js';

describe('EditConcurrencyGuard', () => {
  let tmp: string;
  let guard: EditConcurrencyGuard;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ecg-'));
    guard = new EditConcurrencyGuard();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  const fixturePath = (name: string) => join(tmp, name);

  it('records Read with SHA + bytes', () => {
    const p = fixturePath('a.md');
    const content = '# hello\nworld\n';
    writeFileSync(p, content, 'utf8');

    const record = guard.recordRead(p, content, 'agent-1');

    expect(record.shaAtRead).toHaveLength(64);
    expect(record.bytesAtRead).toBe(Buffer.byteLength(content, 'utf8'));
    expect(record.agentId).toBe('agent-1');
    expect(guard.trackedCount).toBe(1);
  });

  it('passes checkBeforeEdit when file unchanged', () => {
    const p = fixturePath('b.md');
    const content = 'original content';
    writeFileSync(p, content, 'utf8');
    guard.recordRead(p, content, 'agent-1');

    const result = guard.checkBeforeEdit(p);

    expect(result.ok).toBe(true);
    expect(result.expectedSha).toEqual(result.actualSha);
  });

  it('rejects checkBeforeEdit when file changed on disk', () => {
    const p = fixturePath('c.md');
    const original = 'v1 content';
    writeFileSync(p, original, 'utf8');
    guard.recordRead(p, original, 'agent-1');

    // Simulate concurrent edit (user in Obsidian, LSP formatter, etc.)
    const modified = 'v1 content — with concurrent tweak';
    writeFileSync(p, modified, 'utf8');

    const result = guard.checkBeforeEdit(p);

    expect(result.ok).toBe(false);
    expect(result.expectedSha).not.toEqual(result.actualSha);
    expect(result.reason).toMatch(/file changed between Read/);
  });

  it('rejects checkBeforeEdit when no Read was recorded', () => {
    const p = fixturePath('d.md');
    writeFileSync(p, 'fresh', 'utf8');

    const result = guard.checkBeforeEdit(p);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no snapshot/);
  });

  it('rejects checkBeforeEdit when file missing', () => {
    const result = guard.checkBeforeEdit(fixturePath('missing.md'));
    expect(result.ok).toBe(false);
    // Path has no snapshot → error about snapshot, not about re-read.
    // This is fine: callers learn to Read before Edit.
    expect(result.reason).toMatch(/no snapshot/);
  });

  it('detects NBSP (U+00A0) injection as a concurrent modification', () => {
    const p = fixturePath('e.md');
    // Original has a regular space between "built" and "**Cachola"
    const original = 'I built **Cachola Tech**';
    writeFileSync(p, original, 'utf8');
    guard.recordRead(p, original, 'agent-1');

    // Obsidian-style NBSP injection before **bold**
    const withNbsp = 'I built **Cachola Tech**';
    writeFileSync(p, withNbsp, 'utf8');

    const result = guard.checkBeforeEdit(p);
    expect(result.ok).toBe(false);
    expect(result.expectedSha).not.toEqual(result.actualSha);
  });

  it('updateAfterEdit re-bases the snapshot to post-write content', () => {
    const p = fixturePath('f.md');
    writeFileSync(p, 'v1', 'utf8');
    guard.recordRead(p, 'v1', 'agent-1');

    // Apply an edit
    const v2 = 'v2';
    writeFileSync(p, v2, 'utf8');
    guard.updateAfterEdit(p, v2);

    // Subsequent check against the *new* baseline passes
    const result = guard.checkBeforeEdit(p);
    expect(result.ok).toBe(true);
  });

  it('forget removes a path snapshot; reset clears all', () => {
    const a = fixturePath('a.md');
    const b = fixturePath('b.md');
    writeFileSync(a, 'a', 'utf8');
    writeFileSync(b, 'b', 'utf8');
    guard.recordRead(a, 'a', 'agent-1');
    guard.recordRead(b, 'b', 'agent-1');
    expect(guard.trackedCount).toBe(2);

    guard.forget(a);
    expect(guard.trackedCount).toBe(1);
    expect(guard.getSnapshot(a)).toBeUndefined();
    expect(guard.getSnapshot(b)).toBeDefined();

    guard.reset();
    expect(guard.trackedCount).toBe(0);
  });

  it('isSafeToEdit is boolean convenience over checkBeforeEdit', () => {
    const p = fixturePath('g.md');
    writeFileSync(p, 'hello', 'utf8');
    guard.recordRead(p, 'hello', 'agent-1');
    expect(guard.isSafeToEdit(p)).toBe(true);

    writeFileSync(p, 'hello world', 'utf8');
    expect(guard.isSafeToEdit(p)).toBe(false);
  });

  it('ConcurrentEditError carries SHA diagnostics', () => {
    const p = fixturePath('h.md');
    writeFileSync(p, 'v1', 'utf8');
    guard.recordRead(p, 'v1', 'agent-1');
    writeFileSync(p, 'v1+tweak', 'utf8');

    const check = guard.checkBeforeEdit(p);
    const err = new ConcurrentEditError(check);

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ConcurrentEditError');
    expect(err.expectedSha).toEqual(check.expectedSha);
    expect(err.actualSha).toEqual(check.actualSha);
  });

  it('isStaleByMtime returns true for unknown paths', () => {
    expect(guard.isStaleByMtime(fixturePath('never-read.md'))).toBe(true);
  });
});
