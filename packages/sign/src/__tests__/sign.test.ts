import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, plan, sign, defaults } from '../index.js';

// Fake Cachola root: a real `sign.cli` Python module that echoes its argv as
// JSON and exits with the code requested via the CLI_EXIT env var. This
// exercises the real spawn/argument-building/exit-code path of the wrapper.
let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'sign-test-'));
  mkdirSync(join(root, 'sign'));
  writeFileSync(join(root, 'sign', '__init__.py'), '');
  writeFileSync(
    join(root, 'sign', 'cli.py'),
    [
      'import sys, json, os',
      'print(json.dumps(sys.argv[1:]))',
      'sys.stderr.write("aviso")',
      'sys.exit(int(os.environ.get("CLI_EXIT", "0")))',
      '',
    ].join('\n'),
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('@batiste-aidk/sign', () => {
  it('check invokes `sign.cli check` and captures stdout/stderr', async () => {
    const r = await check({ cacholaRoot: root });
    expect(r.ok).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(['check']);
    expect(r.stderr).toBe('aviso');
  });

  it('plan forwards the pdf path', async () => {
    const r = await plan({ cacholaRoot: root, pdfPath: '/tmp/a.pdf' });
    expect(JSON.parse(r.stdout)).toEqual(['plan', '/tmp/a.pdf']);
  });

  it('sign maps every option to its CLI flag, in order', async () => {
    const r = await sign({
      cacholaRoot: root,
      pdfPath: 'doc.pdf',
      reason: 'aprovado',
      noTsa: true,
      dryRun: true,
      inPlace: true,
      outPath: 'out.pdf',
    });
    expect(JSON.parse(r.stdout)).toEqual([
      'sign',
      'doc.pdf',
      '--reason',
      'aprovado',
      '--no-tsa',
      '--dry-run',
      '--in-place',
      '--out',
      'out.pdf',
    ]);
  });

  it('sign without options passes only the pdf path', async () => {
    const r = await sign({ cacholaRoot: root, pdfPath: 'doc.pdf' });
    expect(JSON.parse(r.stdout)).toEqual(['sign', 'doc.pdf']);
  });

  it('reports a non-zero exit as ok=false with the exit code', async () => {
    process.env['CLI_EXIT'] = '3';
    try {
      const r = await check({ cacholaRoot: root });
      expect(r.ok).toBe(false);
      expect(r.exitCode).toBe(3);
    } finally {
      delete process.env['CLI_EXIT'];
    }
  });

  it('fails with a clear message when sign/cli.py is missing', async () => {
    const r = await check({ cacholaRoot: join(root, 'nao-existe') });
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(-1);
    expect(r.stderr).toContain('sign/cli.py not found');
  });

  it('exposes defaults', () => {
    expect(typeof defaults.python).toBe('string');
    expect(typeof defaults.cacholaRoot).toBe('string');
  });
});
