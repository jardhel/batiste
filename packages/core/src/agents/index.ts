/**
 * Agent Orchestration Module
 *
 * Multi-agent workflow management with specialized agents.
 * Will be extracted from seu-claude.
 */

export type AgentRole = 'orchestrator' | 'coder' | 'reviewer' | 'tester' | 'documenter';

export interface AgentTask {
  description: string;
  context: Record<string, unknown>;
  files?: string[];
}

// Placeholder - will be populated from seu-claude
export const VERSION = '0.1.0';
