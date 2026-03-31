/**
 * Audited Prompt Handler
 *
 * Wraps a PromptHandler to log prompt operations to the audit ledger.
 * Uses 'prompts/list' and 'prompts/get' as the tool name convention.
 */

import { randomUUID } from 'node:crypto';
import type { PromptHandler, PromptDefinition, PromptMessageContent } from '@batiste-aidk/core/mcp';
import { AuditLedger } from './ledger.js';

export interface PromptAuditConfig {
  ledger: AuditLedger;
  sessionId: string;
  agentId: string;
}

export class AuditedPromptHandler implements PromptHandler {
  private readonly inner: PromptHandler;
  private readonly config: PromptAuditConfig;

  constructor(handler: PromptHandler, config: PromptAuditConfig) {
    this.inner = handler;
    this.config = config;
  }

  async listPrompts(): Promise<PromptDefinition[]> {
    const { ledger, sessionId, agentId } = this.config;
    const start = performance.now();
    let result: 'success' | 'error' = 'success';

    try {
      return await this.inner.listPrompts();
    } catch (error) {
      result = 'error';
      throw error;
    } finally {
      ledger.append({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        sessionId,
        agentId,
        tool: 'prompts/list',
        args: {},
        result,
        durationMs: performance.now() - start,
      });
    }
  }

  async getPrompt(
    name: string,
    args: Record<string, string>,
  ): Promise<{ description?: string; messages: PromptMessageContent[] }> {
    const { ledger, sessionId, agentId } = this.config;
    const start = performance.now();
    let result: 'success' | 'error' = 'success';

    try {
      return await this.inner.getPrompt(name, args);
    } catch (error) {
      result = 'error';
      throw error;
    } finally {
      ledger.append({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        sessionId,
        agentId,
        tool: 'prompts/get',
        args: { name, ...args },
        result,
        durationMs: performance.now() - start,
      });
    }
  }
}
