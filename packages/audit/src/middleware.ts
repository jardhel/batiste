/**
 * Audit Middleware
 *
 * Wraps a ToolHandler to log every tool call to the audit ledger.
 */

import { randomUUID } from 'node:crypto';
import type { ToolHandler } from '@batiste-aidk/core/mcp';
import { AuditLedger } from './ledger.js';
import { KillSwitch } from './kill-switch.js';
import { SessionMonitor } from './session-monitor.js';

export interface AuditMiddlewareConfig {
  ledger: AuditLedger;
  killSwitch?: KillSwitch;
  monitor?: SessionMonitor;
  sessionId: string;
  agentId: string;
}

export class AuditedToolHandler implements ToolHandler {
  private readonly inner: ToolHandler;
  private readonly config: AuditMiddlewareConfig;

  constructor(handler: ToolHandler, config: AuditMiddlewareConfig) {
    this.inner = handler;
    this.config = config;
  }

  async handleTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const { ledger, killSwitch, monitor, sessionId, agentId } = this.config;

    // Check kill switch
    if (killSwitch && !killSwitch.isAllowed(sessionId)) {
      const entry = {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        sessionId,
        agentId,
        tool: name,
        args,
        result: 'denied' as const,
        durationMs: 0,
      };
      ledger.append(entry);
      throw new Error('Session has been terminated by kill switch');
    }

    const start = performance.now();
    let result: 'success' | 'error' = 'success';

    try {
      const output = await this.inner.handleTool(name, args);
      return output;
    } catch (error) {
      result = 'error';
      throw error;
    } finally {
      const durationMs = performance.now() - start;

      ledger.append({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        sessionId,
        agentId,
        tool: name,
        args,
        result,
        durationMs,
      });

      monitor?.recordCall(sessionId, durationMs, result === 'error');
    }
  }

  async close(): Promise<void> {
    await this.inner.close?.();
  }
}
