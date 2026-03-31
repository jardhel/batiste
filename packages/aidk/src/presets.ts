/**
 * Presets
 *
 * Pre-built configurations for common deployment modes.
 */

import type { NodeConfig } from './types.js';

export interface ResolvedConfig {
  mode: 'stdio' | 'gateway';
  port: number;
  host: string;
  authEnabled: boolean;
  scopeEnabled: boolean;
  auditEnabled: boolean;
  killSwitchEnabled: boolean;
}

export function resolvePreset(config: NodeConfig): ResolvedConfig {
  switch (config.preset) {
    case 'local':
      return {
        mode: 'stdio',
        port: config.port ?? 3100,
        host: config.host ?? '127.0.0.1',
        authEnabled: false,
        scopeEnabled: false,
        auditEnabled: false,
        killSwitchEnabled: false,
      };

    case 'network':
      return {
        mode: 'gateway',
        port: config.port ?? 3100,
        host: config.host ?? '127.0.0.1',
        authEnabled: !!config.auth,
        scopeEnabled: !!config.scope,
        auditEnabled: !!config.audit,
        killSwitchEnabled: config.audit?.killSwitchEnabled ?? false,
      };

    case 'enterprise':
      return {
        mode: 'gateway',
        port: config.port ?? 3100,
        host: config.host ?? '127.0.0.1',
        authEnabled: !!config.auth,
        scopeEnabled: !!config.scope,
        auditEnabled: true,
        killSwitchEnabled: config.audit?.killSwitchEnabled ?? true,
      };
  }
}
