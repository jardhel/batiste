import { defineConfig } from 'vitest/config';

/**
 * Root Vitest config — coverage is enforced at the workspace root so CI
 * fails fast when any package drops below threshold.
 *
 * Per-package vitest configs inherit nothing from this file (Vitest does
 * not merge configs across workspaces). Instead, CI runs `pnpm -r test
 * --coverage` and aggregates reports from each package's `coverage/`
 * directory. This root config is the authoritative set of thresholds
 * that each package config mirrors.
 *
 * Reference: compliance/policies/change-management-policy.md — release
 * gate requires coverage ≥ 80% lines / 75% branches.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts', 'packages/*/__tests__/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.d.ts',
      'examples/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov', 'html'],
      reportsDirectory: './coverage',
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/*.d.ts',
        '**/*.test.ts',
        '**/__tests__/**',
        '**/index.ts',
      ],
      thresholds: {
        lines: 80,
        branches: 75,
        functions: 80,
        statements: 80,
      },
      all: true,
      clean: true,
    },
  },
});
