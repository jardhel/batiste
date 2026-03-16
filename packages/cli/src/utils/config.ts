/**
 * CLI Config
 *
 * Persists user preferences in ~/.batiste/config.json.
 * Includes getters/setters and a merge-save helper.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface BatisteConfig {
  marketplaceUrl: string;
  gatewayUrl: string;
  creatorId: string;
  defaultAuditDb: string;
}

const DEFAULTS: BatisteConfig = {
  marketplaceUrl: 'http://localhost:3100',
  gatewayUrl: 'http://localhost:3000',
  creatorId: 'default',
  defaultAuditDb: join(homedir(), '.batiste', 'audit.db'),
};

export function configDir(): string {
  return join(homedir(), '.batiste');
}

export function configPath(): string {
  return join(configDir(), 'config.json');
}

export async function loadConfig(): Promise<BatisteConfig> {
  const path = configPath();
  if (!existsSync(path)) return { ...DEFAULTS };
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<BatisteConfig>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveConfig(partial: Partial<BatisteConfig>): Promise<void> {
  const dir = configDir();
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const current = await loadConfig();
  const merged = { ...current, ...partial };
  await writeFile(configPath(), JSON.stringify(merged, null, 2) + '\n', 'utf8');
}
