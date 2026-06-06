/**
 * Trello board → FactEntry projection unit tests.
 *
 * Pure-function coverage of `projectBoardToFacts`: no live API, no FM
 * writes, no audit ledger. Uses a minimal in-memory snapshot that
 * mirrors the shape Atrium would build from `fetchBoardSnapshot`.
 */

import { describe, expect, it } from 'vitest';
import { projectBoardToFacts } from '../commands/ingest-trello.js';
import type { TrelloBoardSnapshot } from '../utils/trello-client.js';
import { shortHash } from '../utils/hash.js';

function makeSnapshot(): TrelloBoardSnapshot {
  return {
    board: {
      id: 'board-001',
      name: 'Loungerie · Compre Por Cor',
      desc: 'Briefing source for the design-as-code compiler',
      url: 'https://trello.com/b/board-001/loungerie',
      shortUrl: 'https://trello.com/b/board-001',
    },
    lists: [
      { id: 'list-azul', name: 'Azul', closed: false, pos: 1 },
      { id: 'list-vinho', name: 'Vinho', closed: false, pos: 2 },
    ],
    cards: [
      {
        id: 'card-aaa',
        name: 'Slide hero — Azul',
        desc: 'Hero do compre por cor azul.',
        shortUrl: 'https://trello.com/c/card-aaa',
        url: 'https://trello.com/c/card-aaa/slide-hero-azul',
        idList: 'list-azul',
        idLabels: ['lab-azul'],
        labels: [{ id: 'lab-azul', name: 'Azul', color: 'blue' }],
        checklists: [
          {
            id: 'cl-1',
            name: 'Elementos',
            checkItems: [
              { id: 'ci-1', name: 'Logo Loungerie', state: 'complete', pos: 1 },
              { id: 'ci-2', name: 'Mood azul piscina', state: 'incomplete', pos: 2 },
            ],
          },
        ],
        dateLastActivity: '2026-04-20T12:00:00.000Z',
        closed: false,
      },
      {
        id: 'card-bbb',
        name: 'Slide produto — Vinho',
        desc: 'Cards de produto da paleta vinho.',
        shortUrl: 'https://trello.com/c/card-bbb',
        url: 'https://trello.com/c/card-bbb/slide-produto-vinho',
        idList: 'list-vinho',
        idLabels: ['lab-vinho', 'lab-mood'],
        labels: [
          { id: 'lab-vinho', name: 'Vinho', color: 'red' },
          { id: 'lab-mood', name: 'Mood', color: 'purple' },
        ],
        checklists: [],
        dateLastActivity: '2026-04-21T09:30:00.000Z',
        closed: false,
      },
    ],
  };
}

describe('projectBoardToFacts', () => {
  const snapshot = makeSnapshot();
  const facts = projectBoardToFacts(snapshot, { now: '2026-04-24T00:00:00.000Z' });

  it('projects one FactEntry per open card', () => {
    expect(facts).toHaveLength(2);
  });

  it('uses shortHash(boardId + ":" + cardId) for the FactEntry id', () => {
    expect(facts[0]?.id).toBe(shortHash('board-001:card-aaa'));
    expect(facts[1]?.id).toBe(shortHash('board-001:card-bbb'));
  });

  it('marks every fact as kind=decision', () => {
    for (const f of facts) expect(f.kind).toBe('decision');
  });

  it('derives workstream from board name as kebab-case when not overridden', () => {
    expect(facts[0]?.workstream).toBe('loungerie-compre-por-cor');
  });

  it('honors --workstream override', () => {
    const overridden = projectBoardToFacts(snapshot, {
      workstream: 'override-ws',
      now: '2026-04-24T00:00:00.000Z',
    });
    expect(overridden[0]?.workstream).toBe('override-ws');
  });

  it('builds tag set with source/board/list/palette prefixes', () => {
    const tags = facts[0]?.tags ?? [];
    expect(tags).toContain('source:trello');
    expect(tags).toContain('board:Loungerie · Compre Por Cor');
    expect(tags).toContain('list:Azul');
    expect(tags).toContain('palette:Azul');
  });

  it('preserves multiple labels with palette: prefix verbatim', () => {
    const tags = facts[1]?.tags ?? [];
    expect(tags).toContain('palette:Vinho');
    expect(tags).toContain('palette:Mood');
  });

  it('renders checklist items with completion state and a Checklist heading', () => {
    const body = facts[0]?.body ?? '';
    expect(body).toContain('## Checklist');
    expect(body).toContain('### Elementos');
    expect(body).toContain('- [x] Logo Loungerie');
    expect(body).toContain('- [ ] Mood azul piscina');
  });

  it('uses the card shortUrl as vault_ref', () => {
    expect(facts[0]?.vault_ref).toBe('https://trello.com/c/card-aaa');
  });

  it('marks every fact as confidential', () => {
    for (const f of facts) expect(f.sensitivity).toBe('confidential');
  });
});
