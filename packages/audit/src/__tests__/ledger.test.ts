import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
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

  it('should round-trip measured token usage', () => {
    ledger.append({
      ...entry(),
      usage: {
        inputTokens: 1200,
        outputTokens: 340,
        cachedTokens: 800,
        modelId: 'claude-opus-4-8',
        provider: 'anthropic',
        source: 'api_usage',
      },
    });
    const [row] = ledger.query();
    expect(row!.usage).toEqual({
      inputTokens: 1200,
      outputTokens: 340,
      cachedTokens: 800,
      modelId: 'claude-opus-4-8',
      provider: 'anthropic',
      source: 'api_usage',
    });
  });

  it('should leave usage absent for non-inference tool calls', () => {
    ledger.append(entry());
    expect(ledger.query()[0]!.usage).toBeUndefined();
  });

  it('should sum token totals only over measured rows', () => {
    const usage = (i: number, o: number) => ({
      inputTokens: i, outputTokens: o, modelId: 'claude-opus-4-8',
      provider: 'anthropic', source: 'api_usage' as const,
    });
    ledger.append({ ...entry(), usage: usage(1000, 200) });
    ledger.append({ ...entry(), usage: usage(500, 100) });
    ledger.append(entry()); // no usage — must not count
    const totals = ledger.tokenTotals();
    expect(totals).toEqual({ inferences: 2, inputTokens: 1500, outputTokens: 300, cachedTokens: 0 });
  });

  it('should add token columns to a ledger created before instrumentation', () => {
    // Build a real pre-instrumentation table (the exact schema the old code
    // emitted, with no token columns) and seed a row, so the migration is
    // genuinely exercised rather than masked by a fresh CREATE TABLE.
    const dbPath = join(tmpDir, 'legacy.db');
    const raw = new Database(dbPath);
    raw.exec(`
      CREATE TABLE audit_log (
        id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, session_id TEXT NOT NULL,
        agent_id TEXT NOT NULL, tool TEXT NOT NULL, args_json TEXT NOT NULL,
        result TEXT NOT NULL, duration_ms REAL NOT NULL,
        ast_nodes_accessed INTEGER, bytes_transferred INTEGER
      )
    `);
    raw.prepare(
      'INSERT INTO audit_log (id, timestamp, session_id, agent_id, tool, args_json, result, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(randomUUID(), new Date().toISOString(), 'sess-old', 'agent-old', 'find_symbol', '{}', 'success', 7);
    raw.close();

    // Opening through AuditLedger triggers migrateTokenColumns().
    const reopened = new AuditLedger(dbPath);
    reopened.append({
      ...entry(),
      usage: { inputTokens: 10, outputTokens: 5, modelId: 'claude-opus-4-8', provider: 'anthropic', source: 'api_usage' },
    });
    expect(reopened.count()).toBe(2); // legacy row preserved + new row
    expect(reopened.tokenTotals()).toEqual({ inferences: 1, inputTokens: 10, outputTokens: 5, cachedTokens: 0 });
    reopened.close();
  });
});
