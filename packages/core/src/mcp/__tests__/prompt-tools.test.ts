import { describe, it, expect } from 'vitest';
import { PromptRegistryImpl } from '../prompt-registry.js';
import { handlePromptTool } from '../prompt-tools.js';

describe('handlePromptTool', () => {
  it('should return handled: false for non-prompt tools', () => {
    const registry = new PromptRegistryImpl();
    const result = handlePromptTool(registry, 'find_symbol', {}, 'agent-1');
    expect(result.handled).toBe(false);
  });

  it('should register a prompt via register_prompt', () => {
    const registry = new PromptRegistryImpl();
    const result = handlePromptTool(registry, 'register_prompt', {
      name: 'code-review',
      template: 'Review this code: {{code}}',
      description: 'Code review prompt',
    }, 'agent-1');

    expect(result.handled).toBe(true);
    expect(result.result).toEqual({ registered: 'code-review' });
    expect(registry.list()).toHaveLength(1);
    expect(registry.get('code-review')!.registeredBy).toBe('agent-1');
  });

  it('should perform template substitution', async () => {
    const registry = new PromptRegistryImpl();
    handlePromptTool(registry, 'register_prompt', {
      name: 'greet',
      template: 'Hello {{name}}, welcome to {{project}}!',
    }, 'agent-1');

    const prompt = registry.get('greet')!;
    const result = await prompt.resolve({ name: 'Alice', project: 'Batiste' });
    expect(result.messages[0]!.content.text).toBe('Hello Alice, welcome to Batiste!');
  });

  it('should preserve unmatched placeholders', async () => {
    const registry = new PromptRegistryImpl();
    handlePromptTool(registry, 'register_prompt', {
      name: 'greet',
      template: 'Hello {{name}}, you have {{count}} items',
    }, 'agent-1');

    const prompt = registry.get('greet')!;
    const result = await prompt.resolve({ name: 'Alice' });
    expect(result.messages[0]!.content.text).toBe('Hello Alice, you have {{count}} items');
  });

  it('should unregister a prompt', () => {
    const registry = new PromptRegistryImpl();
    handlePromptTool(registry, 'register_prompt', {
      name: 'greet',
      template: 'Hello',
    }, 'agent-1');

    const result = handlePromptTool(registry, 'unregister_prompt', {
      name: 'greet',
    }, 'agent-1');

    expect(result.handled).toBe(true);
    expect(result.result).toEqual({ unregistered: 'greet', found: true });
    expect(registry.list()).toHaveLength(0);
  });

  it('should report when unregistering nonexistent prompt', () => {
    const registry = new PromptRegistryImpl();
    const result = handlePromptTool(registry, 'unregister_prompt', {
      name: 'nonexistent',
    }, 'agent-1');

    expect(result.result).toEqual({ unregistered: 'nonexistent', found: false });
  });

  it('should use specified role', async () => {
    const registry = new PromptRegistryImpl();
    handlePromptTool(registry, 'register_prompt', {
      name: 'assist',
      template: 'I can help with {{topic}}',
      role: 'assistant',
    }, 'agent-1');

    const prompt = registry.get('assist')!;
    const result = await prompt.resolve({ topic: 'testing' });
    expect(result.messages[0]!.role).toBe('assistant');
  });
});
