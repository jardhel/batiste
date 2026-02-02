/**
 * Task Management Module
 *
 * Persistent task DAG with SQLite backing.
 * Will be extracted from seu-claude.
 */

export interface Task {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  parentId?: string;
  context: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

// Placeholder - will be populated from seu-claude
export const VERSION = '0.1.0';
