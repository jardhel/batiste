/**
 * @batiste/connectors
 *
 * Proprietary connectors for Batiste nodes.
 * Built-in parsers for PDFs and CSV data lakes.
 *
 * @dogfood Built using @batiste/code analysis and validation tooling.
 */

export { PdfParser } from './pdf/PdfParser.js';
export { CsvEtl } from './csv/CsvEtl.js';
export { ConnectorHandler } from './mcp/handler.js';
export { CONNECTOR_TOOLS } from './mcp/tools.js';
export type { ConnectorToolName } from './mcp/tools.js';
export type {
  PdfParseResult,
  PdfParseOptions,
  PdfMetadata,
  PdfPage,
  CsvRow,
  CsvTypedRow,
  CsvFieldSchema,
  CsvFieldType,
  CsvSchema,
  CsvParseOptions,
  CsvQueryOptions,
  CsvColumnStats,
  CsvEtlResult,
} from './types.js';
