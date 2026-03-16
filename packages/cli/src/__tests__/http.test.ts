import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import { HttpError, httpGet, httpPost, httpDelete } from '../utils/http.js';

function createTestServer(
  handler: (method: string, url: string, body: string) => { status: number; json: unknown },
): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        const result = handler(req.method ?? 'GET', req.url ?? '/', body);
        const payload = JSON.stringify(result.json);
        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        res.end(payload);
      });
    });
    srv.listen(0, () => {
      const port = (srv.address() as { port: number }).port;
      resolve({ port, close: () => srv.close() });
    });
  });
}

describe('http utilities', () => {
  it('httpGet returns parsed JSON on 200', async () => {
    const { port, close } = await createTestServer(() => ({ status: 200, json: { ok: true } }));
    try {
      const result = await httpGet(`http://localhost:${port}/test`);
      expect(result).toEqual({ ok: true });
    } finally {
      close();
    }
  });

  it('httpGet throws HttpError on 404', async () => {
    const { port, close } = await createTestServer(() => ({
      status: 404, json: { error: 'Not Found' },
    }));
    try {
      await expect(httpGet(`http://localhost:${port}/missing`)).rejects.toThrow(HttpError);
    } finally {
      close();
    }
  });

  it('httpPost sends JSON body and returns response', async () => {
    const { port, close } = await createTestServer((method, _url, body) => ({
      status: 201,
      json: { method, received: JSON.parse(body) as unknown },
    }));
    try {
      const result = await httpPost(`http://localhost:${port}/create`, { name: 'test' });
      expect((result as { method: string }).method).toBe('POST');
      expect((result as { received: { name: string } }).received.name).toBe('test');
    } finally {
      close();
    }
  });

  it('httpPost throws HttpError on 400', async () => {
    const { port, close } = await createTestServer(() => ({
      status: 400, json: { error: 'Validation error' },
    }));
    try {
      await expect(httpPost(`http://localhost:${port}/bad`, {})).rejects.toThrow(HttpError);
    } finally {
      close();
    }
  });

  it('httpDelete returns 200 body', async () => {
    const { port, close } = await createTestServer(() => ({
      status: 200, json: { success: true },
    }));
    try {
      const result = await httpDelete(`http://localhost:${port}/item`);
      expect((result as { success: boolean }).success).toBe(true);
    } finally {
      close();
    }
  });

  it('HttpError exposes status code', async () => {
    const { port, close } = await createTestServer(() => ({
      status: 503, json: { error: 'Service Unavailable' },
    }));
    try {
      try {
        await httpGet(`http://localhost:${port}/down`);
        expect.fail('should throw');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpError);
        expect((err as HttpError).status).toBe(503);
      }
    } finally {
      close();
    }
  });
});
