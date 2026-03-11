import { describe, it, expect } from 'vitest';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PdfParser } from '../pdf/PdfParser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PDF = join(__dirname, 'fixtures', 'hello.pdf');

const parser = new PdfParser();

describe('PdfParser', () => {
  it('parses page count', async () => {
    const result = await parser.parseFile(FIXTURE_PDF);
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
  });

  it('extracts text content', async () => {
    const result = await parser.parseFile(FIXTURE_PDF);
    expect(result.text).toContain('Hello Batiste');
  });

  it('returns version string', async () => {
    const result = await parser.parseFile(FIXTURE_PDF);
    expect(typeof result.version).toBe('string');
    expect(result.version.length).toBeGreaterThan(0);
  });

  it('estimates token count', async () => {
    const result = await parser.parseFile(FIXTURE_PDF);
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });

  it('includes per-page breakdown when includePages=true', async () => {
    const result = await parser.parseFile(FIXTURE_PDF, { includePages: true });
    expect(result.pages.length).toBeGreaterThan(0);
    expect(result.pages[0]?.pageNumber).toBe(1);
  });

  it('skips page breakdown when includePages=false', async () => {
    const result = await parser.parseFile(FIXTURE_PDF, { includePages: false });
    expect(result.pages.length).toBe(0);
  });

  it('parses from buffer', async () => {
    const buf = await readFile(FIXTURE_PDF);
    const result = await parser.parseBuffer(buf);
    expect(result.text).toContain('Hello Batiste');
  });

  it('respects maxPages option', async () => {
    const result = await parser.parseFile(FIXTURE_PDF, { maxPages: 1 });
    expect(result.pageCount).toBe(1);
  });
});
