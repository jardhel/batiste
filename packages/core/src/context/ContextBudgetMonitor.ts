/**
 * Context Budget Monitor
 *
 * Tracks token usage across different categories and provides
 * warnings and suggestions when approaching or exceeding limits.
 */

export type BudgetCategory = 'code' | 'summary' | 'messages' | 'other';

export interface BudgetConfig {
  totalBudget: number;
  categoryBudgets: Partial<Record<BudgetCategory, number>>;
  warningThreshold: number; // 0-1, default 0.8 (80%)
}

export interface BudgetStatus {
  category: BudgetCategory | 'total';
  used: number;
  limit: number;
  percentage: number;
  withinBudget: boolean;
  warning: boolean;
  overBy?: number;
}

const CHARS_PER_TOKEN = 4; // Approximate for Claude tokenization

export class ContextBudgetMonitor {
  private config: BudgetConfig;
  private usage: Map<BudgetCategory, number> = new Map();

  constructor(config: BudgetConfig) {
    this.config = {
      ...config,
      warningThreshold: config.warningThreshold ?? 0.8,
    };
  }

  /**
   * Add tokens to a category
   */
  addTokens(category: BudgetCategory, tokens: number): void {
    const current = this.usage.get(category) ?? 0;
    this.usage.set(category, current + tokens);
  }

  /**
   * Add text content, auto-estimating tokens
   */
  addContent(category: BudgetCategory, content: string): number {
    const tokens = this.estimateTokens(content);
    this.addTokens(category, tokens);
    return tokens;
  }

  /**
   * Get usage for a specific category
   */
  getUsage(category: BudgetCategory): number {
    return this.usage.get(category) ?? 0;
  }

  /**
   * Get total usage across all categories
   */
  getTotalUsage(): number {
    let total = 0;
    for (const tokens of this.usage.values()) {
      total += tokens;
    }
    return total;
  }

  /**
   * Estimate tokens from text
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  /**
   * Check budget status for a category
   */
  checkBudget(category: BudgetCategory): BudgetStatus {
    const used = this.getUsage(category);
    const limit = this.config.categoryBudgets[category] ?? this.config.totalBudget;
    const percentage = limit > 0 ? used / limit : 0;
    const withinBudget = used <= limit;
    const warning = percentage >= this.config.warningThreshold && withinBudget;

    return {
      category,
      used,
      limit,
      percentage,
      withinBudget,
      warning,
      overBy: withinBudget ? undefined : used - limit,
    };
  }

  /**
   * Check total budget across all categories
   */
  checkTotalBudget(): BudgetStatus {
    const used = this.getTotalUsage();
    const limit = this.config.totalBudget;
    const percentage = limit > 0 ? used / limit : 0;
    const withinBudget = used <= limit;
    const warning = percentage >= this.config.warningThreshold && withinBudget;

    return {
      category: 'total',
      used,
      limit,
      percentage,
      withinBudget,
      warning,
      overBy: withinBudget ? undefined : used - limit,
    };
  }

  /**
   * Get suggestions based on current usage
   */
  getSuggestions(): string[] {
    const suggestions: string[] = [];

    const codeStatus = this.checkBudget('code');
    if (!codeStatus.withinBudget || codeStatus.warning) {
      suggestions.push('Consider using summarize_codebase to reduce code context');
    }

    const messagesStatus = this.checkBudget('messages');
    if (!messagesStatus.withinBudget || messagesStatus.warning) {
      suggestions.push('Consider pruning older messages from context');
    }

    const totalStatus = this.checkTotalBudget();
    if (!totalStatus.withinBudget) {
      suggestions.push('Total context budget exceeded - reduce content in all categories');
    }

    return suggestions;
  }

  /**
   * Get a formatted summary
   */
  getSummary(): string {
    const lines: string[] = ['## Context Budget Status', ''];

    const categories: BudgetCategory[] = ['code', 'summary', 'messages', 'other'];
    for (const category of categories) {
      const used = this.getUsage(category);
      if (used > 0 || this.config.categoryBudgets[category]) {
        const limit = this.config.categoryBudgets[category] ?? 'unlimited';
        const percentage =
          typeof limit === 'number' ? ((used / limit) * 100).toFixed(1) : '-';
        lines.push(`- **${category}**: ${used} / ${limit} tokens (${percentage}%)`);
      }
    }

    const total = this.getTotalUsage();
    const totalPercentage = ((total / this.config.totalBudget) * 100).toFixed(1);
    lines.push('');
    lines.push(`**Total**: ${total} / ${this.config.totalBudget} tokens (${totalPercentage}%)`);

    const suggestions = this.getSuggestions();
    if (suggestions.length > 0) {
      lines.push('');
      lines.push('### Suggestions');
      for (const suggestion of suggestions) {
        lines.push(`- ${suggestion}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Reset usage for a category or all categories
   */
  reset(category?: BudgetCategory): void {
    if (category) {
      this.usage.delete(category);
    } else {
      this.usage.clear();
    }
  }
}
