/**
 * Strategy Pattern · Public Surface
 *
 * Re-exports the registry, base contract, and every default
 * strategy. Phase 2b's graph builder imports from here when it needs
 * the canonical list of supported languages.
 */
export {
  type CodeSymbol,
  type ImportStatement,
  type LanguageStrategy,
  type QueryPatterns,
  nodeRange,
  toLegacyStrategy,
  unquoteStringLiteral,
  walkTree,
} from './base.js';
export { LanguageRegistry, defaultRegistry, defaultRegistrySync } from './registry.js';
export { typescriptStrategy } from './typescript.js';
export { pythonStrategy } from './python.js';
export { javascriptStrategy } from './javascript.js';
export { goStrategy } from './go.js';
export { rustStrategy } from './rust.js';

import { typescriptStrategy } from './typescript.js';
import { pythonStrategy } from './python.js';
import { javascriptStrategy } from './javascript.js';
import { goStrategy } from './go.js';
import { rustStrategy } from './rust.js';
import type { LanguageStrategy } from './base.js';

/** The full Phase 2a default strategy lineup. */
export const DEFAULT_STRATEGIES: readonly LanguageStrategy[] = [
  typescriptStrategy,
  pythonStrategy,
  javascriptStrategy,
  goStrategy,
  rustStrategy,
];
