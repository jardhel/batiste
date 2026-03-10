import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AuditLedger } from '../ledger.js';
import { AuditedPromptHandler } from '../prompt-audit.js';
import type { PromptHandler } from '@batiste/core/mcp';

const mockPromptHandler: PromptHandler = {
  async listPrompts() {
    return [{ name: 'greet', description: 'Greeting prompt' }];
  },
  async getPrompt(name, args) {
    if (name === 'fail') throw new Error('deliberate');
    return {
      description: `Resolved ${name}`,
      messages: [{ role: 'user', content: { type: 'text', text: `Hello ${args['name'] ?? 'world'}` } }],
    };
  },
};

describe('AuditedPromptHandler', () => {
  let ledger: AuditLedger;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'prompt-audit-'));
    ledger = new AuditLedger(join(tmpDir, 'audit.db'));
  });

  afterEach(() => {
    ledger.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should log prompts/list call', async () => {
    const audited = new AuditedPromptHandler(mockPromptHandler, {
      ledger,
      sessionId: 'sess-1',
      agentId: 'agent-1',
    });

    const prompts = await audited.listPrompts();
    expect(prompts).toHaveLength(1);

    const entries = ledger.query({ tool: 'prompts/list' });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.result).toBe('success');
    expect(entries[0]!.agentId).toBe('agent-1');
  });

  it('should log prompts/get call with args', async () => {
    const audited = new AuditedPromptHandler(mockPromptHandler, {
      ledger,
      sessionId: 'sess-1',
      agentId: 'agent-1',
    });

    const result = await audited.getPrompt('greet', { name: 'Alice' });
    expect(result.messages[0]!.content.text).toBe('Hello Alice');

    const entries = ledger.query({ tool: 'prompts/get' });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.result).toBe('success');
    expect(entries[0]!.args).toEqual({ name: 'Alice' });
  });

  it('should log errors from getPrompt', async () => {
    const audited = new AuditedPromptHandler(mockPromptHandler, {
      ledger,
      sessionId: 'sess-1',
      agentId: 'agent-1',
    });

    await expect(audited.getPrompt('fail', {})).rejects.toThrow('deliberate');

    const entries = ledger.query({ tool: 'prompts/get' });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.result).toBe('error');
  });

  it('should record duration', async () => {
    const audited = new AuditedPromptHandler(mockPromptHandler, {
      ledger,
      sessionId: 'sess-1',
      agentId: 'agent-1',
    });

    await audited.listPrompts();
    const entries = ledger.query();
    expect(entries[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });
});
