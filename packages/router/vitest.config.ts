import { defineConfig } from 'vitest/config';

/**
 * Per-package Vitest config. Scopes the include pattern to the local `src/`
 * tree so `pnpm --filter @batiste-aidk/router test` resolves in isolation
 * (the root config's workspace-relative globs only match from the repo root).
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/__tests__/**/*.test.ts'],
    testTimeout: 15_000,
  },
});
