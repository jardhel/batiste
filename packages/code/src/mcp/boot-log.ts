/**
 * Telemetria de boot do servidor MCP.
 *
 * Em 2026-10 o cliente registrou 5 CONNECT_TIMEOUT (30 s) em 11 conexoes sem nenhuma linha
 * "MCP Server started" no stderr, e nada no servidor permitia dizer se o processo nem chegou ao
 * JavaScript (PATH, disco, iCloud) ou travou carregando dependencias. Este modulo e o PRIMEIRO
 * import do server.ts (ESM avalia dependencias em ordem), entao a linha "boot" sai antes de
 * tree-sitter/better-sqlite3 carregarem. Leitura do log:
 *   so "boot"            -> travou carregando dependencias
 *   "boot" + "listening" -> servidor ok; o atraso foi do cliente
 *   nenhuma linha        -> o node nem executou o servidor (spawn/PATH/disco)
 * Fail-soft: log de diagnostico nunca derruba o servidor.
 */
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const T0 = Date.now();
const DATA_DIR = process.env.DATA_DIR ?? join(process.env.PROJECT_ROOT ?? process.cwd(), '.batiste');

export function bootLog(event: string, extra: Record<string, unknown> = {}): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    appendFileSync(
      join(DATA_DIR, 'mcp-boot.log'),
      JSON.stringify({ ts: new Date().toISOString(), event, pid: process.pid, node: process.version, cwd: process.cwd(), ms: Date.now() - T0, ...extra }) + '\n'
    );
  } catch {
    /* fail-soft */
  }
}

bootLog('boot', { execPath: process.execPath, argv1: process.argv[1] });
