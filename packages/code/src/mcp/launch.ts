/**
 * Launcher do servidor MCP: baixa do iCloud os arquivos evictados que o servidor carrega e so entao
 * importa o servidor. Use no lugar de dist/mcp/server.js em ~/.claude.json (docs/MCP-CONNECT-TIMEOUT.md).
 * Fases em $DATA_DIR/mcp-boot.log. O manifest (~/.batiste/mcp-closure.json, fora do iCloud) e gravado no
 * primeiro boot bem-sucedido (ou com BATISTE_RECORD=1) registrando os arquivos realmente carregados.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { createRequire, register } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readManifest, warm, writeManifest } from './materialize.js';

const T0 = Date.now();
const DATA_DIR = process.env.DATA_DIR ?? join(process.env.PROJECT_ROOT ?? process.cwd(), '.batiste');

function log(event: string, extra: Record<string, unknown> = {}): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    appendFileSync(join(DATA_DIR, 'mcp-boot.log'), JSON.stringify({ ts: new Date().toISOString(), event, pid: process.pid, ms: Date.now() - T0, ...extra }) + '\n');
  } catch {
    /* fail-soft */
  }
}

const here = dirname(fileURLToPath(import.meta.url));
log('launch');
const manifest = process.env.BATISTE_RECORD === '1' ? null : readManifest();
const w = await warm(manifest);
log('warmed', { manifest: w.manifest, dataless: w.dataless, warmMs: w.ms });
if (w.dataless > 0) console.error(`[batiste-mcp] ${w.dataless} arquivos evictados pelo iCloud baixados em ${w.ms} ms`);

// Gravacao do fecho carregado (so quando nao ha manifest): ESM via hook de load, CJS via Module._extensions.
const seen = new Set<string>();
const record = manifest === null;
if (record) {
  const req = createRequire(import.meta.url);
  const Mod = req('node:module') as { _extensions: Record<string, (m: { filename: string }, f: string) => unknown> };
  for (const ext of ['.js', '.cjs', '.json', '.node']) {
    const orig = Mod._extensions[ext];
    if (!orig) continue;
    Mod._extensions[ext] = (m, f) => {
      seen.add(f);
      return orig(m, f);
    };
  }
  const { port1, port2 } = new MessageChannel();
  port2.on('message', (u: string) => seen.add(fileURLToPath(u)));
  port2.unref();
  register('data:text/javascript,' + encodeURIComponent(
    'let port; export function initialize(d){port=d.port} export async function load(u,c,n){ if(u.startsWith("file:")) port.postMessage(u); return n(u,c); }'
  ), { parentURL: import.meta.url, data: { port: port1 }, transferList: [port1] });
}

const { start } = (await import(pathToFileURL(join(here, 'server.js')).href)) as { start: () => Promise<void> };
await start();
if (record) {
  // inclui o proprio launcher e o que o hook ESM ja reportou
  seen.add(fileURLToPath(import.meta.url));
  setTimeout(() => {
    try {
      writeManifest([...seen].filter((f) => !f.startsWith('data:')));
      log('recorded', { files: seen.size });
    } catch {
      /* fail-soft */
    }
  }, 500).unref();
}
