import { describe, it, expect, vi } from 'vitest';
import { PromptRegistryImpl } from '../prompt-registry.js';
import type { RegisteredPrompt } from '../types.js';

function makePrompt(name: string, registeredBy = 'node-owner'): RegisteredPrompt {
  return {
    definition: { name, description: `Prompt ${name}` },
    registeredBy,
    registeredAt: new Date().toISOString(),
    resolve: async (args) => ({
      messages: [{ role: 'user', content: { type: 'text', text: `Hello ${args['name'] ?? 'world'}` } }],
    }),
  };
}

describe('PromptRegistry', () => {
  it('should register and list prompts', () => {
    const registry = new PromptRegistryImpl();
    registry.register(makePrompt('greet'));
    registry.register(makePrompt('review'));

    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list.map((p) => p.name)).toContain('greet');
    expect(list.map((p) => p.name)).toContain('review');
  });

  it('should get a prompt by name', () => {
    const registry = new PromptRegistryImpl();
    registry.register(makePrompt('greet'));

    const prompt = registry.get('greet');
    expect(prompt).toBeDefined();
    expect(prompt!.definition.name).toBe('greet');
  });

  it('should return undefined for unknown prompt', () => {
    const registry = new PromptRegistryImpl();
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('should unregister a prompt', () => {
    const registry = new PromptRegistryImpl();
    registry.register(makePrompt('greet'));

    expect(registry.unregister('greet')).toBe(true);
    expect(registry.list()).toHaveLength(0);
    expect(registry.get('greet')).toBeUndefined();
  });

  it('should return false when unregistering nonexistent prompt', () => {
    const registry = new PromptRegistryImpl();
    expect(registry.unregister('nonexistent')).toBe(false);
  });

  it('should overwrite prompt with same name', () => {
    const registry = new PromptRegistryImpl();
    registry.register(makePrompt('greet', 'agent-1'));
    registry.register(makePrompt('greet', 'agent-2'));

    expect(registry.list()).toHaveLength(1);
    expect(registry.get('greet')!.registeredBy).toBe('agent-2');
  });

  it('should fire onChange on register', () => {
    const registry = new PromptRegistryImpl();
    const listener = vi.fn();
    registry.onChange(listener);

    registry.register(makePrompt('greet'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('should fire onChange on unregister', () => {
    const registry = new PromptRegistryImpl();
    registry.register(makePrompt('greet'));

    const listener = vi.fn();
    registry.onChange(listener);

    registry.unregister('greet');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('should not fire onChange when unregister returns false', () => {
    const registry = new PromptRegistryImpl();
    const listener = vi.fn();
    registry.onChange(listener);

    registry.unregister('nonexistent');
    expect(listener).not.toHaveBeenCalled();
  });

  it('should allow removing onChange listener', () => {
    const registry = new PromptRegistryImpl();
    const listener = vi.fn();
    const unsubscribe = registry.onChange(listener);

    unsubscribe();
    registry.register(makePrompt('greet'));
    expect(listener).not.toHaveBeenCalled();
  });

  it('should resolve prompt with arguments', async () => {
    const registry = new PromptRegistryImpl();
    registry.register(makePrompt('greet'));

    const prompt = registry.get('greet')!;
    const result = await prompt.resolve({ name: 'Alice' });
    expect(result.messages[0]!.content.text).toBe('Hello Alice');
  });
});
