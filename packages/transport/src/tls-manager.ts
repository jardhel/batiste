/**
 * TLS Manager
 *
 * Loads custom TLS certificates for HTTPS.
 * For development, users can use self-signed certs generated externally.
 */

import { readFile } from 'node:fs/promises';
import type { TlsOptions } from 'node:tls';
import type { TlsConfig } from './types.js';

export class TlsManager {
  /**
   * Load TLS certificates from disk.
   * Throws if paths are missing when TLS is enabled.
   */
  static async loadCerts(config: TlsConfig): Promise<TlsOptions> {
    if (!config.certPath || !config.keyPath) {
      throw new Error('TLS enabled but certPath and keyPath are required');
    }

    const [cert, key] = await Promise.all([
      readFile(config.certPath, 'utf-8'),
      readFile(config.keyPath, 'utf-8'),
    ]);

    return { cert, key };
  }
}
