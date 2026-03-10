/**
 * Compliance Report
 *
 * Generates audit reports from the ledger in JSON format.
 */

import type { AuditLedger, LedgerQuery } from './ledger.js';
import type { SessionMonitor } from './session-monitor.js';

export interface ComplianceReport {
  generatedAt: string;
  period: { from: string; to: string };
  summary: {
    totalCalls: number;
    successCount: number;
    deniedCount: number;
    errorCount: number;
    uniqueAgents: number;
    uniqueSessions: number;
  };
  activeSessions: number;
  topTools: Array<{ tool: string; count: number }>;
}

export function generateReport(
  ledger: AuditLedger,
  monitor: SessionMonitor | undefined,
  query: LedgerQuery = {},
): ComplianceReport {
  const entries = ledger.query({ ...query, limit: 10_000 });
  const now = new Date().toISOString();

  const successCount = entries.filter((e) => e.result === 'success').length;
  const deniedCount = entries.filter((e) => e.result === 'denied').length;
  const errorCount = entries.filter((e) => e.result === 'error').length;

  const uniqueAgents = new Set(entries.map((e) => e.agentId)).size;
  const uniqueSessions = new Set(entries.map((e) => e.sessionId)).size;

  // Top tools
  const toolCounts = new Map<string, number>();
  for (const entry of entries) {
    toolCounts.set(entry.tool, (toolCounts.get(entry.tool) ?? 0) + 1);
  }
  const topTools = Array.from(toolCounts.entries())
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const timestamps = entries.map((e) => e.timestamp).sort();

  return {
    generatedAt: now,
    period: {
      from: query.since ?? timestamps[0] ?? now,
      to: now,
    },
    summary: {
      totalCalls: entries.length,
      successCount,
      deniedCount,
      errorCount,
      uniqueAgents,
      uniqueSessions,
    },
    activeSessions: monitor?.size ?? 0,
    topTools,
  };
}
