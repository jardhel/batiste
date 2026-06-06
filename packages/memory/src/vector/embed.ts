/**
 * Local embedding engine — ported from seu-claude/src/vector/embed.ts
 * (migration completing the v1.2.0-alpha.3 milestone).
 *
 * Local-first: uses @huggingface/transformers with on-disk model cache.
 * No external API calls. Golden strategy of Batiste.
 */

import { pipeline, type FeatureExtractionPipeline, env } from '@huggingface/transformers';
import { join } from 'path';
import { mkdir } from 'fs/promises';
import { logger } from '../logger.js';

const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';
const DEFAULT_DIMS = 384;

export interface EmbeddingOptions {
  dataDir: string;
  model?: string;
  dimensions?: number;
}

export class EmbeddingEngine {
  private embedder: FeatureExtractionPipeline | null = null;
  private log = logger.child('embed');
  private initialized = false;
  private dims: number = DEFAULT_DIMS;

  constructor(private opts: EmbeddingOptions) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const modelCacheDir = join(this.opts.dataDir, 'models');
    await mkdir(modelCacheDir, { recursive: true });

    env.cacheDir = modelCacheDir;
    env.allowRemoteModels = true;
    env.allowLocalModels = true;

    const modelId = this.opts.model || DEFAULT_MODEL;
    this.dims = this.opts.dimensions || DEFAULT_DIMS;

    this.log.info(`Loading embedding model: ${modelId}`);
    this.embedder = await pipeline('feature-extraction', modelId, { dtype: 'q8' });
    this.log.info(`Embedding model ready (${this.dims} dims)`);
    this.initialized = true;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.embedder) throw new Error('EmbeddingEngine not initialized');
    const prefixed = `search_document: ${text}`;
    const result = await this.embedder(prefixed, { pooling: 'mean', normalize: true });
    const arr = Array.from(result.data as Float32Array);
    return arr.slice(0, this.dims);
  }

  async embedBatch(texts: string[], batchSize = 32): Promise<number[][]> {
    if (!this.embedder) throw new Error('EmbeddingEngine not initialized');
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const prefixed = batch.map((t) => `search_document: ${t}`);
      const result = await this.embedder(prefixed, { pooling: 'mean', normalize: true });
      const data = (result as unknown as { data: Float32Array }).data;
      const perItem = data.length / batch.length;
      for (let j = 0; j < batch.length; j++) {
        const start = j * perItem;
        out.push(Array.from(data.slice(start, start + this.dims)));
      }
    }
    return out;
  }

  async embedQuery(query: string): Promise<number[]> {
    if (!this.embedder) throw new Error('EmbeddingEngine not initialized');
    const prefixed = `search_query: ${query}`;
    const result = await this.embedder(prefixed, { pooling: 'mean', normalize: true });
    const arr = Array.from(result.data as Float32Array);
    return arr.slice(0, this.dims);
  }

  getDimensions(): number {
    return this.dims;
  }
}
