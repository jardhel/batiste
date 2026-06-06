/**
 * Resolves the deployment-local Firm Memory data directory and namespace.
 *
 * Per ADR-0002, every deployment maintains its own SQLite + LanceDB store
 * and its own audit ledger. Atrium reads location and namespace from env
 * (overridable for tests + multi-tenant runs) with sane single-tenant
 * defaults for the founder's local deployment.
 */

import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface AtriumPaths {
  /** Root of the Firm Memory deployment on disk. */
  fmRoot: string;
  /** Directory passed to SqliteFirmMemory (memory.db + LanceDB tables live inside). */
  dataDir: string;
  /** Per-deployment audit ledger db (SQLite, WAL). */
  auditDbPath: string;
  /** Per-deployment, per-source ingestion checkpoints. */
  checkpointPath: string;
  /** Tenant namespace — every row in FM is tagged with this. */
  namespace: string;
}

export function resolvePaths(): AtriumPaths {
  const fmRoot = process.env.BATISTE_FM_ROOT ?? join(homedir(), '.batiste', 'firm-memory');
  return {
    fmRoot,
    dataDir: fmRoot,
    auditDbPath: join(fmRoot, '.audit', 'document-audit.db'),
    checkpointPath: join(fmRoot, 'checkpoints.json'),
    namespace: process.env.BATISTE_NAMESPACE ?? 'cachola-tech-founder',
  };
}

export async function ensureFmRoot(paths: AtriumPaths): Promise<void> {
  if (!existsSync(paths.fmRoot)) await mkdir(paths.fmRoot, { recursive: true });
  const auditDir = join(paths.fmRoot, '.audit');
  if (!existsSync(auditDir)) await mkdir(auditDir, { recursive: true });
}
