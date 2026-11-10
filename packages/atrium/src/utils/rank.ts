/**
 * Re-ranking do retrieve: fato curado vence fragmento de conversa.
 *
 * O FM devolve score cru (vetorial 1/(1+d) ou lexical 0..1). Fichas e
 * decisoes do vault sao fatos curados; 'observation' e fragmento de sessao.
 * O peso e multiplicativo e aplicado depois da busca.
 */

import type { FactEntry, SearchHit, SearchOptions } from '@batiste-aidk/memory';

export const WEIGHT_VAULT = 1.6;
export const WEIGHT_CURATED = 1.15;
export const WEIGHT_OBSERVATION = 1.0;

export function curationWeight(entry: Pick<FactEntry, 'kind' | 'tags'>): number {
  if (entry.tags.includes('source:vault')) return WEIGHT_VAULT;
  if (entry.kind === 'observation') return WEIGHT_OBSERVATION;
  return WEIGHT_CURATED;
}

export function rerank(hits: Array<SearchHit<FactEntry>>, limit: number): Array<SearchHit<FactEntry>> {
  const byId = new Map<string, SearchHit<FactEntry>>();
  for (const h of hits) {
    const boosted = { ...h, score: h.score * curationWeight(h.entry) };
    const prev = byId.get(h.entry.id);
    if (!prev || boosted.score > prev.score) byId.set(h.entry.id, boosted);
  }
  return [...byId.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

interface FactSearcher {
  search(query: string, options?: SearchOptions): Promise<Array<SearchHit<FactEntry>>>;
}

/**
 * Busca geral + buscas por kind curado ('precedent' e 'decision'). O FM faz a
 * varredura lexical so em um subconjunto limitado das linhas; filtrar por kind
 * no SQL garante que TODAS as fichas e decisoes entram no lexical mesmo com
 * dezenas de milhares de observations no indice.
 */
export async function searchRanked(
  store: FactSearcher,
  query: string,
  opts: { limit: number; minScore: number; vectorOnly?: boolean },
): Promise<Array<SearchHit<FactEntry>>> {
  const wide = Math.max(opts.limit * 4, 20);
  // minScore 0 na busca (o corte vale depois do peso, no score final).
  const base = { limit: wide, minScore: 0, vectorOnly: opts.vectorOnly };
  const [general, precedents, decisions] = await Promise.all([
    store.search(query, base),
    store.search(query, { ...base, kind: 'precedent' }),
    store.search(query, { ...base, kind: 'decision' }),
  ]);
  return rerank([...general, ...precedents, ...decisions], Number.MAX_SAFE_INTEGER)
    .filter((h) => h.score >= opts.minScore)
    .slice(0, opts.limit);
}
