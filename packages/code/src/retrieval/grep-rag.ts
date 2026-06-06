/**
 * GrepRAG post-processing — pure, model-free retrieval refinements.
 *
 * Two operations from "GrepRAG" (arXiv 2601.23254v2), applied to raw lexical
 * search hits before they are handed to a model:
 *
 *   1. {@link mergeOverlappingHits} — line-interval dedup. ripgrep emits one
 *      hit per matching line, so a single function can surface as a dozen
 *      overlapping snippets that re-send the same code. Merging by line range
 *      collapses them to one, which is where most of the token waste hides.
 *   2. {@link rerankByBm25} — identifier-weighted BM25. Plain BM25 treats
 *      `for` and `parseLedgerEntry` equally; in code the identifier carries the
 *      signal, so identifier tokens get a weight boost.
 *
 * Both are deterministic and require no embedding model — they are cheap
 * post-processing, not a new index.
 */

export interface RetrievalHit {
  filePath: string;
  /** 1-indexed inclusive. */
  startLine: number;
  /** 1-indexed inclusive. */
  endLine: number;
  text: string;
  /** Optional upstream score; preserved through merge (max wins). */
  score?: number;
}

/**
 * Merge hits in the same file whose line ranges overlap or sit within `gap`
 * lines of each other. The merged hit spans the union range; its text is
 * rebuilt from `fileLines` when provided (so the gap between two near hits is
 * filled in), otherwise the longer of the two source texts is kept. Score, if
 * present, is the max of the merged inputs.
 *
 * @param hits      Raw hits, any order.
 * @param fileLines Map of filePath → full file lines (1-indexed via [i-1]).
 *                  Optional; enables exact text reconstruction.
 * @param gap       Max line distance to still merge (default 1 = touching).
 */
export function mergeOverlappingHits(
  hits: RetrievalHit[],
  fileLines: Map<string, string[]> = new Map(),
  gap = 1,
): RetrievalHit[] {
  const byFile = new Map<string, RetrievalHit[]>();
  for (const h of hits) {
    const list = byFile.get(h.filePath) ?? [];
    list.push(h);
    byFile.set(h.filePath, list);
  }

  const out: RetrievalHit[] = [];
  for (const [filePath, group] of byFile) {
    group.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
    const lines = fileLines.get(filePath);
    let cur: RetrievalHit | null = null;

    for (const h of group) {
      if (cur && h.startLine <= cur.endLine + gap) {
        // Overlap or within gap → extend the current merged hit.
        cur.endLine = Math.max(cur.endLine, h.endLine);
        cur.score = mergeScore(cur.score, h.score);
        if (!lines) cur.text = cur.text.length >= h.text.length ? cur.text : h.text;
      } else {
        if (cur) out.push(finalizeText(cur, lines));
        cur = { ...h };
      }
    }
    if (cur) out.push(finalizeText(cur, lines));
  }
  return out;
}

function mergeScore(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

function finalizeText(hit: RetrievalHit, lines: string[] | undefined): RetrievalHit {
  if (lines) hit.text = lines.slice(hit.startLine - 1, hit.endLine).join('\n');
  return hit;
}

export interface Bm25Options {
  k1?: number;
  b?: number;
  /** Multiplier applied to query terms that look like code identifiers. */
  identifierWeight?: number;
}

const DEFAULT_K1 = 1.2;
const DEFAULT_B = 0.75;
const DEFAULT_ID_WEIGHT = 2.0;

/** Split text into lowercase tokens, also exploding camelCase / snake_case identifiers into parts. */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const raw of text.match(/[A-Za-z0-9_$]+/g) ?? []) {
    tokens.push(raw.toLowerCase());
    // Explode compound identifiers so `parseLedgerEntry` also matches `ledger`.
    const parts = raw
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_$]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p.toLowerCase());
    if (parts.length > 1) tokens.push(...parts);
  }
  return tokens;
}

/** A query term is "identifier-like" if it carries a code-shaped boundary (camel/snake/digits). */
function looksLikeIdentifier(term: string): boolean {
  return /[_$]/.test(term) || /[a-z][A-Z]/.test(term) || /\d/.test(term) || term.length >= 4;
}

/**
 * Re-rank hits by identifier-weighted BM25 against `query`. Returns a new array
 * sorted by descending score; each hit's `score` is set to its BM25 value.
 * Pure function — does not mutate the inputs.
 */
export function rerankByBm25(
  query: string,
  hits: RetrievalHit[],
  opts: Bm25Options = {},
): RetrievalHit[] {
  const k1 = opts.k1 ?? DEFAULT_K1;
  const b = opts.b ?? DEFAULT_B;
  const idWeight = opts.identifierWeight ?? DEFAULT_ID_WEIGHT;
  if (hits.length === 0) return [];

  const docs = hits.map((h) => tokenize(h.text));
  const docLens = docs.map((d) => d.length);
  const avgdl = docLens.reduce((a, c) => a + c, 0) / docs.length || 1;

  // Document frequency per term.
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const term of new Set(doc)) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const N = docs.length;

  // Weighted query terms (de-duplicated, identifier terms boosted).
  const qTerms = new Map<string, number>();
  for (const term of new Set(tokenize(query))) {
    qTerms.set(term, looksLikeIdentifier(term) ? idWeight : 1);
  }

  const scored = hits.map((hit, i) => {
    const doc = docs[i]!;
    const dl = docLens[i]!;
    const tf = new Map<string, number>();
    for (const term of doc) tf.set(term, (tf.get(term) ?? 0) + 1);

    let score = 0;
    for (const [term, weight] of qTerms) {
      const f = tf.get(term);
      if (!f) continue;
      const n = df.get(term) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const denom = f + k1 * (1 - b + (b * dl) / avgdl);
      score += weight * idf * ((f * (k1 + 1)) / denom);
    }
    return { hit: { ...hit, score }, score };
  });

  return scored.sort((a, b2) => b2.score - a.score).map((s) => s.hit);
}
