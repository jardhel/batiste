/**
 * Per-source ingestion checkpoint.
 *
 * Atrium is incremental by design: ADR-0002 §"Replication flows" mandates
 * that each source can be re-ingested without re-processing already-imported
 * content. The checkpoint store records, per source key, whatever opaque
 * marker the source needs (last byte offset for jsonl, last sync timestamp
 * for Drive/Trello, file mtime for vault, etc.) so subsequent runs are O(delta).
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

export type CheckpointMap = Record<string, Record<string, string | number>>;

export async function loadCheckpoints(path: string): Promise<CheckpointMap> {
  if (!existsSync(path)) return {};
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as CheckpointMap;
    }
    return {};
  } catch {
    return {};
  }
}

export async function saveCheckpoints(path: string, checkpoints: CheckpointMap): Promise<void> {
  await writeFile(path, JSON.stringify(checkpoints, null, 2) + '\n', 'utf8');
}

export function getCheckpoint<T extends string | number>(
  checkpoints: CheckpointMap,
  source: string,
  key: string,
): T | undefined {
  return checkpoints[source]?.[key] as T | undefined;
}

export function setCheckpoint(
  checkpoints: CheckpointMap,
  source: string,
  key: string,
  value: string | number,
): void {
  if (!checkpoints[source]) checkpoints[source] = {};
  checkpoints[source][key] = value;
}
