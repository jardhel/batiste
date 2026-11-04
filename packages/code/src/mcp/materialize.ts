/**
 * Materializacao de arquivos evictados pelo iCloud (flag SF_DATALESS do macOS).
 *
 * Causa raiz provada do CONNECT_TIMEOUT do MCP (2026-11-04): o repo mora em ~/Documents, que o
 * iCloud sincroniza. Com "Otimizar armazenamento" o macOS evicta arquivos pouco usados
 * (node_modules, dist) e o PRIMEIRO read de cada um bloqueia ate o download. O node carrega os
 * ~230 arquivos do servidor um a um, em serie (~1,4 s cada na medicao) => minutos, contra o limite
 * de 30 s do cliente. Aqui: achar os dataless da fecho de dependencias e baixar todos em paralelo
 * ANTES de importar o servidor. So usa builtins do node (nada pode depender de arquivo evictavel).
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Lista arquivos dataless entre os caminhos (arquivos ou raizes) (so metadata: nao dispara download). Fora do macOS: []. */
export function listDataless(roots: string[]): string[] {
  if (process.platform !== 'darwin' || roots.length === 0) return [];
  const present = roots.filter((r) => existsSync(r));
  if (present.length === 0) return [];
  try {
    const out = execFileSync('/usr/bin/find', [...present, '-type', 'f', '-flags', '+dataless'], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\n').filter(Boolean);
  } catch (e) {
    // find sai !=0 se alguma entrada nao for legivel, mas ainda imprime o que achou
    const so = (e as { stdout?: string }).stdout;
    return typeof so === 'string' ? so.split('\n').filter(Boolean) : [];
  }
}

/** Le os arquivos com `concurrency` leitores simultaneos (cada read dispara o download). */
export function materialize(files: string[], concurrency = 32): Promise<{ files: number; ms: number }> {
  const t0 = Date.now();
  if (files.length === 0) return Promise.resolve({ files: 0, ms: 0 });
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/xargs', ['-0', '-P', String(concurrency), '-n', '4', '/bin/cat'], {
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    child.on('error', reject);
    child.on('close', () => { resolve({ files: files.length, ms: Date.now() - t0 }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(files.join('\0') + '\0');
  });
}

/** Manifest do fecho carregado de fato (~230 arquivos; o fecho declarado tem ~16 mil e levaria 20+ min). */
export function manifestPath(): string {
  return process.env.BATISTE_MCP_MANIFEST ?? join(homedir(), '.batiste', 'mcp-closure.json');
}

export function readManifest(path = manifestPath()): string[] | null {
  try {
    const m = JSON.parse(readFileSync(path, 'utf8')) as { files?: unknown };
    return Array.isArray(m.files) ? (m.files as string[]).filter((f) => typeof f === 'string') : null;
  } catch {
    return null;
  }
}

export function writeManifest(files: string[], path = manifestPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ recordedAt: new Date().toISOString(), node: process.version, files: [...new Set(files)].sort() }, null, 1));
}

/** Aquece os arquivos do manifest que estao evictados; devolve quantos eram e o tempo. */
export async function warm(
  files: string[] | null,
  deps: { list?: typeof listDataless; mat?: typeof materialize; concurrency?: number } = {}
): Promise<{ dataless: number; ms: number; manifest: boolean }> {
  if (!files) return { dataless: 0, ms: 0, manifest: false };
  const list = deps.list ?? listDataless;
  const mat = deps.mat ?? materialize;
  const cold = list(files);
  if (cold.length === 0) return { dataless: 0, ms: 0, manifest: true };
  const r = await mat(cold, deps.concurrency ?? 32);
  return { dataless: cold.length, ms: r.ms, manifest: true };
}
