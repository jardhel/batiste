/**
 * Context Budget Module
 *
 * Token budget monitoring and management.
 * Will be extracted from seu-claude.
 */

export type BudgetCategory = 'code' | 'summary' | 'messages' | 'other';

export interface BudgetConfig {
  totalBudget: number;
  categoryBudgets: Partial<Record<BudgetCategory, number>>;
  warningThreshold: number;
}

// Placeholder - will be populated from seu-claude
export const VERSION = '0.1.0';
