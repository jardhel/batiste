/**
 * @batiste-aidk/gvs · frontmatter
 *
 * Safe YAML frontmatter parser. Uses js-yaml FAILSAFE_SCHEMA plus a narrow
 * extension to permit ISO timestamps and booleans, rejecting arbitrary
 * object construction per GVS §14.
 */

import yaml from 'js-yaml';

export interface ParsedMarkdown {
  frontmatter: Record<string, unknown>;
  body: string;
  frontmatterLines: number;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseMarkdown(source: string): ParsedMarkdown {
  const match = source.match(FRONTMATTER_RE);
  if (!match) {
    return { frontmatter: {}, body: source, frontmatterLines: 0 };
  }
  const [fullMatch, yamlBody] = match;
  const body = source.slice(fullMatch.length);
  const frontmatter = parseFrontmatter(yamlBody ?? '');
  const frontmatterLines = (fullMatch.match(/\n/g) ?? []).length;
  return { frontmatter, body, frontmatterLines };
}

export function parseFrontmatter(yamlSource: string): Record<string, unknown> {
  if (yamlSource.trim().length === 0) return {};
  const parsed = yaml.load(yamlSource, {
    schema: yaml.JSON_SCHEMA,
    json: true,
  });
  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('frontmatter must be a YAML mapping');
  }
  return parsed as Record<string, unknown>;
}

const WIKILINK_RE = /\[\[([^\[\]|]+?)(?:\|[^\[\]]+?)?\]\]/g;

export function extractWikilinks(body: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(body)) !== null) {
    const target = m[1]?.trim();
    if (target) out.push(target);
  }
  return out;
}
