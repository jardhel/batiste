/**
 * PdfParser
 *
 * Extracts text, per-page content, and metadata from PDF files.
 * Uses pdf-parse under the hood with a createRequire shim for ESM compat.
 */

import { createRequire } from 'module';
import { readFile } from 'fs/promises';
import type { PdfParseResult, PdfParseOptions, PdfMetadata } from '../types.js';

const require = createRequire(import.meta.url);

interface PdfParseRawResult {
  numpages: number;
  info: Record<string, unknown>;
  text: string;
  version: string;
}

type PdfParseFunction = (
  dataBuffer: Buffer,
  options?: { max?: number; pagerender?: (pageData: { getTextContent: () => Promise<{ items: Array<{ str: string }> }> }, pageNum: number) => string }
) => Promise<PdfParseRawResult>;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse: PdfParseFunction = require('pdf-parse');

export class PdfParser {
  /**
   * Parse a PDF from a file path.
   */
  async parseFile(filePath: string, options: PdfParseOptions = {}): Promise<PdfParseResult> {
    const buffer = await readFile(filePath);
    return this.parseBuffer(buffer, options);
  }

  /**
   * Parse a PDF from a Buffer.
   */
  async parseBuffer(buffer: Buffer, options: PdfParseOptions = {}): Promise<PdfParseResult> {
    const { maxPages, includePages = true } = options;

    const pages: Array<{ pageNumber: number; text: string }> = [];
    let pageIndex = 0;

    const pageTexts: string[] = [];

    const parseOptions: Parameters<PdfParseFunction>[1] = {
      max: maxPages,
      pagerender: (pageData) => {
        return pageData
          .getTextContent()
          .then((textContent) => {
            const text = textContent.items.map((item) => item.str).join(' ');
            pageTexts.push(text);
            return text;
          })
          .then((text) => {
            void pageIndex;
            return text;
          }) as unknown as string;
      },
    };

    const raw = await pdfParse(buffer, includePages ? parseOptions : { max: maxPages });

    // Build per-page breakdown from collected texts
    if (includePages && pageTexts.length > 0) {
      pageTexts.forEach((text, i) => {
        pages.push({ pageNumber: i + 1, text: text.trim() });
      });
    } else if (includePages) {
      // Fallback: split full text by form-feed characters (common PDF page separator)
      const chunks = raw.text.split('\f').filter((c) => c.trim().length > 0);
      chunks.forEach((chunk, i) => {
        if (!maxPages || i < maxPages) {
          pages.push({ pageNumber: i + 1, text: chunk.trim() });
        }
      });
    }

    const metadata = this.extractMetadata(raw.info);
    const text = raw.text.trim();

    return {
      text,
      pages,
      pageCount: raw.numpages,
      metadata,
      version: raw.version,
      estimatedTokens: Math.ceil(text.length / 4),
    };
  }

  private extractMetadata(info: Record<string, unknown>): PdfMetadata {
    const str = (v: unknown): string | undefined =>
      typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;

    return {
      title: str(info['Title']),
      author: str(info['Author']),
      subject: str(info['Subject']),
      keywords: str(info['Keywords']),
      creator: str(info['Creator']),
      producer: str(info['Producer']),
      creationDate: str(info['CreationDate']),
      modificationDate: str(info['ModDate']),
    };
  }
}
