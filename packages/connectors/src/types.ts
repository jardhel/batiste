/**
 * Shared types for @batiste/connectors
 */

// ─── PDF ───────────────────────────────────────────────────────────────────

export interface PdfPage {
  pageNumber: number;
  text: string;
}

export interface PdfMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  creationDate?: string;
  modificationDate?: string;
}

export interface PdfParseResult {
  /** Full concatenated text of the document */
  text: string;
  /** Per-page text */
  pages: PdfPage[];
  /** Number of pages */
  pageCount: number;
  /** Document metadata */
  metadata: PdfMetadata;
  /** PDF version string */
  version: string;
  /** Estimated token count (chars / 4) */
  estimatedTokens: number;
}

export interface PdfParseOptions {
  /** Max pages to extract (default: all) */
  maxPages?: number;
  /** Include per-page breakdown (default: true) */
  includePages?: boolean;
}

// ─── CSV ───────────────────────────────────────────────────────────────────

export type CsvFieldType = 'string' | 'number' | 'boolean' | 'date' | 'empty';

export interface CsvFieldSchema {
  name: string;
  type: CsvFieldType;
  nullable: boolean;
  sampleValues: string[];
}

export interface CsvSchema {
  fields: CsvFieldSchema[];
  rowCount: number;
}

export type CsvRow = Record<string, string>;
export type CsvTypedRow = Record<string, string | number | boolean | null>;

export interface CsvParseOptions {
  /** Column delimiter (default: ',') */
  delimiter?: string;
  /** Whether first row is headers (default: true) */
  hasHeaders?: boolean;
  /** Max rows to parse (default: all) */
  maxRows?: number;
  /** Skip empty rows (default: true) */
  skipEmpty?: boolean;
}

export interface CsvQueryOptions extends CsvParseOptions {
  /** Columns to include (default: all) */
  columns?: string[];
  /** Simple equality filter: { field: value } */
  where?: Record<string, string>;
  /** Max rows to return after filtering */
  limit?: number;
}

export interface CsvColumnStats {
  column: string;
  count: number;
  nullCount: number;
  min: number | string;
  max: number | string;
  mean?: number;
  sum?: number;
}

export interface CsvEtlResult {
  schema: CsvSchema;
  rows: CsvTypedRow[];
  totalRows: number;
  returnedRows: number;
  truncated: boolean;
}
