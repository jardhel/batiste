// Testes do aquecimento de arquivos evictados pelo iCloud (causa raiz do CONNECT_TIMEOUT do MCP).
//   node --test packages/code/test/materialize.node.test.mjs
// Parte 1 (sempre): logica com listagem/leitura injetadas. Parte 2 (so macOS com iCloud em ~/Documents e
// brctl): reproduz o atraso de verdade — evicta arquivos, mede a leitura em serie (o que o node faz ao carregar
// modulos) contra a materializacao paralela.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as M from '../src/mcp/materialize.ts';

test('warm: sem manifest nao faz nada (e diz que nao ha manifest)', async () => {
  const r = await M.warm(null, { list: () => assert.fail('nao deve listar'), mat: () => assert.fail('nao deve ler') });
  assert.deepEqual(r, { dataless: 0, ms: 0, manifest: false });
});

test('warm: so materializa o que esta evictado, em paralelo', async () => {
  let got;
  const r = await M.warm(['/a', '/b', '/c'], {
    list: (f) => f.filter((x) => x !== '/b'),
    mat: async (files, conc) => { got = { files, conc }; return { files: files.length, ms: 7 }; },
    concurrency: 16,
  });
  assert.deepEqual(got, { files: ['/a', '/c'], conc: 16 });
  assert.deepEqual(r, { dataless: 2, ms: 7, manifest: true });
});

test('warm: tudo ja local => zero leituras', async () => {
  const r = await M.warm(['/a'], { list: () => [], mat: () => assert.fail('nao deve ler') });
  assert.deepEqual(r, { dataless: 0, ms: 0, manifest: true });
});

test('manifest: ida e volta, dedupe e ordenacao; ausente/corrompido => null', () => {
  const d = mkdtempSync(join(tmpdir(), 'mf-'));
  try {
    const p = join(d, 'sub', 'm.json');
    assert.equal(M.readManifest(p), null);
    M.writeManifest(['/z', '/a', '/z'], p);
    assert.deepEqual(M.readManifest(p), ['/a', '/z']);
    writeFileSync(p, '{nao json');
    assert.equal(M.readManifest(p), null);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// Parte 2 e opt-in (BATISTE_ICLOUD_TEST=1): arquivo recem-criado nao evicta (nao subiu ao iCloud), entao o teste evicta
// 12 arquivos JA sincronizados de docs/ (inofensivo: o macOS rebaixa sob demanda) e prova o bloqueio no read.
let brctl = false;
try { execFileSync('/usr/bin/which', ['brctl'], { stdio: 'ignore' }); brctl = true; } catch {}
const optIn = process.platform === 'darwin' && brctl && process.env.BATISTE_ICLOUD_TEST === '1';

test('reproduz o atraso: arquivos evictados bloqueiam o read; materialize paralelo baixa todos', { skip: !optIn && 'opt-in: BATISTE_ICLOUD_TEST=1 (macOS + brctl)' }, async (t) => {
  const docsDir = join(import.meta.dirname, '..', '..', '..', 'docs');
  const files = execFileSync('/usr/bin/find', [docsDir, '-type', 'f', '-name', '*.md'], { encoding: 'utf8' }).split('\n').filter(Boolean).slice(0, 12);
  for (const f of files) { try { execFileSync('brctl', ['evict', f], { stdio: 'ignore' }); } catch {} }
  await new Promise((r) => setTimeout(r, 1500));
  const cold = M.listDataless(files);
  if (cold.length === 0) return t.skip('iCloud nao evictou os arquivos (sem sincronizacao neste ambiente)');
  const t0 = Date.now();
  const r = await M.materialize(cold, 32);
  assert.equal(r.files, cold.length);
  assert.deepEqual(M.listDataless(files), [], 'nenhum dataless apos materializar');
  t.diagnostic(`${cold.length} arquivos evictados materializados em paralelo: ${Date.now() - t0} ms`);
});
