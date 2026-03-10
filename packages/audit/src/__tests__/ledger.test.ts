import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { AuditLedger } from '../ledger.js';

describe('AuditLedger', () => {
  let ledger: AuditLedger;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ledger-test-'));
    ledger = new AuditLedger(join(tmpDir, 'audit.db'));
  });

  afterEach(() => {
    ledger.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const entry = () => ({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    sessionId: 'sess-1',
    agentId: 'agent-1',
    tool: 'find_symbol',
    args: { symbolName: 'login' },
    result: 'success' as const,
    durationMs: 42,
  });

  it('should append and query entries', () => {
    ledger.append(entry());
    ledger.append(entry());
    const results = ledger.query();
    expect(results).toHaveLength(2);
  });

  it('should filter by sessionId', () => {
    ledger.append({ ...entry(), sessionId: 'sess-1' });
    ledger.append({ ...entry(), sessionId: 'sess-2' });
    expect(ledger.query({ sessionId: 'sess-1' })).toHaveLength(1);
  });

  it('should filter by agentId', () => {
    ledger.append({ ...entry(), agentId: 'a1' });
    ledger.append({ ...entry(), agentId: 'a2' });
    expect(ledger.query({ agentId: 'a1' })).toHaveLength(1);
  });

  it('should filter by tool', () => {
    ledger.append({ ...entry(), tool: 'find_symbol' });
    ledger.append({ ...entry(), tool: 'validate_code' });
    expect(ledger.query({ tool: 'find_symbol' })).toHaveLength(1);
  });

  it('should filter by result', () => {
    ledger.append({ ...entry(), result: 'success' });
    ledger.append({ ...entry(), result: 'denied' });
    ledger.append({ ...entry(), result: 'error' });
    expect(ledger.query({ result: 'denied' })).toHaveLength(1);
  });

  it('should count entries', () => {
    ledger.append(entry());
    ledger.append(entry());
    ledger.append(entry());
    expect(ledger.count()).toBe(3);
  });

  it('should count with filter', () => {
    ledger.append({ ...entry(), agentId: 'a1' });
    ledger.append({ ...entry(), agentId: 'a1' });
    ledger.append({ ...entry(), agentId: 'a2' });
    expect(ledger.count({ agentId: 'a1' })).toBe(2);
  });

  it('should preserve args as JSON', () => {
    const e = entry();
    e.args = { symbolName: 'foo', deep: { nested: true } };
    ledger.append(e);
    const results = ledger.query();
    expect(results[0]!.args).toEqual({ symbolName: 'foo', deep: { nested: true } });
  });

  it('should store optional fields', () => {
    const e = { ...entry(), astNodesAccessed: 42, bytesTransferred: 1024 };
    ledger.append(e);
    const results = ledger.query();
    expect(results[0]!.astNodesAccessed).toBe(42);
    expect(results[0]!.bytesTransferred).toBe(1024);
  });

  it('should respect limit', () => {
    for (let i = 0; i < 10; i++) ledger.append(entry());
    expect(ledger.query({ limit: 3 })).toHaveLength(3);
  });
});
