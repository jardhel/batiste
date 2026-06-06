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
import { bold, cyan, fail, gray, green, kv, ok, section, yellow } from '../utils/output.js';

export function registerRetrieve(program: Command): void {
  program
    .command('retrieve')
    .description('RAG search against the local Firm Memory store')
    .argument('<query>', 'natural-language query')
    .option('-k, --limit <n>', 'top-K results to return', '5')
    .option('--vector-only', 'force semantic-only search (no lexical fallback)', false)
    .option('--prompts', 'search PromptStore instead of FactStore', false)
    .option('--min-score <n>', 'minimum hit score (0..1)', '0.05')
    .option('--json', 'machine-readable JSON output', false)
    .action(async (query: string, opts: {
      limit: string; vectorOnly: boolean; prompts: boolean; minScore: string; json: boolean;
    }) => {
      const paths = resolvePaths();
      await ensureFmRoot(paths);

      const fm = await openFirmMemory({ dataDir: paths.dataDir, namespace: paths.namespace });
      try {
        const limit = Math.max(1, Number.parseInt(opts.limit, 10) || 5);
        const minScore = Math.max(0, Number.parseFloat(opts.minScore) || 0);

        const store = opts.prompts ? fm.prompts : fm.facts;
        const hits = await store.search(query, {
          limit,
          minScore,
          vectorOnly: opts.vectorOnly,
        });

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
    });
}
