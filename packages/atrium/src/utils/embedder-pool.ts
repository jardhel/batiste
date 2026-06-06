/**
 * Embedder pool — N-instance round-robin wrapper around the local
 * Xenova/all-MiniLM-L6-v2 embedder used by Firm Memory.
 *
 * v1.3.1 status: HELPER ONLY, NOT YET WIRED INTO `fm.facts.put`.
 *
 * Why it exists today: the per-turn embedding step inside
 * `SqliteFirmMemory.put()` is the dominant cost of a `cc-sessions`
 * brain-dump (typical: 70-90% of wall time). Wrapping the per-file ingest
 * loop in `pLimit` already buys us overlap on SQLite WAL writes and audit
 * appends, but the embedder itself is single-instance and serializes
 * inside the FM. To unlock embedder-level parallelism we need either
 * (a) a pool of `EmbeddingEngine` instances handed to the FM, or
 * (b) a sharded FM with one engine per shard. Both require API additions
 * inside `@batiste-aidk/memory` (FactStore needs to accept an externally-
 * supplied embedder).
 *
 * Until that landing, this module:
 *   - Documents the intended pool API so the memory-side change can be
 *     written against a stable consumer.
 *   - Lets the operator construct a pool in scripts that go around FM
 *     and embed text directly (e.g., for ad-hoc reranking experiments).
 *
 * The pool accepts a factory so callers can pass any concrete embedder —
 * including the real `EmbeddingEngine` from `@batiste-aidk/memory`'s
 * `vector/embed.ts` once that class is exposed via the package's
 * `exports` field. The structural `EmbedderLike` interface mirrors that
 * class's shape so the swap is mechanical.
 */

/**
 * Minimal structural shape of `@batiste-aidk/memory`'s `EmbeddingEngine`.
 * Kept in sync with `packages/memory/src/vector/embed.ts`. If the upstream
 * class adds a method we want to surface here, extend this interface.
 */
export interface EmbedderLike {
  initialize(): Promise<void>;
  embed(text: string): Promise<number[]>;
  embedQuery(text: string): Promise<number[]>;
  getDimensions?(): number;
}

export type EmbedderFactory = () => EmbedderLike;

export interface EmbedderPoolOptions {
  /** Number of pooled embedder instances. Coerced to `>= 1`. */
  size: number;
  /**
   * Builds one embedder per slot. Called lazily on first use. Each
   * factory invocation MUST return an independent instance — sharing a
   * single underlying transformers pipeline across slots would re-
   * serialize the work and defeat the pool.
   */
  factory: EmbedderFactory;
}

export class EmbedderPool {
  private readonly _size: number;
  private readonly factory: EmbedderFactory;
  private engines: EmbedderLike[] | null = null;
  private initPromise: Promise<void> | null = null;
  private cursor = 0;

  constructor(opts: EmbedderPoolOptions) {
    this._size = Math.max(1, Math.floor(Number.isFinite(opts.size) ? opts.size : 1));
    this.factory = opts.factory;
  }

  /** Number of slots in the pool. */
  get size(): number {
    return this._size;
  }

  private async ensureReady(): Promise<EmbedderLike[]> {
    if (this.engines) return this.engines;
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const built: EmbedderLike[] = [];
        for (let i = 0; i < this._size; i++) {
          const eng = this.factory();
          await eng.initialize();
          built.push(eng);
        }
        this.engines = built;
      })();
    }
    await this.initPromise;
    if (!this.engines) {
      throw new Error('EmbedderPool failed to initialize');
    }
    return this.engines;
  }

  private pick(engines: EmbedderLike[]): EmbedderLike {
    const idx = this.cursor % engines.length;
    this.cursor = (this.cursor + 1) % engines.length;
    const eng = engines[idx];
    if (!eng) {
      // noUncheckedIndexedAccess guard — should be unreachable.
      throw new Error(`EmbedderPool slot ${idx} is empty`);
    }
    return eng;
  }

  async embed(text: string): Promise<number[]> {
    const engines = await this.ensureReady();
    return this.pick(engines).embed(text);
  }

  async embedQuery(text: string): Promise<number[]> {
    const engines = await this.ensureReady();
    return this.pick(engines).embedQuery(text);
  }
}
