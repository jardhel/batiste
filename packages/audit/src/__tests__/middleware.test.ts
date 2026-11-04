import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AuditLedger } from '../ledger.js';
import { KillSwitch } from '../kill-switch.js';
import { SessionMonitor } from '../session-monitor.js';
import { AuditedToolHandler } from '../middleware.js';
import type { TokenUsage } from '../types.js';
import type { ToolHandler } from '@batiste-aidk/core/mcp';

const mockHandler: ToolHandler = {
  async handleTool(name: string, args: Record<string, unknown>) {
    if (name === 'fail') throw new Error('deliberate');
    return { tool: name, args };
  },
};

describe('AuditedToolHandler', () => {
  let ledger: AuditLedger;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'audit-mw-'));
    ledger = new AuditLedger(join(tmpDir, 'audit.db'));
  });

  afterEach(() => {
    ledger.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should log successful tool calls', async () => {
    const audited = new AuditedToolHandler(mockHandler, {
      ledger,
      sessionId: 'sess-1',
      agentId: 'agent-1',
    });
    await audited.handleTool('find_symbol', { symbolName: 'test' });
    const entries = ledger.query();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.result).toBe('success');
    expect(entries[0]!.tool).toBe('find_symbol');
  });

  it('should log errors', async () => {
    const audited = new AuditedToolHandler(mockHandler, {
      ledger,
      sessionId: 'sess-1',
      agentId: 'agent-1',
    });
    await expect(audited.handleTool('fail', {})).rejects.toThrow('deliberate');
    const entries = ledger.query();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.result).toBe('error');
  });

  it('should enforce kill switch', async () => {
    const ks = new KillSwitch();
    ks.execute({ action: 'kill_session', sessionId: 'sess-1', reason: 'test' });

    const audited = new AuditedToolHandler(mockHandler, {
      ledger,
      killSwitch: ks,
      sessionId: 'sess-1',
      agentId: 'agent-1',
    });

    await expect(audited.handleTool('find_symbol', {})).rejects.toThrow('kill switch');
    const entries = ledger.query();
    expect(entries[0]!.result).toBe('denied');
  });

  it('should update session monitor', async () => {
    const monitor = new SessionMonitor();
    monitor.start('sess-1', 'agent-1');

    const audited = new AuditedToolHandler(mockHandler, {
      ledger,
      monitor,
      sessionId: 'sess-1',
      agentId: 'agent-1',
    });

    await audited.handleTool('test', {});
    expect(monitor.get('sess-1')!.toolCalls).toBe(1);
  });

  it('should record duration', async () => {
    const audited = new AuditedToolHandler(mockHandler, {
      ledger,
      sessionId: 'sess-1',
      agentId: 'agent-1',
    });
    await audited.handleTool('test', {});
    const entries = ledger.query();
    expect(entries[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should leave usage absent when no resolver is configured', async () => {
    const audited = new AuditedToolHandler(mockHandler, {
      ledger,
      sessionId: 'sess-1',
      agentId: 'agent-1',
    });
    await audited.handleTool('classify', {});
    expect(ledger.query()[0]!.usage).toBeUndefined();
  });

  it('should stamp the model when the resolver supplies measured usage', async () => {
    const audited = new AuditedToolHandler(mockHandler, {
      ledger,
      sessionId: 'sess-1',
      agentId: 'agent-1',
      resolveUsage: ({ tool }) =>
        tool === 'reason'
          ? {
              inputTokens: 1200,
              outputTokens: 340,
              modelId: 'claude-opus-4-8',
              provider: 'anthropic',
              source: 'api_usage',
            }
          : undefined,
    });

    await audited.handleTool('reason', { q: 'hard' });

    // The ledger now answers "which model executed which tool".
    const [row] = ledger.query();
    expect(row!.tool).toBe('reason');
    expect(row!.usage?.modelId).toBe('claude-opus-4-8');
    expect(row!.usage?.provider).toBe('anthropic');

    const totals = ledger.tokenTotals();
    expect(totals).toEqual({
      inferences: 1,
      inputTokens: 1200,
      outputTokens: 340,
      cachedTokens: 0,
    });
  });

  it('should let the resolver decide per-tool (inference vs not)', async () => {
    const audited = new AuditedToolHandler(mockHandler, {
      ledger,
      sessionId: 'sess-1',
      agentId: 'agent-1',
      // Only the inference tool carries usage; the grep does not.
      resolveUsage: ({ tool }) =>
        tool === 'reason'
          ? {
              inputTokens: 10,
              outputTokens: 5,
              modelId: 'qwen3-30b-a3b',
              provider: 'local',
              source: 'api_usage',
            }
          : undefined,
    });

    await audited.handleTool('grep', { pattern: 'foo' });
    await audited.handleTool('reason', { q: 'x' });

    const byModel = (model: string) =>
      ledger.query().filter((e) => e.usage?.modelId === model);
    expect(byModel('qwen3-30b-a3b')).toHaveLength(1);
    expect(byModel('qwen3-30b-a3b')[0]!.tool).toBe('reason');
    // grep row carries no model stamp
    expect(ledger.query({ tool: 'grep' })[0]!.usage).toBeUndefined();
  });

  it('should reject an estimated (non-api_usage) source — provenance gate', async () => {
    const audited = new AuditedToolHandler(mockHandler, {
      ledger,
      sessionId: 'sess-1',
      agentId: 'agent-1',
      // A resolver trying to launder a chars/4 estimate: source is wrong.
      // Cast through unknown because the type forbids this exact mistake — the
      // runtime gate (TokenUsageSchema) is the second line of defence the test
      // exercises.
      resolveUsage: () =>
        ({
          inputTokens: 999,
          outputTokens: 999,
          modelId: 'fabricated',
          provider: 'estimate',
          source: 'estimate',
        }) as unknown as TokenUsage,
    });

    await audited.handleTool('reason', {});
    // The gate dropped the bogus usage rather than persisting it.
    expect(ledger.query()[0]!.usage).toBeUndefined();
    expect(ledger.tokenTotals().inferences).toBe(0);
  });

  it('should still stamp usage when the tool call errored', async () => {
    const audited = new AuditedToolHandler(mockHandler, {
      ledger,
      sessionId: 'sess-1',
      agentId: 'agent-1',
      resolveUsage: ({ result }) =>
        result === 'error'
          ? {
              inputTokens: 50,
              outputTokens: 0,
              modelId: 'claude-opus-4-8',
              provider: 'anthropic',
              source: 'api_usage',
            }
          : undefined,
    });

    await expect(audited.handleTool('fail', {})).rejects.toThrow('deliberate');
    const [row] = ledger.query();
    expect(row!.result).toBe('error');
    expect(row!.usage?.inputTokens).toBe(50);
  });

  it('should not break the tool call when the resolver throws', async () => {
    const audited = new AuditedToolHandler(mockHandler, {
      ledger,
      sessionId: 'sess-1',
      agentId: 'agent-1',
      resolveUsage: () => {
        throw new Error('resolver boom');
      },
    });

    const out = await audited.handleTool('reason', { q: 'x' });
    expect(out).toEqual({ tool: 'reason', args: { q: 'x' } });
    expect(ledger.query()[0]!.usage).toBeUndefined();
  });
});
