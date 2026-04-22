/**
 * @batiste-aidk/memory — Firm Memory
 *
 * Private, air-gapped prompt and fact store for a Batiste deployment.
 * The firm's IP lives here. A foundation-model call may receive a
 * retrieved chunk; never the corpus.
 *
 * See the v2 thesis ADR in the Cachola Tech vault:
 *   04 Decision/2026-04-22 — Batiste v2 thesis — Firm Memory + DPA-compliant gateway.md
 *
 * v0.1 scaffolds the API surface with an in-memory implementation. SQLite
 * backing + sqlite-vec for vector search land in v1.2.0-alpha.3.
 */

export {
  PromptEntrySchema,
  FactEntrySchema,
  SENSITIVITY,
} from './types.js';
export type {
  Sensitivity,
  PromptEntry,
  FactEntry,
  SearchHit,
  SearchOptions,
  MemoryStats,
  PromptStore,
  FactStore,
  FirmMemory,
} from './types.js';

export {
  InMemoryPromptStore,
  InMemoryFactStore,
  InMemoryFirmMemory,
} from './in-memory-store.js';
