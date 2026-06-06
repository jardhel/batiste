/**
 * batiste-fm ingest trello
 *
 * Sync a Trello board into Firm Memory. For Bonita G's Loungerie
 * deployment this is the **briefing source**: each campaign is a card,
 * card labels encode palette colors (Azul/Vinho/Rosa/Verde/Mood), and
 * card checklists encode per-slide elements.
 *
 * The design-as-code compiler reads these projected FactEntries to build
 * .psd / .svg outputs — this is what makes "Cachola Tech reads the
 * agency's real workflow" claim defensible (vs hand-transcribed JSON).
 *
 * Two operating modes:
 *   --fixture <path>   Read a board snapshot from a local JSON file.
 *                      No credentials required. The design-as-code demo
 *                      uses this path.
 *   live (default)     Hit Trello v1 with `--board-id`, credentials from
 *                      env vars (TRELLO_KEY / TRELLO_TOKEN) or Keychain
 *                      (`trello-key` / `trello-token`).
 */

import type { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { openFirmMemory, type FactEntry } from '@batiste-aidk/memory';
import { AuditLedger } from '@batiste-aidk/audit';
import { ensureFmRoot, resolvePaths } from '../utils/data-dir.js';
import { shortHash } from '../utils/hash.js';
import { scrub } from '../utils/scrub.js';
import { withAudit } from '../audit-wrap.js';
import { cyan, gray, green, kv, ok, Progress, section, warn, yellow } from '../utils/output.js';
import { loadCheckpoints, saveCheckpoints, setCheckpoint } from '../utils/checkpoint.js';
import { resolveSecret } from '../utils/keychain.js';
import {
  fetchBoardSnapshot,
  kebabCase,
  type TrelloBoardSnapshot,
  type TrelloCard,
  type TrelloChecklist,
  type TrelloChecklistItem,
  type TrelloList,
} from '../utils/trello-client.js';

/**
 * Render a single checklist as Markdown bullets, preserving completion
 * state with GFM checkbox syntax. The design-as-code compiler reads the
 * `[x]` / `[ ]` markers to know which slide elements are committed vs
 * still open.
 */
function renderChecklist(cl: TrelloChecklist): string {
  const items = [...(cl.checkItems ?? [])].sort((a, b) => a.pos - b.pos);
  const lines = items.map((it: TrelloChecklistItem) => {
    const marker = it.state === 'complete' ? '[x]' : '[ ]';
    return `- ${marker} ${it.name}`;
  });
  return [`### ${cl.name}`, ...lines].join('\n');
}

function renderChecklists(checklists: TrelloChecklist[] | undefined): string {
  if (!checklists || checklists.length === 0) return '';
  const sections = checklists.map(renderChecklist);
  return ['', '## Checklist', ...sections].join('\n');
}

export interface TrelloProjectionOptions {
  /** CLI override for workstream; if omitted, derived from board name. */
  workstream?: string;
  /** ISO timestamp; injected for deterministic tests. Defaults to now. */
  now?: string;
}

/**
 * Pure projection: TrelloBoardSnapshot -> FactEntry[]. One entry per
 * card (lists are encoded as a tag, not as separate facts — they're a
 * Kanban grouping, not a discrete decision).
 */
export function projectBoardToFacts(
  snapshot: TrelloBoardSnapshot,
  options: TrelloProjectionOptions = {},
): FactEntry[] {
  const { board, lists, cards } = snapshot;
  const listIndex = new Map<string, TrelloList>(lists.map((l) => [l.id, l]));
  const workstream = options.workstream && options.workstream.length > 0
    ? options.workstream
    : kebabCase(board.name);
  const now = options.now ?? new Date().toISOString();

  return cards
    .filter((c) => !c.closed)
    .map((card: TrelloCard) => {
      const list = listIndex.get(card.idList);
      const listName = list?.name ?? '(unknown-list)';
      const labelTags = (card.labels ?? [])
        .map((l) => (l.name && l.name.length > 0 ? l.name : null))
        .filter((n): n is string => n !== null)
        .map((n) => `palette:${n}`);

      const desc = card.desc ?? '';
      const checklistBlock = renderChecklists(card.checklists);
      const rawBody = (desc + checklistBlock).trim() || `(empty card: ${card.name})`;
      const { text: scrubbed } = scrub(rawBody);

      return {
        id: shortHash(`${board.id}:${card.id}`),
        kind: 'decision',
        title: card.name,
        body: scrubbed,
        workstream,
        sensitivity: 'confidential',
        tags: [
          'source:trello',
          `board:${board.name}`,
          `list:${listName}`,
          ...labelTags,
        ],
        vault_ref: card.shortUrl,
        created_at: now,
        updated_at: now,
      } satisfies FactEntry;
    });
}

async function loadFixture(path: string): Promise<TrelloBoardSnapshot> {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as TrelloBoardSnapshot;
  if (!parsed.board || !Array.isArray(parsed.lists) || !Array.isArray(parsed.cards)) {
    throw new Error(
      `Trello fixture ${path} does not match { board, lists[], cards[] } shape.`,
    );
  }
  return parsed;
}

async function loadLiveSnapshot(boardId: string): Promise<TrelloBoardSnapshot> {
  const key = await resolveSecret('TRELLO_KEY', 'trello-key');
  const token = await resolveSecret('TRELLO_TOKEN', 'trello-token');
  if (!key || !token) {
    throw new Error(
      'Trello credentials not found. Set env TRELLO_KEY + TRELLO_TOKEN, or store ' +
      'them in macOS Keychain under service "cachola-tech-batiste-fm" accounts ' +
      '"trello-key" / "trello-token". Get the key from https://trello.com/app-key.',
    );
  }
  return fetchBoardSnapshot(boardId, { key, token });
}

export function registerIngestTrello(parent: Command): void {
  parent
    .command('trello')
    .description('Sync a Trello board into FM as briefing FactEntries (live API or --fixture)')
    .option('--board-id <id>', 'Trello board ID (live mode)')
    .option('--fixture <path>', 'load board snapshot from a local JSON file (offline / demo mode)')
    .option('--workstream <slug>', 'override workstream tag (default: kebab-case of board name)')
    .option('--dry-run', 'project + display, do not write to FM', false)
    .action(async (opts: { boardId?: string; fixture?: string; workstream?: string; dryRun: boolean }) => {
      const paths = resolvePaths();
      await ensureFmRoot(paths);

      section('Atrium · ingest trello');
      kv('Mode', opts.fixture ? cyan('fixture') : cyan('live API'));
      if (opts.fixture) kv('Fixture', gray(opts.fixture));
      if (opts.boardId) kv('Board ID', gray(opts.boardId));
      kv('Workstream', gray(opts.workstream ?? '(derived from board name)'));
      kv('Namespace', cyan(paths.namespace));

      if (!opts.fixture && !opts.boardId) {
        warn('Pass --board-id <id> for live mode, or --fixture <path.json> for offline mode.');
        return;
      }

      const snapshot = opts.fixture
        ? await loadFixture(opts.fixture)
        : await loadLiveSnapshot(opts.boardId as string);

      kv('Board', `${snapshot.board.name} (${snapshot.board.id})`);
      kv('Lists', String(snapshot.lists.length));
      kv('Cards', String(snapshot.cards.filter((c) => !c.closed).length));

      const facts = projectBoardToFacts(snapshot, { workstream: opts.workstream });

      if (opts.dryRun) {
        for (const f of facts) {
          process.stdout.write(`  ${gray('would put:')} ${f.id}  ${f.title}\n`);
        }
        ok(`Dry-run complete — ${facts.length} facts would be projected.`);
        return;
      }

      const fm = await openFirmMemory({ dataDir: paths.dataDir, namespace: paths.namespace });
      const ledger = new AuditLedger(paths.auditDbPath);
      const ctx = { ledger, sessionId: `atrium-${Date.now()}`, agentId: 'batiste-fm' };
      const checkpoints = await loadCheckpoints(paths.checkpointPath);

      const progress = new Progress('importing', facts.length);
      let imported = 0;
      let skipped = 0;
      let lastModified = '';

      try {
        for (let i = 0; i < facts.length; i++) {
          const fact = facts[i];
          if (!fact) continue;
          const card = snapshot.cards.find((c) => shortHash(`${snapshot.board.id}:${c.id}`) === fact.id);
          if (card?.dateLastActivity && card.dateLastActivity > lastModified) {
            lastModified = card.dateLastActivity;
          }
          const existing = await fm.facts.get(fact.id);
          if (existing && existing.body === fact.body) {
            skipped++;
            progress.tick(i + 1, gray('(idempotent)'));
            continue;
          }
          await withAudit(ctx, 'fm.facts.put', { id: fact.id, source: 'trello', boardId: snapshot.board.id }, async () => {
            await fm.facts.put(fact);
          });
          imported++;
          progress.tick(i + 1);
        }
        progress.done(green(`${imported} imported, ${skipped} skipped`));

        if (lastModified) {
          setCheckpoint(checkpoints, 'trello', snapshot.board.id, lastModified);
          await saveCheckpoints(paths.checkpointPath, checkpoints);
        }

        section('Summary');
        kv('Imported', green(String(imported)));
        kv('Skipped (idempotent)', String(skipped));
        kv('Checkpoint', gray(lastModified || '(no cards had activity timestamps)'));
        kv('Audit ledger', gray(paths.auditDbPath));
        ok('trello ingestion complete.');
      } finally {
        // Mark unused flag so commander doesn't warn in strict mode.
        void yellow;
        await fm.close();
      }
    });
}
