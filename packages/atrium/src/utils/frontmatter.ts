/**
 * Minimal YAML-frontmatter parser for Claude Code auto-memory files.
 *
 * The auto-memory format is constrained: simple `key: value` pairs between
 * `---` markers, then markdown body. No nested objects, no arrays, no
 * multi-line strings. A 25-line parser is enough; pulling in `gray-matter`
 * just for this would be overkill.
 */

export interface ParsedFrontmatter {
  meta: Record<string, string>;
  body: string;
}

const FENCE = /^---\s*$/;

export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const lines = raw.split(/\r?\n/);
  if (lines.length < 2 || !FENCE.test(lines[0] ?? '')) {
    return { meta: {}, body: raw };
  }
  const meta: Record<string, string> = {};
  let i = 1;
  for (; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (FENCE.test(line)) {
      i++;
      break;
    }
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const key = (m[1] ?? '').trim();
    let value = (m[2] ?? '').trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) meta[key] = value;
  }
  const body = lines.slice(i).join('\n').replace(/^\n+/, '');
  return { meta, body };
}
