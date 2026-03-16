import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// We test config logic by reimplementing the core behaviour in-test
// against a temp directory, avoiding ~/.batiste pollution.

interface BatisteConfig {
  marketplaceUrl: string;
  gatewayUrl: string;
  creatorId: string;
  defaultAuditDb: string;
}

const DEFAULTS: BatisteConfig = {
  marketplaceUrl: 'http://localhost:3100',
  gatewayUrl: 'http://localhost:3000',
  creatorId: 'default',
  defaultAuditDb: '/tmp/.batiste/audit.db',
};

async function loadConfigFrom(dir: string): Promise<BatisteConfig> {
  const path = join(dir, 'config.json');
  if (!existsSync(path)) return { ...DEFAULTS };
  try {
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(path, 'utf8');
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<BatisteConfig>) };
  } catch {
    return { ...DEFAULTS };
  }
}

async function saveConfigTo(dir: string, partial: Partial<BatisteConfig>): Promise<void> {
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const current = await loadConfigFrom(dir);
  const merged = { ...current, ...partial };
  const { writeFile: wf } = await import('node:fs/promises');
  await wf(join(dir, 'config.json'), JSON.stringify(merged, null, 2) + '\n', 'utf8');
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join(tmpdir(), `batiste-test-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('Config', () => {
  it('returns defaults when no config file exists', async () => {
    const config = await loadConfigFrom(tmpDir + '/nonexistent');
    expect(config.marketplaceUrl).toBe('http://localhost:3100');
    expect(config.gatewayUrl).toBe('http://localhost:3000');
    expect(config.creatorId).toBe('default');
  });

  it('saves and loads a config file', async () => {
    await saveConfigTo(tmpDir, { marketplaceUrl: 'http://prod.batiste.network' });
    const config = await loadConfigFrom(tmpDir);
    expect(config.marketplaceUrl).toBe('http://prod.batiste.network');
    expect(config.gatewayUrl).toBe('http://localhost:3000'); // default preserved
  });

  it('merges partial updates', async () => {
    await saveConfigTo(tmpDir, { creatorId: 'alice' });
    await saveConfigTo(tmpDir, { gatewayUrl: 'http://gw.example.com' });
    const config = await loadConfigFrom(tmpDir);
    expect(config.creatorId).toBe('alice');
    expect(config.gatewayUrl).toBe('http://gw.example.com');
    expect(config.marketplaceUrl).toBe('http://localhost:3100'); // still default
  });

  it('saves valid JSON to disk', async () => {
    await saveConfigTo(tmpDir, { creatorId: 'test-user' });
    const raw = await (await import('node:fs/promises')).readFile(join(tmpDir, 'config.json'), 'utf8');
    const parsed = JSON.parse(raw) as BatisteConfig;
    expect(parsed.creatorId).toBe('test-user');
  });

  it('returns defaults on malformed JSON', async () => {
    await writeFile(join(tmpDir, 'config.json'), '{invalid json}', 'utf8');
    const config = await loadConfigFrom(tmpDir);
    expect(config.creatorId).toBe('default');
  });
});
