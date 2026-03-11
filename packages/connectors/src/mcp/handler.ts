/**
 * MCP Tool Handler for @batiste/connectors
 */

import { join } from 'path';
import { PdfParser } from '../pdf/PdfParser.js';
import { CsvEtl } from '../csv/CsvEtl.js';
import type { ConnectorToolName } from './tools.js';

export class ConnectorHandler {
  private projectRoot: string;
  private pdfParser = new PdfParser();
  private csvEtl = new CsvEtl();

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  async handleTool(name: ConnectorToolName, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'parse_pdf': return this.parsePdf(args);
      case 'query_csv': return this.queryCsv(args);
      case 'csv_stats': return this.csvStats(args);
      default: throw new Error(`Unknown connector tool: ${name}`);
    }
  }

  private resolvePath(p: string): string {
    return p.startsWith('/') ? p : join(this.projectRoot, p);
  }

  private async parsePdf(args: Record<string, unknown>): Promise<unknown> {
    const filePath = this.resolvePath(args.filePath as string);
    const maxPages = args.maxPages as number | undefined;
    const includePages = (args.includePages as boolean | undefined) ?? true;

    const result = await this.pdfParser.parseFile(filePath, { maxPages, includePages });

    return {
      pageCount: result.pageCount,
      estimatedTokens: result.estimatedTokens,
      metadata: result.metadata,
      version: result.version,
      // Truncate text for context safety
      text: result.text.slice(0, 8000),
      textTruncated: result.text.length > 8000,
      pages: includePages
        ? result.pages.map((p) => ({
            pageNumber: p.pageNumber,
            text: p.text.slice(0, 2000),
            truncated: p.text.length > 2000,
          }))
        : undefined,
    };
  }

  private async queryCsv(args: Record<string, unknown>): Promise<unknown> {
    const filePath = this.resolvePath(args.filePath as string);
    const limit = (args.limit as number | undefined) ?? 100;

    const result = await this.csvEtl.query(filePath, {
      delimiter: args.delimiter as string | undefined,
      columns: args.columns as string[] | undefined,
      where: args.where as Record<string, string> | undefined,
      hasHeaders: (args.hasHeaders as boolean | undefined) ?? true,
      limit,
    });

    return {
      schema: result.schema,
      rows: result.rows,
      totalRows: result.totalRows,
      returnedRows: result.returnedRows,
      truncated: result.truncated,
      hint: result.truncated
        ? `Showing ${result.returnedRows} of ${result.totalRows} rows. Use limit/where to narrow results.`
        : undefined,
    };
  }

  private async csvStats(args: Record<string, unknown>): Promise<unknown> {
    const filePath = this.resolvePath(args.filePath as string);
    const column = args.column as string;

    return this.csvEtl.stats(filePath, column, {
      delimiter: args.delimiter as string | undefined,
    });
  }

  close(): void {
    // stateless
  }
}
