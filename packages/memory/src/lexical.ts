export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

export function lexicalScore(query: string, body: string, title: string, tags: string[]): number {
  const qTokens = new Set(tokenize(query));
  if (qTokens.size === 0) return 0;
  const titleTokens = new Set(tokenize(title));
  const bodyTokens = new Set(tokenize(body));
  const tagTokens = new Set(tags.flatMap((t) => tokenize(t)));

  let hits = 0;
  let titleHits = 0;
  let tagHits = 0;
  for (const q of qTokens) {
    if (titleTokens.has(q)) { hits++; titleHits++; }
    else if (bodyTokens.has(q)) { hits++; }
    if (tagTokens.has(q)) tagHits++;
  }
  const coverage = hits / qTokens.size;
  const titleBoost = titleHits / qTokens.size;
  const tagBoost = tagHits / qTokens.size;
  return coverage * 0.6 + titleBoost * 0.3 + tagBoost * 0.1;
}
