/**
 * Registry tests — validate the strategy lookup contract that
 * Phase 2b's graph builder relies on.
 */
import { describe, it, expect } from 'vitest';
import { LanguageRegistry, defaultRegistry, defaultRegistrySync } from '../registry.js';
import { typescriptStrategy } from '../typescript.js';
import { pythonStrategy } from '../python.js';
import { javascriptStrategy } from '../javascript.js';
import { goStrategy } from '../go.js';
import { rustStrategy } from '../rust.js';

describe('LanguageRegistry', () => {
  it('registers a strategy and looks it up by name', () => {
    const registry = new LanguageRegistry();
    registry.register(typescriptStrategy);
    expect(registry.forName('typescript')).toBe(typescriptStrategy);
  });

  it('registers a strategy and looks it up by file path', () => {
    const registry = new LanguageRegistry();
    registry.register(pythonStrategy);
    expect(registry.forFile('/tmp/foo.py')?.name).toBe('python');
    expect(registry.forFile('/tmp/foo.pyi')?.name).toBe('python');
  });

  it('returns null for unknown extensions', () => {
    const registry = new LanguageRegistry();
    registry.register(goStrategy);
    expect(registry.forFile('/tmp/foo.py')).toBeNull();
    expect(registry.forName('python')).toBeNull();
  });

  it('handles uppercase extensions', () => {
    const registry = new LanguageRegistry();
    registry.register(rustStrategy);
    expect(registry.forFile('/tmp/Main.RS')?.name).toBe('rust');
  });

  it('reports supported extensions and names', () => {
    const registry = new LanguageRegistry();
    registry.registerAll([typescriptStrategy, pythonStrategy]);
    expect(registry.names()).toContain('typescript');
    expect(registry.names()).toContain('python');
    expect(registry.extensions()).toContain('.ts');
    expect(registry.extensions()).toContain('.py');
  });

  it('last-write-wins on conflicting extensions', () => {
    const registry = new LanguageRegistry();
    registry.register(typescriptStrategy);
    // Re-registering JS overrides .ts? Build a fake strategy that
    // claims `.ts` and verify it wins. This guards the "user override"
    // contract documented on the class.
    const fake = {
      name: 'fake',
      extensions: ['.ts'],
      parserFactory: () => null,
      extractSymbols: () => [],
      extractImports: () => [],
    };
    registry.register(fake);
    expect(registry.forFile('/tmp/x.ts')?.name).toBe('fake');
    // Original `forName` lookup still works for the original strategy.
    expect(registry.forName('typescript')).toBe(typescriptStrategy);
  });

  it('defaultRegistrySync wires up every default strategy', () => {
    const registry = defaultRegistrySync([
      typescriptStrategy,
      pythonStrategy,
      javascriptStrategy,
      goStrategy,
      rustStrategy,
    ]);
    expect(registry.names()).toEqual(
      expect.arrayContaining(['typescript', 'python', 'javascript', 'go', 'rust'])
    );
    expect(registry.forFile('/tmp/x.ts')?.name).toBe('typescript');
    expect(registry.forFile('/tmp/x.js')?.name).toBe('javascript');
    expect(registry.forFile('/tmp/x.py')?.name).toBe('python');
    expect(registry.forFile('/tmp/x.go')?.name).toBe('go');
    expect(registry.forFile('/tmp/x.rs')?.name).toBe('rust');
  });

  it('defaultRegistry (async) loads all strategies via dynamic import', async () => {
    const registry = await defaultRegistry();
    expect(registry.names().length).toBeGreaterThanOrEqual(5);
    expect(registry.supports('/tmp/x.go')).toBe(true);
    expect(registry.supports('/tmp/x.unknown')).toBe(false);
  });
});
