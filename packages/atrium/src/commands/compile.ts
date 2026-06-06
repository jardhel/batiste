/**
 * batiste-fm compile design — design-as-code compiler entry point.
 *
 * Reads briefing FactEntries from Firm Memory (or the hardcoded
 * Loungerie fixture, via --fixture) and writes one .svg + one .psd
 * per slide into the output directory.
 *
 * The output is a *handoff artifact* for the human designer: palette,
 * type, structure, and asset slots are locked; product photos are
 * dropped in by hand. See `src/design/compiler.ts` for the projection
 * logic and `src/design/svg-renderer.ts` / `src/design/psd-renderer.ts`
 * for the rendering details.
 *
 * Registration: this file exports `registerCompile(program)`. The
 * top-level `src/index.ts` wires it in alongside `registerIngest` /
 * `registerRetrieve`.
 */

import type { Command } from 'commander';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { cpus } from 'node:os';
import { AuditLedger } from '@batiste-aidk/audit';
import { Plan } from '@batiste-aidk/parallel';
import { compile } from '../design/compiler.js';
import { LOUNGERIE_FIXTURE_SLIDES } from '../design/fixture-loungerie.js';
import { renderBusinessCardSvg } from '../design/business-card.js';
import { renderSlideSvg } from '../design/svg-renderer.js';
import { renderSlidePsd } from '../design/psd-renderer.js';
import type { Slide } from '../design/slide.js';
import { CARD_FIXTURES } from '../design/fixture-jardhel-card.js';
import { ensureFmRoot, resolvePaths } from '../utils/data-dir.js';
import { buildAtriumExecutor } from '../utils/parallel-bridge.js';
import { bold, cyan, fail, green, kv, ok, section, gray, warn } from '../utils/output.js';

const DEFAULT_CONCURRENCY = Math.max(1, Math.floor(cpus().length / 2));

export function registerCompile(program: Command): void {
  const compileCmd = program
    .command('compile')
    .description('Compile design artifacts (SVG + PSD) from Firm Memory briefings');

  compileCmd
    .command('design')
    .description('Compile the 5-screen carousel for a workstream into SVG + PSD handoff files')
    .option(
      '--workstream <slug>',
      'workstream tag in FM (default: loungerie-compre-por-cor)',
      'loungerie-compre-por-cor',
    )
    .option('--out <dir>', 'output directory (default: ./out/<workstream>/)')
    .option('--fixture', 'use the hardcoded Loungerie fixture instead of FM', false)
    .option('--width <n>', 'slide width in px (default: 1080)', '1080')
    .option('--height <n>', 'slide height in px (default: 1350)', '1350')
    .option('--concurrency <n>', 'parallel slide rendering (default: cpus/2)', String(DEFAULT_CONCURRENCY))
    .action(
      async (opts: {
        workstream: string;
        out?: string;
        fixture: boolean;
        width: string;
        height: string;
        concurrency: string;
      }): Promise<void> => {
        const out = opts.out ?? `./out/${opts.workstream}/`;
        const width = Math.max(64, Number.parseInt(opts.width, 10) || 1080);
        const height = Math.max(64, Number.parseInt(opts.height, 10) || 1350);
        const concurrency = Math.max(1, Number.parseInt(opts.concurrency, 10) || DEFAULT_CONCURRENCY);

        section('Atrium · compile design');
        kv('Workstream', cyan(opts.workstream));
        kv('Source', opts.fixture ? cyan('fixture (loungerie)') : green('firm-memory (trello)'));
        kv('Output dir', bold(out));
        kv('Slide size', `${width} × ${height}`);
        kv('Concurrency', String(concurrency));

        try {
          await mkdir(resolve(out), { recursive: true });

          // Try to wire the audit ledger so each rendered slide leaves
          // a lineage row. Failure to open the ledger (e.g., FM root
          // not initialised yet) is non-fatal: we still render, just
          // without ledger emit. This matches `audit-wrap.ts`'s "ledger
          // outage must not block the user-facing operation" rule.
          let ledger: AuditLedger | undefined;
          try {
            const paths = resolvePaths();
            await ensureFmRoot(paths);
            ledger = new AuditLedger(paths.auditDbPath);
          } catch {
            ledger = undefined;
          }

          const executor = buildAtriumExecutor({
            concurrency,
            ledger,
            sessionId: `atrium-compile-${Date.now()}`,
            agentId: 'batiste-fm',
          });
          const plan = new Plan();
          const writtenFiles: string[] = [];

          if (opts.fixture) {
            // v1.4: parallelise rendering at the slide grain. Each slide
            // becomes one cpu-bound Operation; the executor caps
            // concurrency and emits a `LineageEntry` (start + end) per
            // op which the bridge forwards to the deployment audit
            // ledger as `tool='parallel.op'`.
            const slides: Slide[] = LOUNGERIE_FIXTURE_SLIDES.map((s) => ({ ...s, width, height }));
            for (const slide of slides) {
              const stem = `${String(slide.index).padStart(1, '0')}-${slide.palette.toLowerCase()}`;
              plan.add(
                `compile-slide:${stem}`,
                { tag: 'cpu-bound' },
                async () => {
                  const svgPath = join(resolve(out), `${stem}.svg`);
                  const psdPath = join(resolve(out), `${stem}.psd`);
                  const svg = renderSlideSvg(slide);
                  await writeFile(svgPath, svg, 'utf8');
                  const psd = renderSlidePsd(slide);
                  await writeFile(psdPath, psd);
                  // Concurrent push is safe under cooperative
                  // scheduling; sort post-hoc for stable display.
                  writtenFiles.push(svgPath, psdPath);
                },
              );
            }
            const { lineage } = await executor.run(plan);
            const failures = lineage.filter((e) => e.phase === 'end' && e.result === 'error');
            if (failures.length > 0) {
              const firstErr = failures[0]?.error?.message ?? 'unknown';
              throw new Error(`${failures.length} slide(s) failed to render — first: ${firstErr}`);
            }
            writtenFiles.sort();
            process.stdout.write('\n');
            for (const f of writtenFiles) {
              process.stdout.write(`  ${gray('·')} ${green(f)}\n`);
            }
            process.stdout.write('\n');
            ok(`Compiled ${writtenFiles.length / 2} slide(s) → ${writtenFiles.length} files.`);
          } else {
            // FM-backed path: the projection logic
            // (`projectFactsToSlides`) lives inside `compile()` and is
            // not exported; rather than duplicate it here we wrap the
            // whole call as a single cpu-bound op. The lineage row in
            // the ledger still records the run; per-slide granularity
            // arrives when `design/compiler.ts` exposes a per-slide
            // callable (TODO already documented in that file).
            plan.add(
              `compile-design:${opts.workstream}`,
              { tag: 'cpu-bound' },
              async () => {
                const result = await compile(opts.workstream, {
                  out,
                  fixture: false,
                  width,
                  height,
                });
                writtenFiles.push(...result.files);
              },
            );
            const { lineage } = await executor.run(plan);
            const failures = lineage.filter((e) => e.phase === 'end' && e.result === 'error');
            if (failures.length > 0) {
              const firstErr = failures[0]?.error?.message ?? 'unknown';
              throw new Error(firstErr);
            }
            process.stdout.write('\n');
            for (const f of writtenFiles) {
              process.stdout.write(`  ${gray('·')} ${green(f)}\n`);
            }
            process.stdout.write('\n');
            ok(`Compiled ${writtenFiles.length / 2} slide(s) → ${writtenFiles.length} files.`);
          }
        } catch (err) {
          fail(err instanceof Error ? err.message : String(err));
          process.exitCode = 1;
        }
      },
    );

  compileCmd
    .command('card')
    .description('Compile a business card SVG (print-ready, 85×55 mm with bleed)')
    .option('--fixture <name>', 'named fixture (default: jardhel)', 'jardhel')
    .option('--out <path>', 'output SVG path (default: ./out/card-<fixture>.svg)')
    .action(async (opts: { fixture: string; out?: string }): Promise<void> => {
      section('Atrium · compile card');
      const fixture = CARD_FIXTURES[opts.fixture];
      if (!fixture) {
        warn(`No fixture named "${opts.fixture}". Available: ${Object.keys(CARD_FIXTURES).join(', ')}`);
        process.exitCode = 1;
        return;
      }
      const out = resolve(opts.out ?? `./out/card-${opts.fixture}.svg`);
      kv('Fixture', cyan(opts.fixture));
      kv('Person', bold(fixture.name));
      kv('Format', `${fixture.widthMm ?? 89} × ${fixture.heightMm ?? 59} mm (with bleed)`);
      kv('Output', bold(out));
      try {
        await mkdir(dirname(out), { recursive: true });
        const svg = renderBusinessCardSvg(fixture);
        await writeFile(out, svg, 'utf8');
        process.stdout.write(`\n  ${gray('·')} ${green(out)}\n\n`);
        ok(`Compiled card for ${fixture.name}.`);
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });
}
