import { defineConfig } from 'vitest/config';

/**
 * Per-package Vitest config.
 *
 * The root `vitest.config.ts` uses workspace-relative globs (e.g.
 * `packages/*\/src/**\/*.test.ts`) which only resolve when vitest runs
 * from the repo root. When `pnpm --filter @batiste-aidk/scope test`
 * spawns vitest in this package's cwd, those globs find nothing. This
 * file scopes the include pattern to the local `src/` tree so package-
 * level filters work in isolation. Coverage is still aggregated at the
 * root by CI.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/__tests__/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
