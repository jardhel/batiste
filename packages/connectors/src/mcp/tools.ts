/**
 * MCP tool definitions for @batiste-aidk/connectors
 */

export const CONNECTOR_TOOLS = [
  {
    name: 'parse_pdf' as const,
    description:
      'Extract text, per-page content, and metadata from a PDF file. Returns structured document data suitable for AI processing.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute or project-relative path to the PDF file',
        },
        maxPages: {
          type: 'number',
          description: 'Maximum number of pages to extract (default: all)',
        },
        includePages: {
          type: 'boolean',
          description: 'Include per-page text breakdown (default: true)',
        },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'query_csv' as const,
    description:
      'Parse a CSV file and run a query: filter rows, project columns, infer schema, and compute stats. Returns typed rows and schema.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute or project-relative path to the CSV file',
        },
        delimiter: {
          type: 'string',
          description: 'Column delimiter (default: ",")',
        },
        columns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Columns to include (default: all)',
        },
        where: {
          type: 'object',
          description: 'Equality filters as { field: value }',
          additionalProperties: { type: 'string' },
        },
        limit: {
          type: 'number',
          description: 'Max rows to return (default: 100)',
        },
        hasHeaders: {
          type: 'boolean',
          description: 'Whether the first row contains headers (default: true)',
        },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'csv_stats' as const,
    description: 'Compute statistics for a specific column in a CSV file: min, max, mean, sum, null count.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute or project-relative path to the CSV file',
        },
        column: {
          type: 'string',
          description: 'Column name to compute stats for',
        },
        delimiter: {
          type: 'string',
          description: 'Column delimiter (default: ",")',
        },
      },
      required: ['filePath', 'column'],
    },
  },
] as const;

export type ConnectorToolName = (typeof CONNECTOR_TOOLS)[number]['name'];
