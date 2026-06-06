/**
 * Trello v1 REST client (zero-dep).
 *
 * Trello uses a long-lived API-key + token pair (NOT OAuth1 anymore for
 * personal tokens — the developer-portal "manual token" flow yields a
 * static `key` and `token` that work as query params on every request).
 *
 * We pull `lists`, `cards` (with their `labels` + `checklists` nested),
 * which is exactly what the design-as-code compiler needs:
 *   - card  -> slide
 *   - label -> palette color (Azul / Vinho / Rosa / Verde / Mood)
 *   - checklist item -> per-slide element (preserved with state)
 */

const TRELLO_API_BASE = 'https://api.trello.com/1';

export interface TrelloCredentials {
  key: string;
  token: string;
}

export interface TrelloLabel {
  id: string;
  name: string;
  color: string | null;
}

export interface TrelloChecklistItem {
  id: string;
  name: string;
  state: 'complete' | 'incomplete';
  pos: number;
}

export interface TrelloChecklist {
  id: string;
  name: string;
  checkItems: TrelloChecklistItem[];
}

export interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  shortUrl: string;
  url: string;
  idList: string;
  idLabels: string[];
  labels: TrelloLabel[];
  checklists?: TrelloChecklist[];
  dateLastActivity: string;
  closed: boolean;
}

export interface TrelloList {
  id: string;
  name: string;
  closed: boolean;
  pos: number;
}

export interface TrelloBoard {
  id: string;
  name: string;
  desc: string;
  url: string;
  shortUrl: string;
}

export interface TrelloBoardSnapshot {
  board: TrelloBoard;
  lists: TrelloList[];
  cards: TrelloCard[];
}

function authQuery(creds: TrelloCredentials): string {
  const params = new URLSearchParams({ key: creds.key, token: creds.token });
  return params.toString();
}

async function trelloGet<T>(path: string, creds: TrelloCredentials, extra?: Record<string, string>): Promise<T> {
  const params = new URLSearchParams({ key: creds.key, token: creds.token, ...extra });
  const url = `${TRELLO_API_BASE}${path}?${params.toString()}`;
  const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Trello GET ${path} failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/**
 * Fetch a complete board snapshot — board metadata, lists, cards (with
 * labels and checklists embedded). One call per resource since Trello's
 * `/boards/:id?cards=all&lists=all` returns truncated nested data; the
 * dedicated endpoints are reliable.
 */
export async function fetchBoardSnapshot(boardId: string, creds: TrelloCredentials): Promise<TrelloBoardSnapshot> {
  const board = await trelloGet<TrelloBoard>(`/boards/${boardId}`, creds);
  const lists = await trelloGet<TrelloList[]>(`/boards/${boardId}/lists`, creds, { filter: 'open' });
  const cards = await trelloGet<TrelloCard[]>(`/boards/${boardId}/cards`, creds, {
    fields: 'name,desc,shortUrl,url,idList,idLabels,labels,dateLastActivity,closed',
    checklists: 'all',
    filter: 'open',
  });
  return { board, lists, cards };
}

/** Exposed for unit tests / advanced callers. */
export function trelloAuthQueryString(creds: TrelloCredentials): string {
  return authQuery(creds);
}

/** Slugify a board name into a workstream tag. */
export function kebabCase(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
