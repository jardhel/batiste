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
import { TokenUsageSchema, type TokenUsage } from './types.js';

/**
 * Context a {@link UsageResolver} receives after a tool call completes.
 * The resolver is the seam through which the HOST — which actually invoked
 * an LLM/VLM and therefore holds the provider's measured `usage` payload —
 * stamps the model into the ledger row. The runtime never invents this.
 */
export interface UsageResolverContext {
  tool: string;
  args: Record<string, unknown>;
  /** The handler's return value, when the call succeeded. */
  output?: unknown;
  result: 'success' | 'error';
}

/**
 * Resolves the measured token usage for a tool call, or `undefined` when the
 * call performed no inference (file read, grep, symbol lookup…). The returned
 * object is validated against {@link TokenUsageSchema}, so its `source` must
 * be the literal `'api_usage'` — a derived `chars/4` estimate cannot be
 * laundered in as if it were measured. Returning a value that fails the gate
 * is treated as "no usage" rather than persisted, keeping the ledger honest
 * by construction.
 */
export type UsageResolver = (
  ctx: UsageResolverContext,
) => TokenUsage | undefined | Promise<TokenUsage | undefined>;

export interface AuditMiddlewareConfig {
  ledger: AuditLedger;
  killSwitch?: KillSwitch;
  monitor?: SessionMonitor;
  sessionId: string;
  agentId: string;
  /**
   * Optional hook that supplies the measured model/token usage for a tool
   * call. Only the host knows what model ran and what the provider billed, so
   * it injects that here. Absent → rows carry no `usage` (the common case for
   * non-inference tools). See {@link UsageResolver}.
   */
  resolveUsage?: UsageResolver;
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
    let output: unknown;

    try {
      output = await this.inner.handleTool(name, args);
      return output;
    } catch (error) {
      result = 'error';
      throw error;
    } finally {
      const durationMs = performance.now() - start;
      const usage = await this.resolveUsage({ tool: name, args, output, result });

      ledger.append({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        sessionId,
        agentId,
        tool: name,
        args,
        result,
        durationMs,
        ...(usage ? { usage } : {}),
      });

      monitor?.recordCall(sessionId, durationMs, result === 'error');
    }
  }

  /**
   * Ask the configured resolver for measured usage and enforce the provenance
   * gate. A resolver that throws, or hands back something that fails
   * {@link TokenUsageSchema} (e.g. a non-`api_usage` source), yields no
   * `usage` — the ledger stays append-only-honest rather than recording a
   * fabricated number. The model stamp is best-effort instrumentation; it must
   * never break the tool call it is observing.
   */
  private async resolveUsage(ctx: UsageResolverContext): Promise<TokenUsage | undefined> {
    const resolver = this.config.resolveUsage;
    if (!resolver) return undefined;
    try {
      const candidate = await resolver(ctx);
      if (candidate === undefined) return undefined;
      const parsed = TokenUsageSchema.safeParse(candidate);
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  async close(): Promise<void> {
    await this.inner.close?.();
  }
}
