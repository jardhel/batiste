#!/usr/bin/env node

/**
 * Direct CLI for @batiste-aidk/code — bypasses MCP protocol entirely.
 *
 * Usage:
 *   batiste-direct <tool_name> [json_args]
 *   batiste-direct list
 *   batiste-direct <tool> --help        (schema + exemplos; manage_task <acao> --help)
 *   batiste-direct schema <tool>
 *   batiste-direct --version | doctor
 *
 * Environment:
 *   PROJECT_ROOT — project directory (default: cwd)
 *   DATA_DIR     — batiste data directory (default: $PROJECT_ROOT/.batiste)
 *
 * Examples:
 *   batiste-direct list
 *   batiste-direct index_codebase '{"mode":"full"}'
 *   batiste-direct summarize_codebase '{"depth":"detailed"}'
 *   batiste-direct validate_code '{"paths":["src/main.ts"]}'
 *   batiste-direct manage_task '{"action":"list"}'
 *   batiste-direct manage_task '{"action":"reconcile"}'
 *   batiste-direct manage_task '{"action":"reconcile","since":"HEAD~50"}'
 *   batiste-direct manage_task '{"action":"stale","staleDays":7}'
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, statSync, readdirSync } from 'fs';
import { spawn, execFileSync } from 'child_process';
import { ToolHandler } from './mcp/handler.js';
import { listDataless, manifestPath, readManifest } from './mcp/materialize.js';
import { TOOL_DEFINITIONS } from './mcp/tools.js';
import type { ToolName } from './mcp/tools.js';
import { formatHelp, TaskInputError } from './mcp/task-actions.js';

// Suppress stderr logs unless BATISTE_DEBUG is set
if (!process.env.BATISTE_DEBUG) {
  const origStderrWrite = process.stderr.write.bind(process.stderr) as (chunk: string | Uint8Array, ...rest: unknown[]) => boolean;
  process.stderr.write = (chunk: string | Uint8Array, ...rest: unknown[]) => {
    const str = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
    if (str.startsWith('[batiste:')) return true;
    return origStderrWrite(chunk, ...rest);
  };
}

const PROJECT_ROOT = process.env.PROJECT_ROOT ?? process.cwd();
const DATA_DIR = process.env.DATA_DIR ?? join(PROJECT_ROOT, '.batiste');

const VALID_TOOLS = TOOL_DEFINITIONS.map(t => t.name);
const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(HERE, '..');

function pkgVersion(): string {
  try {
    return (JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')) as { version: string }).version;
  } catch {
    return 'unknown';
  }
}

function newestMtime(dir: string, ext: string): number {
  let newest = 0;
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
      else if (e.name.endsWith(ext) && !e.name.endsWith('.test.ts') && !e.name.endsWith('.d.ts')) newest = Math.max(newest, statSync(p).mtimeMs);
    }
  };
  try { walk(dir); } catch { /* sem src (instalado via npm) */ }
  return newest;
}

function gitOut(args: string[], cwd: string): string | null {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** Sonda o servidor MCP: spawn + initialize JSON-RPC, com timeout curto. */
function pingMcp(timeoutMs: number): Promise<{ ok: boolean; ms: number; detail: string }> {
  return new Promise((resolve) => {
    const serverJs = join(HERE, 'mcp', 'server.js');
    const t0 = Date.now();
    if (!existsSync(serverJs)) { resolve({ ok: false, ms: 0, detail: `ausente: ${serverJs}` }); return; }
    const child = spawn(process.execPath, [serverJs], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, PROJECT_ROOT, DATA_DIR },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buf = '';
    let done = false;
    const finish = (r: { ok: boolean; ms: number; detail: string }): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      resolve(r);
    };
    const timer = setTimeout(
      () => { finish({ ok: false, ms: Date.now() - t0, detail: `sem resposta ao initialize em ${String(timeoutMs)} ms` }); },
      timeoutMs
    );
    child.stdout.on('data', (c: Buffer) => {
      buf += c.toString();
      if (buf.includes('"result"')) finish({ ok: true, ms: Date.now() - t0, detail: 'initialize respondeu' });
    });
    child.on('error', (e) => { finish({ ok: false, ms: Date.now() - t0, detail: `spawn falhou: ${e.message}` }); });
    child.on('exit', (code) => { finish({ ok: false, ms: Date.now() - t0, detail: `processo saiu (code ${String(code)}) antes de responder` }); });
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'batiste-doctor', version: '1' } },
    }) + '\n');
  });
}

async function doctor(): Promise<number> {
  const repoRoot = join(PKG_ROOT, '..', '..');
  const lines: string[] = [];
  let bad = 0;
  const row = (ok: boolean | null, msg: string): void => {
    if (ok === false) bad++;
    lines.push(`${ok === null ? '?' : ok ? 'ok' : 'FALHA'}  ${msg}`);
  };
  const head = gitOut(['rev-parse', '--short', 'HEAD'], repoRoot);
  const branch = gitOut(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot);
  row(true, `batiste-direct ${pkgVersion()} (build em ${HERE}; repo ${head ?? 'sem git'} @ ${branch ?? '?'})`);
  // tsc nao reescreve saida inalterada: compare com o arquivo MAIS NOVO do dist, nao com um fixo.
  const distM = newestMtime(HERE, '.js');
  const srcM = newestMtime(join(PKG_ROOT, 'src'), '.ts');
  if (srcM && srcM > distM + 1000) {
    row(false, `dist DEFASADO: src mais novo (${new Date(srcM).toISOString()}) que o build (${new Date(distM).toISOString()}). Rode: pnpm --filter @batiste-aidk/code build`);
  } else {
    row(true, `dist em dia com src (build ${new Date(distM).toISOString()})`);
  }
  row(true, `PROJECT_ROOT=${PROJECT_ROOT}  DATA_DIR=${DATA_DIR}`);
  const tasksDb = join(DATA_DIR, 'tasks.db');
  if (!existsSync(tasksDb)) {
    row(null, `tasks.db nao existe em ${DATA_DIR} (sera criado no primeiro create)`);
  } else {
    try {
      const handler = new ToolHandler(PROJECT_ROOT, DATA_DIR);
      const r = (await handler.handleTool('manage_task', { action: 'list', compact: true, limit: 0 })) as Record<string, number>;
      row(true, `tasks.db legivel: ${String(r.total)} tarefas (${String(r.pending)} pending, ${String(r.running)} running, ${String(r.completed)} completed, ${String(r.failed)} failed)`);
    } catch (e) {
      row(false, `tasks.db ilegivel: ${(e as Error).message}`);
    }
  }
  const mcp = await pingMcp(Number(process.env.BATISTE_DOCTOR_TIMEOUT_MS ?? 8000));
  row(mcp.ok, `MCP ping: ${mcp.detail} (${String(mcp.ms)} ms)`);
  // Causa raiz do CONNECT_TIMEOUT (docs/MCP-CONNECT-TIMEOUT.md): arquivos do servidor evictados pelo iCloud.
  const mf = readManifest();
  if (!mf) {
    row(null, `sem manifest do fecho do servidor (${manifestPath()}); o 1o boot via dist/mcp/launch.js grava`);
  } else {
    const cold = listDataless(mf);
    row(cold.length === 0, cold.length === 0
      ? `iCloud: os ${String(mf.length)} arquivos que o servidor carrega estao locais`
      : `iCloud: ${String(cold.length)}/${String(mf.length)} arquivos do servidor EVICTADOS (boot frio leva minutos em serie, ~25 s com launch.js)`);
  }
  const bootLog = join(DATA_DIR, 'mcp-boot.log');
  row(existsSync(bootLog) ? true : null, existsSync(bootLog) ? `boot log: ${bootLog}` : `sem ${bootLog} (o servidor grava la a cada boot)`);
  console.log(lines.join('\n'));
  return bad ? 1 : 0;
}

function toolHelp(tool: string, action?: string): string {
  const def = TOOL_DEFINITIONS.find(t => t.name === tool);
  if (!def) return `Unknown tool: ${tool}`;
  if (tool === 'manage_task') return formatHelp(action) + (action ? '' : `\n\nSchema: batiste-direct schema manage_task`);
  return `${def.name}: ${def.description}\n\nSchema (JSON):\n${JSON.stringify(def.inputSchema, null, 2)}\n\nExemplo: batiste-direct ${tool} '{...}'`;
}

function parseArgs(argsJson: string | undefined, tool: string): Record<string, unknown> {
  if (!argsJson) return {};
  try {
    const parsed: unknown = JSON.parse(argsJson);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('esperado um objeto JSON');
    return parsed as Record<string, unknown>;
  } catch (e) {
    const pos = /position (\d+)/.exec((e as Error).message)?.[1];
    const near = pos ? ` perto de: ...${argsJson.slice(Math.max(0, Number(pos) - 10), Number(pos) + 15)}...` : '';
    throw new TaskInputError(
      `JSON invalido em ${tool}: ${(e as Error).message}${near}. Use aspas simples por fora: batiste-direct ${tool} '{"action":"list"}'. Ajuda: batiste-direct ${tool} --help`
    );
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const [command] = argv;
  const wantsHelp = argv.includes('--help') || argv.includes('-h');

  if (command === '--version' || command === '-v' || command === 'version') {
    const repoRoot = join(PKG_ROOT, '..', '..');
    console.log(`batiste-direct ${pkgVersion()} (${gitOut(['rev-parse', '--short', 'HEAD'], repoRoot) ?? 'sem git'})`);
    process.exit(0);
  }

  if (command === 'doctor') process.exit(await doctor());

  if (!command || command === '--help' || command === '-h' || command === 'help' && !argv[1]) {
    console.log(`Usage: batiste-direct <tool_name> [json_args]
       batiste-direct <tool_name> --help      schema + exemplos (manage_task <acao> --help)
       batiste-direct schema <tool_name>
       batiste-direct list | doctor | --version

Tools: ${VALID_TOOLS.join(', ')}

Environment:
  PROJECT_ROOT  Project directory (default: cwd)
  DATA_DIR      Data directory (default: $PROJECT_ROOT/.batiste)`);
    process.exit(0);
  }

  if (command === 'help' || command === 'schema') {
    const tool = argv[1] ?? '';
    const def = TOOL_DEFINITIONS.find(t => t.name === tool);
    if (!def) { console.error(`Unknown tool: ${tool}\nAvailable: ${VALID_TOOLS.join(', ')}`); process.exit(1); }
    console.log(command === 'schema' ? JSON.stringify(def.inputSchema, null, 2) : toolHelp(tool, argv[2]));
    process.exit(0);
  }

  if (command === 'list') {
    for (const tool of TOOL_DEFINITIONS) {
      console.log(`  ${tool.name.padEnd(24)} ${tool.description.slice(0, 70)}`);
    }
    process.exit(0);
  }

  if (!VALID_TOOLS.includes(command)) {
    console.error(`Unknown tool: ${command}\nAvailable: ${VALID_TOOLS.join(', ')}`);
    process.exit(1);
  }

  const rest = argv.slice(1).filter(a => a !== '--help' && a !== '-h');
  if (wantsHelp) {
    const maybeAction = rest.find(a => !a.startsWith('{'));
    console.log(toolHelp(command, maybeAction));
    process.exit(0);
  }

  // `manage_task close --help` handled above; `manage_task '{...}'` is the normal call.
  const args = parseArgs(rest.find(a => a.trim().startsWith('{') || a.trim().startsWith('[')) ?? rest[0], command);
  const handler = new ToolHandler(PROJECT_ROOT, DATA_DIR);

  const result = await handler.handleTool(command as ToolName, args);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err: unknown) => {
  if (err instanceof TaskInputError) {
    console.error(`Error: ${err.message}`);
  } else {
    console.error('Error:', err instanceof Error ? err.message : err);
  }
  process.exit(1);
});
