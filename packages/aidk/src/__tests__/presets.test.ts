import { describe, it, expect } from 'vitest';
import { resolvePreset } from '../presets.js';
import { NodeConfigSchema } from '../types.js';

describe('resolvePreset', () => {
  it('should resolve local preset', () => {
    const config = NodeConfigSchema.parse({ preset: 'local' });
    const resolved = resolvePreset(config);
    expect(resolved.mode).toBe('stdio');
    expect(resolved.authEnabled).toBe(false);
    expect(resolved.scopeEnabled).toBe(false);
    expect(resolved.auditEnabled).toBe(false);
    expect(resolved.killSwitchEnabled).toBe(false);
  });

  it('should resolve network preset', () => {
    const config = NodeConfigSchema.parse({
      preset: 'network',
      port: 8080,
      auth: { secretKey: 'a-secret-key-that-is-at-least-32-characters' },
      audit: {},
    });
    const resolved = resolvePreset(config);
    expect(resolved.mode).toBe('gateway');
    expect(resolved.port).toBe(8080);
    expect(resolved.authEnabled).toBe(true);
    expect(resolved.auditEnabled).toBe(true);
    expect(resolved.scopeEnabled).toBe(false);
  });

  it('should resolve enterprise preset', () => {
    const config = NodeConfigSchema.parse({
      preset: 'enterprise',
      auth: { secretKey: 'a-secret-key-that-is-at-least-32-characters' },
      scope: { defaultPolicy: 'read-only' },
      audit: { killSwitchEnabled: true },
    });
    const resolved = resolvePreset(config);
    expect(resolved.mode).toBe('gateway');
    expect(resolved.authEnabled).toBe(true);
    expect(resolved.scopeEnabled).toBe(true);
    expect(resolved.auditEnabled).toBe(true);
    expect(resolved.killSwitchEnabled).toBe(true);
  });

  it('should use default port 3100', () => {
    const config = NodeConfigSchema.parse({ preset: 'network' });
    expect(resolvePreset(config).port).toBe(3100);
  });

  it('should use default host 127.0.0.1', () => {
    const config = NodeConfigSchema.parse({ preset: 'network' });
    expect(resolvePreset(config).host).toBe('127.0.0.1');
  });
});
