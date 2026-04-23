import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventLog, EventLogEntrySchema } from '../event-log.js';

describe('EventLog', () => {
  let log: EventLog;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'event-log-test-'));
    log = new EventLog(join(tmpDir, 'events.db'));
  });

  afterEach(() => {
    log.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const entry = () => ({
    ts: new Date().toISOString(),
    event: 'file.created',
    stream: 'ana-luisa',
    generator: 'tools/audit-emit.ts',
    payload: { path: 'releases/x/INDEX.md' },
  });

  it('appends and queries entries', () => {
    log.append(entry());
    log.append(entry());
    const rows = log.query();
    expect(rows).toHaveLength(2);
    expect(rows[0]?.event).toBe('file.created');
    expect(rows[0]?.stream).toBe('ana-luisa');
    expect(rows[0]?.payload).toEqual({ path: 'releases/x/INDEX.md' });
  });

  it('filters by event', () => {
    log.append({ ...entry(), event: 'file.created' });
    log.append({ ...entry(), event: 'pdf.recompiled' });
    expect(log.query({ event: 'file.created' })).toHaveLength(1);
  });

  it('filters by stream', () => {
    log.append({ ...entry(), stream: 'ana-luisa' });
    log.append({ ...entry(), stream: 'dr-dias' });
    expect(log.query({ stream: 'ana-luisa' })).toHaveLength(1);
  });

  it('filters by since timestamp', () => {
    const past = '2020-01-01T00:00:00.000Z';
    const future = '2099-01-01T00:00:00.000Z';
    log.append({ ...entry(), ts: past });
    log.append({ ...entry(), ts: future });
    expect(log.query({ since: '2050-01-01T00:00:00.000Z' })).toHaveLength(1);
  });

  it('counts matching entries', () => {
    log.append({ ...entry(), stream: 'ana-luisa' });
    log.append({ ...entry(), stream: 'ana-luisa' });
    log.append({ ...entry(), stream: 'dr-dias' });
    expect(log.count({ stream: 'ana-luisa' })).toBe(2);
    expect(log.count()).toBe(3);
  });

  it('omits optional fields when null in DB', () => {
    log.append({ ts: new Date().toISOString(), event: 'minimal' });
    const rows = log.query();
    expect(rows[0]?.event).toBe('minimal');
    expect(rows[0]?.stream).toBeUndefined();
    expect(rows[0]?.generator).toBeUndefined();
    expect(rows[0]?.payload).toBeUndefined();
  });

  it('rejects invalid entries via zod', () => {
    expect(() => log.append({ ts: 'not-a-date', event: 'x' } as never)).toThrow();
    expect(() => log.append({ ts: new Date().toISOString(), event: '' } as never)).toThrow();
  });

  it('exports schema for external validation', () => {
    const result = EventLogEntrySchema.safeParse(entry());
    expect(result.success).toBe(true);
  });
});
