import { z } from 'zod';

export const AuditEntrySchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
  sessionId: z.string(),
  agentId: z.string(),
  tool: z.string(),
  args: z.record(z.unknown()),
  result: z.enum(['success', 'denied', 'error']),
  durationMs: z.number(),
  astNodesAccessed: z.number().optional(),
  bytesTransferred: z.number().optional(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const KillCommandSchema = z.object({
  action: z.enum(['kill_session', 'kill_all', 'pause', 'resume']),
  sessionId: z.string().optional(),
  reason: z.string(),
});
export type KillCommand = z.infer<typeof KillCommandSchema>;
