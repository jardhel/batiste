/**
 * CsvEtl
 *
 * RFC 4180-compliant CSV parser with schema inference, filtering,
 * column projection, and numeric stats. Zero external dependencies.
 */

import { readFile } from 'fs/promises';
import type {
  CsvRow,
  CsvTypedRow,
  CsvFieldSchema,
  CsvFieldType,
  CsvSchema,
  CsvParseOptions,
  CsvQueryOptions,
  CsvColumnStats,
  CsvEtlResult,
} from '../types.js';

export class CsvEtl {
  /**
   * Parse a CSV file and run optional query (filter, project, limit).
   */
  async query(filePath: string, options: CsvQueryOptions = {}): Promise<CsvEtlResult> {
    const content = await readFile(filePath, 'utf-8');
    return this.queryString(content, options);
  }

  /**
   * Parse CSV from a raw string and run optional query.
   */
  queryString(content: string, options: CsvQueryOptions = {}): CsvEtlResult {
    const { columns, where, limit, ...parseOptions } = options;

    // 1. Parse raw rows
    let rows = this.parseContent(content, parseOptions);
    const totalRows = rows.length;

    // 2. Filter
    if (where && Object.keys(where).length > 0) {
      rows = rows.filter((row) =>
        Object.entries(where).every(([field, value]) => row[field] === value)
      );
    }

    // 3. Project columns
    if (columns && columns.length > 0) {
      rows = rows.map((row) => {
        const projected: CsvRow = {};
        for (const col of columns) {
          projected[col] = row[col] ?? '';
        }
        return projected;
      });
    }

    // 4. Infer schema from raw rows (before limit, for accuracy)
    const schema = this.inferSchema(rows);

    // 5. Coerce types
    const typedRows = rows.map((row) => this.coerceRow(row, schema));

    // 6. Limit
    const returnedRows = limit ? typedRows.slice(0, limit) : typedRows;

    return {
      schema,
      rows: returnedRows,
      totalRows,
      returnedRows: returnedRows.length,
      truncated: returnedRows.length < typedRows.length,
    };
  }

  /**
   * Compute stats for a specific column.
   */
  async stats(filePath: string, column: string, options: CsvParseOptions = {}): Promise<CsvColumnStats> {
    const content = await readFile(filePath, 'utf-8');
    return this.statsString(content, column, options);
  }

  statsString(content: string, column: string, options: CsvParseOptions = {}): CsvColumnStats {
    const rows = this.parseContent(content, options);
    const values = rows.map((r) => r[column] ?? '').filter((v) => v !== '');
    const nullCount = rows.length - values.length;

    const numbers = values.map(Number).filter((n) => !isNaN(n));
    const isNumeric = numbers.length === values.length && values.length > 0;

    if (isNumeric) {
      const sum = numbers.reduce((a, b) => a + b, 0);
      return {
        column,
        count: values.length,
        nullCount,
        min: Math.min(...numbers),
        max: Math.max(...numbers),
        mean: sum / numbers.length,
        sum,
      };
    }

    const sorted = [...values].sort();
    return {
      column,
      count: values.length,
      nullCount,
      min: sorted[0] ?? '',
      max: sorted[sorted.length - 1] ?? '',
    };
  }

  /**
   * Parse CSV content into raw string rows.
   */
  parseContent(content: string, options: CsvParseOptions = {}): CsvRow[] {
    const { delimiter = ',', hasHeaders = true, maxRows, skipEmpty = true } = options;

    const lines = this.splitLines(content);
    const rows: CsvRow[] = [];

    if (lines.length === 0) return rows;

    let headers: string[];
    let startIndex: number;

    if (hasHeaders) {
      headers = this.parseRow(lines[0] ?? '', delimiter);
      startIndex = 1;
    } else {
      const firstRow = this.parseRow(lines[0] ?? '', delimiter);
      headers = firstRow.map((_, i) => `col_${i}`);
      startIndex = 0;
    }

    for (let i = startIndex; i < lines.length; i++) {
      if (maxRows && rows.length >= maxRows) break;

      const line = lines[i] ?? '';
      if (skipEmpty && line.trim() === '') continue;

      const fields = this.parseRow(line, delimiter);
      const row: CsvRow = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j] ?? `col_${j}`] = fields[j] ?? '';
      }
      rows.push(row);
    }

    return rows;
  }

  /**
   * Infer field types from a set of rows.
   */
  inferSchema(rows: CsvRow[]): CsvSchema {
    if (rows.length === 0) return { fields: [], rowCount: 0 };

    const headers = Object.keys(rows[0] ?? {});
    const fields: CsvFieldSchema[] = headers.map((name) => {
      const values = rows.map((r) => r[name] ?? '');
      const nonEmpty = values.filter((v) => v !== '');
      const sampleValues = [...new Set(nonEmpty)].slice(0, 5);

      return {
        name,
        type: this.inferType(nonEmpty),
        nullable: nonEmpty.length < values.length,
        sampleValues,
      };
    });

    return { fields, rowCount: rows.length };
  }

  // ─── Private Helpers ────────────────────────────────────────────────────

  private splitLines(content: string): string[] {
    // Handle \r\n, \r, \n
    return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  }

  private parseRow(line: string, delimiter: string): string[] {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;
    let i = 0;

    while (i < line.length) {
      const ch = line[i];

      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          // Escaped quote
          current += '"';
          i += 2;
          continue;
        }
        inQuotes = !inQuotes;
        i++;
        continue;
      }

      if (ch === delimiter && !inQuotes) {
        fields.push(current);
        current = '';
        i++;
        continue;
      }

      current += ch;
      i++;
    }

    fields.push(current);
    return fields;
  }

  private inferType(values: string[]): CsvFieldType {
    if (values.length === 0) return 'empty';

    const checks = {
      boolean: (v: string) => /^(true|false|yes|no|1|0)$/i.test(v),
      number: (v: string) => !isNaN(Number(v)) && v.trim() !== '',
      date: (v: string) => !isNaN(Date.parse(v)) && /\d{2,4}[-/]\d{1,2}/.test(v),
    };

    if (values.every(checks.boolean)) return 'boolean';
    if (values.every(checks.number)) return 'number';
    if (values.every(checks.date)) return 'date';
    return 'string';
  }

  private coerceRow(row: CsvRow, schema: CsvSchema): CsvTypedRow {
    const typed: CsvTypedRow = {};
    for (const field of schema.fields) {
      const raw = row[field.name] ?? '';
      if (raw === '') {
        typed[field.name] = null;
        continue;
      }
      switch (field.type) {
        case 'number':
          typed[field.name] = Number(raw);
          break;
        case 'boolean':
          typed[field.name] = /^(true|yes|1)$/i.test(raw);
          break;
        default:
          typed[field.name] = raw;
      }
    }
    return typed;
  }
}
