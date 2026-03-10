import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { KeyStore } from '../key-store.js';

describe('KeyStore', () => {
  let store: KeyStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'keystore-test-'));
    store = new KeyStore(join(tmpDir, 'tokens.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const sampleToken = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    agentId: 'test-agent',
    projectId: 'test-project',
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    revoked: false,
    scopeJson: JSON.stringify({ tools: ['find_symbol'], operations: ['read'] }),
  };

  it('should store a token', () => {
    store.store(sampleToken);
    expect(store.countActive()).toBe(1);
  });

  it('should check revocation status', () => {
    store.store(sampleToken);
    expect(store.isRevoked(sampleToken.id)).toBe(false);
  });

  it('should revoke a token', () => {
    store.store(sampleToken);
    expect(store.revoke(sampleToken.id)).toBe(true);
    expect(store.isRevoked(sampleToken.id)).toBe(true);
  });

  it('should return false for revoking unknown token', () => {
    expect(store.revoke('nonexistent')).toBe(false);
  });

  it('should list active tokens', () => {
    store.store(sampleToken);
    store.store({
      ...sampleToken,
      id: '660e8400-e29b-41d4-a716-446655440001',
      agentId: 'agent-2',
    });
    const active = store.listActive();
    expect(active).toHaveLength(2);
  });

  it('should exclude revoked tokens from active list', () => {
    store.store(sampleToken);
    store.revoke(sampleToken.id);
    expect(store.listActive()).toHaveLength(0);
    expect(store.countActive()).toBe(0);
  });

  it('should exclude expired tokens from active list', () => {
    store.store({
      ...sampleToken,
      expiresAt: new Date(Date.now() - 1000).toISOString(), // already expired
    });
    expect(store.listActive()).toHaveLength(0);
  });

  it('should return false for unknown token revocation check', () => {
    expect(store.isRevoked('unknown-id')).toBe(false);
  });
});
