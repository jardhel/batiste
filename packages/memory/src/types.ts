/**
 * @batiste-aidk/memory · types
 *
 * Contracts for the firm's private memory layer. The firm's IP (prompts,
 * decisions, precedents, playbooks) lives inside an instance of these
 * stores, never in a public repository and never hosted by a third party
 * unless the firm explicitly opts in and records consent in the audit
 * ledger.
 *
 * This is the substrate of Batiste v2's "your-Claude" thesis: a
 * foundation-model call may only receive a retrieved chunk, not the
 * corpus.
 */

import { z } from 'zod';

export const SENSITIVITY = ['public', 'internal', 'confidential', 'confidential-nda', 'privileged'] as const;
export type Sensitivity = (typeof SENSITIVITY)[number];

export const PromptEntrySchema = z.object({
  id: z.string().min(1).describe('Stable kebab-case ID, unique within the firm'),
  title: z.string().min(1),
  category: z.string().min(1).describe('Category slug — matches batiste-prompts conventions (deal-making, governance, ...)'),
  body: z.string().min(1).describe('The prompt body with {{placeholders}}'),
  version: z.number().int().positive(),
  sensitivity: z.enum(SENSITIVITY).default('internal'),
  tags: z.array(z.string()).default([]),
  validated_on: z.string().optional().describe('ISO date of last validation against a real engagement'),
  validated_by: z.string().optional(),
  model_preference: z.enum(['claude-opus', 'claude-sonnet', 'claude-haiku', 'any']).default('any'),
  languages: z.array(z.string().length(2)).default([]),
  supersedes: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type PromptEntry = z.infer<typeof PromptEntrySchema>;

export const FactEntrySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['decision', 'precedent', 'clause', 'rejection', 'acceptance', 'observation']),
  title: z.string().min(1),
  body: z.string().min(1),
  counterparty: z.string().optional(),
  workstream: z.string().optional(),
  sensitivity: z.enum(SENSITIVITY).default('confidential'),
  tags: z.array(z.string()).default([]),
  /** Reference into the GVS vault: relative path or wikilink target */
  vault_ref: z.string().optional(),
  /** Reference into the audit ledger: stamp_hash or ref */
  audit_ref: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type FactEntry = z.infer<typeof FactEntrySchema>;

export interface SearchHit<T> {
  entry: T;
  score: number;
  reason: 'lexical' | 'vector' | 'exact-id' | 'tag';
}

export interface SearchOptions {
  limit?: number;
  minScore?: number;
  tags?: string[];
  sensitivity?: Sensitivity[];
  category?: string;
  kind?: FactEntry['kind'];
  /** When true, require at least one vector hit (semantic search); else allow lexical fallback. */
  vectorOnly?: boolean;
}

export interface MemoryStats {
  prompts: number;
  facts: number;
  bytes: number;
  lastUpdated: string | null;
}

/**
 * Abstract store contracts. v0.1 ships a SQLite-backed implementation with
 * lexical search only; vector search lands with sqlite-vec integration in
 * the v1.2.0-alpha.3 milestone.
 */
export interface PromptStore {
  put(entry: PromptEntry): Promise<void>;
  get(id: string): Promise<PromptEntry | null>;
  list(options?: Pick<SearchOptions, 'tags' | 'sensitivity' | 'category' | 'limit'>): Promise<PromptEntry[]>;
  search(query: string, options?: SearchOptions): Promise<Array<SearchHit<PromptEntry>>>;
  delete(id: string): Promise<void>;
  stats(): Promise<MemoryStats>;
}

export interface FactStore {
  put(entry: FactEntry): Promise<void>;
  get(id: string): Promise<FactEntry | null>;
  list(options?: Pick<SearchOptions, 'tags' | 'sensitivity' | 'kind' | 'limit'>): Promise<FactEntry[]>;
  search(query: string, options?: SearchOptions): Promise<Array<SearchHit<FactEntry>>>;
  delete(id: string): Promise<void>;
  stats(): Promise<MemoryStats>;
}

export interface FirmMemory {
  prompts: PromptStore;
  facts: FactStore;
  /** Total stats across both stores. */
  stats(): Promise<MemoryStats>;
  /** Close any underlying handles (DB connections, file locks). */
  close(): Promise<void>;
}
