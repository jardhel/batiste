/**
 * LanceDB vector store — ported from seu-claude/src/vector/store.ts,
 * generalized for Firm Memory (prompts + facts as separate tables).
 *
 * Only stores {id, vector, updated_at} in Lance — canonical data lives
 * in SQLite. On search: Lance returns ids, SQLite fetches payloads.
 */

import * as lancedb from '@lancedb/lancedb';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { logger } from '../logger.js';

export interface VectorRecord {
  id: string;
  vector: number[];
  updated_at: string;
  [key: string]: unknown;
}

export interface VectorSearchHit {
  id: string;
  distance: number;
}

export class VectorStore {
  private db: lancedb.Connection | null = null;
  private tables = new Map<string, lancedb.Table>();
  private log = logger.child('vstore');
  private initialized = false;

  constructor(private dataDir: string) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const dbPath = join(this.dataDir, 'lancedb');
    await mkdir(dbPath, { recursive: true });
    this.db = await lancedb.connect(dbPath);
    this.initialized = true;
    this.log.info(`Vector store opened at ${dbPath}`);
  }

  private async getTable(name: string, sampleRecord: VectorRecord): Promise<lancedb.Table> {
    if (!this.db) throw new Error('VectorStore not initialized');
    const cached = this.tables.get(name);
    if (cached) return cached;
    const existing = await this.db.tableNames();
    let table: lancedb.Table;
    if (existing.includes(name)) {
      table = await this.db.openTable(name);
    } else {
      table = await this.db.createTable(name, [sampleRecord as Record<string, unknown>]);
      // Remove the seed record so the table is empty.
      await table.delete(`id = '${sampleRecord.id}'`);
    }
    this.tables.set(name, table);
    return table;
  }

  async upsert(tableName: string, records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return;
    const seed = records[0];
    if (!seed) return;
    const table = await this.getTable(tableName, seed);
    // Delete-then-add = upsert.
    const ids = records.map((r) => `'${r.id.replace(/'/g, "''")}'`).join(',');
    await table.delete(`id IN (${ids})`);
    await table.add(records as Record<string, unknown>[]);
  }

  async search(tableName: string, queryVector: number[], limit = 10): Promise<VectorSearchHit[]> {
    if (!this.db) throw new Error('VectorStore not initialized');
    const existing = await this.db.tableNames();
    if (!existing.includes(tableName)) return [];
    const table = this.tables.get(tableName) ?? (await this.db.openTable(tableName));
    this.tables.set(tableName, table);
    const rows = await table.search(queryVector).limit(limit).toArray();
    return rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      distance: (r._distance as number) ?? 0,
    }));
  }

  async delete(tableName: string, id: string): Promise<void> {
    if (!this.db) throw new Error('VectorStore not initialized');
    const existing = await this.db.tableNames();
    if (!existing.includes(tableName)) return;
    const table = this.tables.get(tableName) ?? (await this.db.openTable(tableName));
    this.tables.set(tableName, table);
    await table.delete(`id = '${id.replace(/'/g, "''")}'`);
  }

  async count(tableName: string): Promise<number> {
    if (!this.db) throw new Error('VectorStore not initialized');
    const existing = await this.db.tableNames();
    if (!existing.includes(tableName)) return 0;
    const table = this.tables.get(tableName) ?? (await this.db.openTable(tableName));
    this.tables.set(tableName, table);
    return await table.countRows();
  }

  close(): void {
    this.tables.clear();
    this.db = null;
    this.initialized = false;
  }
}
