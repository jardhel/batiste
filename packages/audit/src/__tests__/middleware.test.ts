import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AuditLedger } from '../ledger.js';
import { KillSwitch } from '../kill-switch.js';
import { SessionMonitor } from '../session-monitor.js';
import { AuditedToolHandler } from '../middleware.js';
import type { ToolHandler } from '@batiste/core/mcp';

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
});
