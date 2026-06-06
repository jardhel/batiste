/**
 * Phase 2a integration test — registry → strategy → symbol extraction
 * round-trip via the public {@link TreeSitterAdapter} surface.
 *
 * Asserts the contract Phase 2b's graph builder relies on: every
 * default language can parse a small sample, surface at least one
 * symbol and one import, and report the correct `language` field.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdir, rm, writeFile } from 'fs/promises';
import { TreeSitterAdapter } from '../parsers/TreeSitterAdapter.js';
import { DEFAULT_STRATEGIES } from '../parsers/strategies/index.js';

interface Sample {
  language: string;
  ext: string;
  source: string;
}

const SAMPLES: Sample[] = [
  {
    language: 'typescript',
    ext: '.ts',
    source: `
      import { foo } from './bar.js';
      export function main(): string { return foo(); }
    `,
  },
  {
    language: 'python',
    ext: '.py',
    source: `
import os
def main():
    return os.getcwd()
`,
  },
  {
    language: 'javascript',
    ext: '.js',
    source: `
      import { foo } from './bar.js';
      function main() { return foo(); }
    `,
  },
  {
    language: 'go',
    ext: '.go',
    source: `
      package main
      import "fmt"
      func main() { fmt.Println("hi") }
    `,
  },
  {
    language: 'rust',
    ext: '.rs',
    source: `
      use std::io;
      fn main() { let _ = io::stdin(); }
    `,
  },
];

describe('Phase 2a · parsers integration', () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = join(
      tmpdir(),
      `parsers-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('exposes every default strategy via the adapter', () => {
    const adapter = new TreeSitterAdapter();
    const langs = adapter.getSupportedLanguages();
    for (const strategy of DEFAULT_STRATEGIES) {
      expect(langs).toContain(strategy.name);
    }
  });

  it('exposes every default extension via the adapter', () => {
    const adapter = new TreeSitterAdapter();
    const exts = adapter.getSupportedExtensions();
    for (const strategy of DEFAULT_STRATEGIES) {
      for (const ext of strategy.extensions) {
        expect(exts).toContain(ext.toLowerCase());
      }
    }
  });

  for (const sample of SAMPLES) {
    it(`round-trips a ${sample.language} sample through registry → strategy`, async () => {
      const adapter = new TreeSitterAdapter();
      const filePath = join(testDir, `sample${sample.ext}`);
      await writeFile(filePath, sample.source);

      const result = await adapter.parseFile(filePath);
      expect(result.language).toBe(sample.language);
      expect(result.errors.filter((e) => !e.startsWith('Parse tree contains errors'))).toHaveLength(
        0
      );
      expect(result.symbols.length).toBeGreaterThan(0);
      expect(result.imports.length).toBeGreaterThan(0);
    });
  }

  it('resolves a strategy by name through the adapter', () => {
    const adapter = new TreeSitterAdapter();
    expect(adapter.getStrategyForName('go')?.languageId).toBe('go');
    expect(adapter.getStrategyForName('rust')?.languageId).toBe('rust');
    expect(adapter.getStrategyForName('nonexistent')).toBeNull();
  });

  it('exposes the underlying registry to Phase 2b consumers', () => {
    const adapter = new TreeSitterAdapter();
    const registry = adapter.getRegistry();
    expect(registry.forName('typescript')?.name).toBe('typescript');
    expect(registry.forFile('/tmp/x.go')?.name).toBe('go');
  });
});

