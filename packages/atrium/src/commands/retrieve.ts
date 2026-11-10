/**
 * batiste-fm retrieve <query>
 *
 * RAG search against the local Firm Memory store. Prints top-K hits with
 * provenance (id, score, vault_ref). Default is hybrid (vector + lexical);
 * --vector-only forces semantic-only search.
 */

import type { Command } from 'commander';
import { openFirmMemory } from '@batiste-aidk/memory';
import { ensureFmRoot, resolvePaths } from '../utils/data-dir.js';
import { searchRanked } from '../utils/rank.js';
import { resolveQuery } from '../utils/query-input.js';
import { bold, cyan, fail, gray, green, kv, ok, section, yellow } from '../utils/output.js';

export interface RetrieveOpts {
  limit: string; vectorOnly: boolean; prompts: boolean; minScore: string; json: boolean; stdin: boolean;
}

/**
 * A query e variadica e opcional: `retrieve -- "- texto que comeca com hifen"`
 * (tudo apos `--` e texto) ou `printf %s "$prompt" | retrieve --stdin`.
 */
export function registerRetrieve(
  program: Command,
  handler: (query: string, opts: RetrieveOpts) => Promise<void> = runRetrieve,
): void {
  program
    .command('retrieve')
    .description('RAG search against the local Firm Memory store (query as args, after `--`, or via --stdin)')
    .argument('[query...]', 'natural-language query (use `--` before text starting with "-")')
    .option('--stdin', 'read the query from stdin', false)
    .option('-k, --limit <n>', 'top-K results to return', '5')
    .option('--vector-only', 'force semantic-only search (no lexical fallback)', false)
    .option('--prompts', 'search PromptStore instead of FactStore', false)
    .option('--min-score <n>', 'minimum hit score (0..1)', '0.05')
    .option('--json', 'machine-readable JSON output', false)
    .action(async (words: string[], opts: RetrieveOpts) => {
      const query = await resolveQuery({ words, stdin: opts.stdin, stdinIsTTY: Boolean(process.stdin.isTTY) });
      await handler(query, opts);
    });
}

async function runRetrieve(query: string, opts: RetrieveOpts): Promise<void> {
  const paths = resolvePaths();
  await ensureFmRoot(paths);

  const fm = await openFirmMemory({ dataDir: paths.dataDir, namespace: paths.namespace });
  try {
    const limit = Math.max(1, Number.parseInt(opts.limit, 10) || 5);
    const minScore = Math.max(0, Number.parseFloat(opts.minScore) || 0);

    // Facts: busca + peso de curadoria (vault/decisao vence observation). Prompts: busca direta.
    const hits = opts.prompts
      ? await fm.prompts.search(query, { limit, minScore, vectorOnly: opts.vectorOnly })
      : await searchRanked(fm.facts, query, { limit, minScore, vectorOnly: opts.vectorOnly });

    if (opts.json) {
      process.stdout.write(JSON.stringify({ query, namespace: paths.namespace, hits }, null, 2) + '\n');
      return;
    }

    section(`Firm Memory · ${opts.prompts ? 'PromptStore' : 'FactStore'}`);
    kv('Namespace', cyan(paths.namespace));
    kv('Query', bold(query));
    kv('Mode', opts.vectorOnly ? yellow('vector-only') : green('hybrid (vector + lexical)'));
    kv('Hits', String(hits.length));

    if (hits.length === 0) {
      fail('No results above min-score. Try a broader query or --min-score 0.');
      return;
    }

    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      if (!h) continue;
      const e = h.entry as { id: string; title: string; body: string; tags?: string[] };
      const reason = h.reason === 'vector' ? cyan('[vec]') : h.reason === 'lexical' ? yellow('[lex]') : green(`[${h.reason}]`);
      process.stdout.write(`\n  ${bold(`#${i + 1}`)}  ${reason}  ${gray(h.score.toFixed(3))}  ${green(e.id)}\n`);
      process.stdout.write(`  ${bold(e.title)}\n`);
      const preview = e.body.length > 240 ? e.body.slice(0, 240) + '…' : e.body;
      process.stdout.write(`  ${gray(preview.replace(/\n/g, ' '))}\n`);
      if (e.tags && e.tags.length > 0) {
        process.stdout.write(`  ${gray('tags:')} ${gray(e.tags.join(', '))}\n`);
      }
    }
    process.stdout.write('\n');
    ok('Retrieve complete.');
  } finally {
    await fm.close();
  }
}
