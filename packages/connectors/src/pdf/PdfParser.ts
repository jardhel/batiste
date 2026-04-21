/**
 * PdfParser
 *
 * Extracts text, per-page content, and metadata from PDF files using
 * Mozilla's `pdfjs-dist` — the same engine that ships inside Firefox.
 *
 * Why pdfjs-dist (E3-B08):
 *   - `pdf-parse` (the previous backend) has not received a release
 *     since 2018 and bundles an old `pdf.js` fork with known advisories.
 *     Dropping it removes an unmaintained, security-sensitive
 *     dependency from the supply chain.
 *   - `pdfjs-dist` is actively maintained, has prompt CVE releases,
 *     ships an ESM entrypoint, and exposes a clean page-level API
 *     that matches the shape we need without monkey-patching.
 *
 * Compliance: SOC 2 CC7.1 (monitoring for vulnerabilities), ISO 27001
 * A.8.8 (management of technical vulnerabilities), NIS2 Art. 21(2)(e)
 * (supply-chain security), DORA Art. 28 (ICT third-party risk).
 */

import { readFile } from 'fs/promises';
import type { PdfParseResult, PdfParseOptions, PdfMetadata } from '../types.js';

// `pdfjs-dist/legacy/build/pdf.mjs` is the ESM, Node-friendly build.
// We import it dynamically so consumers who only use the CSV connector
// never pay the cost of loading the PDF engine.
type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let _pdfjs: PdfJs | undefined;
async function loadPdfJs(): Promise<PdfJs> {
  if (_pdfjs) return _pdfjs;
  _pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as PdfJs;
  // Disable the worker — we run in Node and the main-thread build is fine
  // for our file sizes. Keeping a separate worker would add a fork and an
  // additional trusted-code boundary for no meaningful latency win.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (_pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc = '';
  return _pdfjs;
}

export class PdfParser {
  /** Parse a PDF from a file path. */
  async parseFile(filePath: string, options: PdfParseOptions = {}): Promise<PdfParseResult> {
    const buffer = await readFile(filePath);
    return this.parseBuffer(buffer, options);
  }

  /** Parse a PDF from a Buffer. */
  async parseBuffer(buffer: Buffer, options: PdfParseOptions = {}): Promise<PdfParseResult> {
    const { maxPages, includePages = true } = options;
    const pdfjs = await loadPdfJs();

    // pdfjs expects a Uint8Array view; we avoid a copy by taking a subarray
    // on the underlying ArrayBuffer.
    const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    // `isEvalSupported: false` disables runtime eval() inside the parser —
    // belt-and-braces for a library that handles untrusted input.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = await (pdfjs as any).getDocument({
      data,
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
    }).promise;

    const pageCount: number = doc.numPages;
    const effectiveMax = typeof maxPages === 'number' && maxPages > 0
      ? Math.min(maxPages, pageCount)
      : pageCount;

    const pageTexts: string[] = [];
    for (let i = 1; i <= effectiveMax; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = (content.items as Array<{ str?: string }>)
        .map((it) => it.str ?? '')
        .join(' ')
        .trim();
      pageTexts.push(text);
      // Release page-level buffers as we go so large PDFs do not pin
      // megabytes of canvas state in memory.
      page.cleanup();
    }

    const fullText = pageTexts.join('\n\n').trim();
    const rawMeta = await doc.getMetadata().catch(() => ({ info: {}, metadata: null }));
    const info = (rawMeta.info ?? {}) as Record<string, unknown>;

    // Release the document before returning.
    await doc.cleanup();
    await doc.destroy();

    const pages = includePages
      ? pageTexts.map((text, i) => ({ pageNumber: i + 1, text }))
      : [];

    return {
      text: fullText,
      pages,
      pageCount,
      metadata: this.extractMetadata(info),
      version: typeof info['PDFFormatVersion'] === 'string' ? (info['PDFFormatVersion'] as string) : 'unknown',
      estimatedTokens: Math.ceil(fullText.length / 4),
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
