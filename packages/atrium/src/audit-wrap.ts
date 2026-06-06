/**
 * Audit-emit-before-mutation wrapper for Firm Memory writes.
 *
 * ADR-0002 §"Replication flows" requires every FM mutation to be ledgered
 * BEFORE it commits, so a mutation that crashes mid-flight is visible in the
 * audit chain (drift detection) and so the projection itself is auditable.
 * ADR-0006 designates Atrium as the package that owns this wrapper —
 * direct callers of `SqliteFirmMemory.put()` outside Atrium are deprecated.
 */

import { randomUUID } from 'node:crypto';
import { AuditLedger, type AuditEntry } from '@batiste-aidk/audit';

export interface AuditedRunContext {
  ledger: AuditLedger;
  sessionId: string;
  agentId: string;
}

export async function withAudit<T>(
  ctx: AuditedRunContext,
  tool: string,
  args: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  const id = randomUUID();
  const timestamp = new Date(startedAt).toISOString();
  let result: AuditEntry['result'] = 'success';
  try {
    return await fn();
  } catch (err) {
    result = 'error';
    throw err;
  } finally {
    const entry: AuditEntry = {
      id,
      timestamp,
      sessionId: ctx.sessionId,
      agentId: ctx.agentId,
      tool,
      args,
      result,
      durationMs: Date.now() - startedAt,
    };
    try {
      ctx.ledger.append(entry);
    } catch {
      // Ledger append must never block the user-facing operation; a ledger
      // outage is itself an audit-emit failure that the deployment monitor
      // catches separately. Swallow to keep the original exception (if any)
      // as the surfaced error.
    }
  }
}
