/**
 * Vault note -> FactEntry projection (puro, sem I/O de FM).
 *
 * O vault Obsidian da casa e a fonte da verdade curada. Aqui cada nota de
 * 05 Memory (fichas), 04 Decision e 02 Policy vira um FactEntry com
 * sensibilidade mapeada do frontmatter, workstream do projeto e um id estavel
 * por caminho. A identidade de conteudo e o hash do arquivo (tag `sha:`):
 * reingestao sem mudanca e no-op; nota alterada substitui a anterior (mesmo id).
 */

import { basename } from 'node:path';
import type { FactEntry } from '@batiste-aidk/memory';
import { parseFrontmatter } from './frontmatter.js';
import { sha256, shortHash } from './hash.js';
import { scrub } from './scrub.js';

export type Sensitivity = FactEntry['sensitivity'];

/** Pastas do vault indexadas e como cada uma vira fato. */
export const VAULT_SOURCES = [
  { dir: '05 Memory', kind: 'precedent', label: 'ficha' },
  { dir: '04 Decision', kind: 'decision', label: 'decision' },
  { dir: '02 Policy', kind: 'decision', label: 'policy' },
] as const satisfies ReadonlyArray<{ dir: string; kind: FactEntry['kind']; label: string }>;

export const VAULT_SOURCE_TAG = 'source:vault';
export const SHA_TAG_PREFIX = 'sha:';

const ORDER: Sensitivity[] = ['public', 'internal', 'confidential', 'confidential-nda', 'privileged'];

/** Tiers de sensibilidade da casa (T0/T1/T2) -> enum real do FM. T2 (restrito) = 'privileged'. */
export function tierToSensitivity(tier: string | undefined): Sensitivity | undefined {
  switch ((tier ?? '').trim().toUpperCase()) {
    case 'T0': return 'internal';
    case 'T1': return 'confidential';
    case 'T2': return 'privileged';
    default: return undefined;
  }
}

/** Valor de `classification` do frontmatter/tag -> enum do FM. */
export function classificationToSensitivity(raw: string | undefined): Sensitivity | undefined {
  const v = (raw ?? '').trim().toLowerCase();
  if (!v) return undefined;
  if (v === 'public') return 'public';
  if (v === 'internal') return 'internal';
  if (v === 'confidential') return 'confidential';
  if (v === 'confidential-nda') return 'confidential-nda';
  if (v === 'privileged' || v === 'restricted' || v.startsWith('pii-restricted')) return 'privileged';
  return undefined;
}

function stricter(a: Sensitivity | undefined, b: Sensitivity | undefined): Sensitivity | undefined {
  if (!a) return b;
  if (!b) return a;
  return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
}

/** Remove comentario inline (` # ...`) e aspas de um valor escalar de frontmatter. */
function cleanScalar(v: string | undefined): string {
  let s = (v ?? '').replace(/\s+#.*$/, '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1);
  return s.trim();
}

function parseInlineList(v: string | undefined): string[] {
  const s = (v ?? '').trim();
  if (!s.startsWith('[') || !s.endsWith(']')) return [];
  return s.slice(1, -1).split(',').map((t) => cleanScalar(t)).filter(Boolean);
}

/**
 * Sensibilidade de uma nota. Vale a mais estrita entre `tier_default` e
 * `classification` (frontmatter ou tag `classification/x`). Sem nenhum dos dois,
 * 'confidential' (default seguro do FM).
 */
export function resolveSensitivity(meta: Record<string, string>): Sensitivity {
  const tags = parseInlineList(meta.tags);
  const tagClass = tags.find((t) => t.toLowerCase().startsWith('classification/'))?.slice('classification/'.length);
  const fromTier = tierToSensitivity(cleanScalar(meta.tier_default) || cleanScalar(meta.tier));
  const fromClass = classificationToSensitivity(cleanScalar(meta.classification)) ?? classificationToSensitivity(tagClass);
  return stricter(fromTier, fromClass) ?? 'confidential';
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Projeto da nota: `workstream` do frontmatter; senao o prefixo do titulo antes
 * de " — " (so quando ha separador e o prefixo nao e data); senao 'casa'.
 */
export function resolveWorkstream(meta: Record<string, string>, title: string): string {
  const ws = cleanScalar(meta.workstream);
  if (ws) return ws;
  const parts = title.split(/\s[—–]\s/);
  const head = parts.length > 1 ? slug(parts[0] ?? '') : '';
  return head && !/^\d/.test(head) ? head : 'casa';
}

export function vaultFactId(relPath: string): string {
  return `vault-${shortHash(relPath)}`;
}

export interface VaultNote {
  /** Caminho relativo ao vault, com '/' (ex.: '05 Memory/Hefesto — ....md'). */
  relPath: string;
  raw: string;
}

/** Projeta uma nota em FactEntry; retorna undefined se o caminho nao pertence a uma fonte indexada. */
export function noteToFact(note: VaultNote, nowIso: string = new Date().toISOString()): FactEntry | undefined {
  const source = VAULT_SOURCES.find((s) => note.relPath.startsWith(`${s.dir}/`));
  if (!source) return undefined;
  const { meta, body } = parseFrontmatter(note.raw);
  const fileTitle = basename(note.relPath, '.md');
  const title = cleanScalar(meta.title) || fileTitle;
  const { text } = scrub(body.trim() || title);
  const extraTags = parseInlineList(meta.tags);
  const tags = [
    'vault',
    source.label === 'ficha' ? 'ficha' : source.label,
    VAULT_SOURCE_TAG,
    `axis:${source.label === 'ficha' ? 'memory' : source.label === 'policy' ? 'policy' : 'decision'}`,
    `${SHA_TAG_PREFIX}${sha256(note.raw).slice(0, 16)}`,
    ...extraTags.filter((t) => t.startsWith('workstream/')),
  ];
  return {
    id: vaultFactId(note.relPath),
    kind: source.kind,
    title,
    body: text,
    workstream: resolveWorkstream(meta, title),
    sensitivity: resolveSensitivity(meta),
    tags: [...new Set(tags)],
    vault_ref: note.relPath,
    created_at: cleanScalar(meta.updated) || nowIso,
    updated_at: nowIso,
  };
}

export function shaOf(entry: Pick<FactEntry, 'tags'>): string | undefined {
  return entry.tags.find((t) => t.startsWith(SHA_TAG_PREFIX));
}

export type IngestAction = 'insert' | 'update' | 'skip';

/** Idempotencia por hash do arquivo: igual = skip; diferente = update (substitui); ausente = insert. */
export function decideAction(existing: Pick<FactEntry, 'tags'> | null, next: Pick<FactEntry, 'tags'>): IngestAction {
  if (!existing) return 'insert';
  return shaOf(existing) === shaOf(next) ? 'skip' : 'update';
}
