# @batiste-aidk/connectors

Proprietary data connectors for Batiste nodes. PDF extraction and CSV/ETL as first-class MCP tools — no SaaS, no data egress.

## Tools

| MCP Tool | Class | Description |
|---|---|---|
| `parse_pdf` | `PdfParser` | Extract text, page count, metadata, per-page breakdown |
| `query_csv` | `CsvEtl` | Filter, project, limit, type-infer CSV data |
| `csv_stats` | `CsvEtl` | min/max/mean/sum/nullCount per column |

## PDF Parser

```typescript
import { PdfParser } from '@batiste-aidk/connectors';

const parser = new PdfParser();

// From file
const result = await parser.parseFile('./contract.pdf', { includePages: true });
console.log(result.text);        // full extracted text
console.log(result.pageCount);   // number of pages
console.log(result.pages[0]);    // { pageNumber, text }
console.log(result.estimatedTokens); // rough LLM token count

// From buffer
const buf = await fs.readFile('./report.pdf');
const result2 = await parser.parseBuffer(buf, { maxPages: 5 });
```

## CSV ETL

```typescript
import { CsvEtl } from '@batiste-aidk/connectors';

const etl = new CsvEtl();

// Query from string
const result = etl.queryString(csvContent, {
  where: { city: 'Amsterdam' },   // equality filter
  columns: ['name', 'age'],       // projection
  limit: 100,                     // return limit
  delimiter: ',',                 // or '\t', ';'
});

console.log(result.rows);         // typed rows
console.log(result.schema);       // inferred types (string | number | boolean)
console.log(result.truncated);    // true if limit was hit

// Column statistics
const stats = etl.statsString(csvContent, 'price');
// { count, min, max, mean, sum, nullCount }

// From file
const fileResult = await etl.query('./data.csv', { maxRows: 10_000 });
```

## Type Inference

The CSV parser automatically infers column types from the data:

- `boolean` — values that parse as `true`/`false`
- `number` — values that parse as finite numbers
- `string` — everything else
- Nullable columns are detected when any row has an empty value

## MCP Integration

Wire the connectors into a Batiste node using `ConnectorHandler`:

```typescript
import { ConnectorHandler, CONNECTOR_TOOLS } from '@batiste-aidk/connectors';
import { createNode } from '@batiste-aidk/aidk';

const node = await createNode({
  config: { preset: 'network', port: 4002 },
  tools: CONNECTOR_TOOLS,
  handler: new ConnectorHandler(),
});
```
