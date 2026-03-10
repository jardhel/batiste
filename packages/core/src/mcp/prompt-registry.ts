/**
 * Prompt Registry
 *
 * In-memory store for registered MCP prompts.
 * Supports static (node-owner) and dynamic (agent) prompts.
 */

import type { PromptDefinition, PromptRegistry, RegisteredPrompt } from './types.js';

export class PromptRegistryImpl implements PromptRegistry {
  private readonly prompts = new Map<string, RegisteredPrompt>();
  private readonly listeners = new Set<() => void>();

  register(prompt: RegisteredPrompt): void {
    this.prompts.set(prompt.definition.name, prompt);
    this.notify();
  }

  unregister(name: string): boolean {
    const existed = this.prompts.delete(name);
    if (existed) this.notify();
    return existed;
  }

  list(): PromptDefinition[] {
    return Array.from(this.prompts.values()).map((p) => p.definition);
  }

  get(name: string): RegisteredPrompt | undefined {
    return this.prompts.get(name);
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
