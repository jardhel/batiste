/**
 * @batiste-aidk/marketplace — shared types
 *
 * Node registry, routing, and pricing domain model.
 */

import { z } from 'zod';

// ─── Node Registry ────────────────────────────────────────────────────────────

export const NodeStatusSchema = z.enum(['online', 'standby', 'offline', 'degraded']);
export type NodeStatus = z.infer<typeof NodeStatusSchema>;

export const RegisterNodeInputSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).default(''),
  capabilities: z.array(z.string().min(1)).min(1),
  endpoint: z.string().url(),
  pricePerCycle: z.number().positive(),
  creatorId: z.string().min(1),
  tags: z.array(z.string()).default([]),
});
export type RegisterNodeInput = z.infer<typeof RegisterNodeInputSchema>;

export interface NodeRecord {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  endpoint: string;
  pricePerCycle: number;
  creatorId: string;
  tags: string[];
  status: NodeStatus;
  registeredAt: string;
  lastHeartbeat: string;
  /** Rolling 1h latency average, ms */
  latencyMs: number | null;
  /** Rolling 1h reliability 0–1 */
  reliability: number;
}

// ─── Routing ──────────────────────────────────────────────────────────────────

export interface RouteRequest {
  capability: string;
  /** Prefer nodes with these tags */
  preferTags?: string[];
  /** Hard maximum price per cycle */
  maxPricePerCycle?: number;
}

export interface RoutedNode {
  node: NodeRecord;
  /** Composite score used for selection (higher = better) */
  score: number;
}

// ─── Pricing / Billing ────────────────────────────────────────────────────────

export interface BillingEntry {
  id: string;
  sessionId: string;
  nodeId: string;
  nodeName: string;
  cyclesUsed: number;
  pricePerCycle: number;
  totalCost: number;
  recordedAt: string;
}

export interface BillingReport {
  sessionId: string;
  entries: BillingEntry[];
  totalCycles: number;
  totalCost: number;
  generatedAt: string;
}

// ─── Discovery ────────────────────────────────────────────────────────────────

export interface NodeDiscoveryQuery {
  capability?: string;
  tags?: string[];
  maxPricePerCycle?: number;
  status?: NodeStatus;
  limit?: number;
}

// ─── Gateway API shapes ───────────────────────────────────────────────────────

export const RouteRequestSchema = z.object({
  capability: z.string().min(1),
  preferTags: z.array(z.string()).optional(),
  maxPricePerCycle: z.number().positive().optional(),
});

export const RecordCyclesInputSchema = z.object({
  sessionId: z.string().min(1),
  nodeId: z.string().min(1),
  cyclesUsed: z.number().int().positive(),
});
export type RecordCyclesInput = z.infer<typeof RecordCyclesInputSchema>;
