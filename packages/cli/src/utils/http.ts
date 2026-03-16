/**
 * HTTP utility
 *
 * Thin wrapper around fetch for CLI commands talking to the marketplace
 * and gateway APIs.
 */

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

async function parseBody(res: Response): Promise<unknown> {
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    return res.json();
  }
  return res.text();
}

export async function httpGet(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  const body = await parseBody(res);
  if (!res.ok) {
    const msg = typeof body === 'object' && body !== null && 'error' in body
      ? String((body as { error: unknown }).error)
      : `HTTP ${res.status}`;
    throw new HttpError(res.status, msg, body);
  }
  return body;
}

export async function httpPost(url: string, data: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(data),
  });
  const body = await parseBody(res);
  if (!res.ok) {
    const msg = typeof body === 'object' && body !== null && 'error' in body
      ? String((body as { error: unknown }).error)
      : `HTTP ${res.status}`;
    throw new HttpError(res.status, msg, body);
  }
  return body;
}

export async function httpDelete(url: string): Promise<unknown> {
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });
  const body = await parseBody(res);
  if (!res.ok) {
    const msg = typeof body === 'object' && body !== null && 'error' in body
      ? String((body as { error: unknown }).error)
      : `HTTP ${res.status}`;
    throw new HttpError(res.status, msg, body);
  }
  return body;
}
