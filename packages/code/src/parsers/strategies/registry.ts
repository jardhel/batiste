/**
 * Strategy Pattern · Registry
 *
 * Holds every {@link LanguageStrategy} known at runtime and lets the
 * adapter / Phase 2b graph builder look strategies up by file path or
 * by language name. Adding a new language only requires registering
 * one more strategy here.
 *
 * The registry deliberately does NOT instantiate `tree-sitter`
 * `Parser` objects — that responsibility stays with the adapter, so
 * strategies remain pure descriptors that are cheap to import even in
 * environments that cannot load native tree-sitter bindings (e.g.,
 * doc generation).
 */
import { extname } from 'path';
import type { LanguageStrategy } from './base.js';

export class LanguageRegistry {
  private byName = new Map<string, LanguageStrategy>();
  private byExtension = new Map<string, LanguageStrategy>();

  /** Register a strategy. Last-write-wins on conflicting extensions. */
  register(strategy: LanguageStrategy): void {
    this.byName.set(strategy.name, strategy);
    for (const rawExt of strategy.extensions) {
      const ext = rawExt.toLowerCase();
      this.byExtension.set(ext, strategy);
    }
  }

  /** Bulk register — convenience for `defaultRegistry()`. */
  registerAll(strategies: readonly LanguageStrategy[]): void {
    for (const s of strategies) this.register(s);
  }

  /** Look up a strategy by file path (matches by extension). */
  forFile(filePath: string): LanguageStrategy | null {
    const ext = extname(filePath).toLowerCase();
    return this.byExtension.get(ext) ?? null;
  }

  /** Look up a strategy by language name (`typescript`, `python`, ...). */
  forName(name: string): LanguageStrategy | null {
    return this.byName.get(name) ?? null;
  }

  /** Every registered strategy. */
  all(): readonly LanguageStrategy[] {
    return Array.from(this.byName.values());
  }

  /** Every registered language name. */
  names(): readonly string[] {
    return Array.from(this.byName.keys());
  }

  /** Every registered file extension. */
  extensions(): readonly string[] {
    return Array.from(this.byExtension.keys());
  }

  /** Whether the registry can handle the given file. */
  supports(filePath: string): boolean {
    return this.forFile(filePath) !== null;
  }
}

/**
 * Build a registry pre-populated with every default strategy.
 *
 * Imports are deferred to keep the registry construction cheap and to
 * isolate native binding load failures (e.g., on a platform missing
 * one of the prebuilds) to a single language rather than the whole
 * adapter.
 */
export async function defaultRegistry(): Promise<LanguageRegistry> {
  const registry = new LanguageRegistry();
  const [
    { typescriptStrategy },
    { pythonStrategy },
    { javascriptStrategy },
    { goStrategy },
    { rustStrategy },
  ] = await Promise.all([
    import('./typescript.js'),
    import('./python.js'),
    import('./javascript.js'),
    import('./go.js'),
    import('./rust.js'),
  ]);
  registry.registerAll([
    typescriptStrategy,
    pythonStrategy,
    javascriptStrategy,
    goStrategy,
    rustStrategy,
  ]);
  return registry;
}

/**
 * Synchronous variant that takes pre-imported strategies. Used by
 * `TreeSitterAdapter`'s constructor where dynamic import is not
 * desirable.
 */
export function defaultRegistrySync(strategies: readonly LanguageStrategy[]): LanguageRegistry {
  const registry = new LanguageRegistry();
  registry.registerAll(strategies);
  return registry;
}
