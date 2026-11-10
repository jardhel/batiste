/**
 * Parsing do `retrieve`: prompt que comeca com '-' (apos `--`) e stdin.
 */
import { describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { Readable } from 'node:stream';
import { registerRetrieve, type RetrieveOpts } from '../commands/retrieve.js';
import { readAllStdin, resolveQuery } from '../utils/query-input.js';

async function parse(argv: string[], stdin = ''): Promise<{ query: string; opts: RetrieveOpts }> {
  let got: { query: string; opts: RetrieveOpts } | undefined;
  const program = new Command().exitOverride().configureOutput({ writeErr: () => {}, writeOut: () => {} });
  registerRetrieve(program, async (query, opts) => { got = { query, opts }; });
  // stdin simulado so e lido se --stdin; process.stdin real e TTY/inerte nos testes
  const orig = process.stdin;
  Object.defineProperty(process, 'stdin', { value: Object.assign(Readable.from([stdin]), { isTTY: true }), configurable: true });
  try { await program.parseAsync(['node', 'batiste-fm', 'retrieve', ...argv]); }
  finally { Object.defineProperty(process, 'stdin', { value: orig, configurable: true }); }
  return got!;
}

describe('retrieve: entrada da query', () => {
  it('texto normal continua funcionando', async () => {
    expect((await parse(['Griphon', 'radar'])).query).toBe('Griphon radar');
  });
  it('prompt que comeca com "- " apos `--` e texto, com opcoes antes', async () => {
    const r = await parse(['--json', '--limit', '3', '--min-score', '0.4', '--', '- lista: Hefesto painel']);
    expect(r.query).toBe('- lista: Hefesto painel');
    expect(r.opts.json).toBe(true);
    expect(r.opts.limit).toBe('3');
  });
  it('apos `--` ate "--flag" e texto', async () => {
    expect((await parse(['--', '--json esta no texto'])).query).toBe('--json esta no texto');
  });
  it('sem `--`, prompt com hifen continua sendo opcao desconhecida (erro claro)', async () => {
    await expect(parse(['-x texto'])).rejects.toThrow(/unknown option/);
  });
  it('--stdin le o texto de stdin (inclusive iniciando com hifen)', async () => {
    const q = await resolveQuery({ words: [], stdin: true, stdinIsTTY: true }, () => readAllStdin(Readable.from(['- via stdin\n'])));
    expect(q).toBe('- via stdin');
  });
  it('sem texto algum = erro', async () => {
    await expect(resolveQuery({ words: [], stdin: false, stdinIsTTY: true })).rejects.toThrow(/query vazia/);
  });
});
