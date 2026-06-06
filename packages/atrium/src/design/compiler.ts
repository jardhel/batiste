/**
 * Design-as-code compiler.
 *
 * Reads Slide objects (from a hardcoded fixture in demo mode, or from
 * Firm Memory FactEntries projected from Trello in live mode) and
 * writes one .svg + one .psd per slide to the output directory.
 *
 * The compiler is **pure structure**: it does not fetch images, it does
 * not render glyphs, it does not lay out text optically. It produces
 * handoff artifacts the human designer opens in Figma/Photoshop with
 * the palette, type, structure, and asset slots already locked.
 *
 * Per ADR-0002 §"Replication flows", any FM read/write that mutates
 * the corpus must be audit-emitted before it commits — but this
 * compiler is read-only against FM, so no audit-wrap is needed here.
 * (When the compiler eventually writes a `decision`-kind FactEntry
 * recording "compiled N slides for workstream X" as a provenance
 * trail, that write must go through `withAudit`.)
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { openFirmMemory, type FactEntry } from '@batiste-aidk/memory';
import { ensureFmRoot, resolvePaths } from '../utils/data-dir.js';
import { LOUNGERIE_FIXTURE_SLIDES } from './fixture-loungerie.js';
import { resolvePaletteName, type PaletteName } from './palette.js';
import { renderSlidePsd } from './psd-renderer.js';
import { makeSlide, type Slide } from './slide.js';
import { renderSlideSvg } from './svg-renderer.js';

export interface CompileOptions {
  /** Absolute or relative output directory. Created if missing. */
  out: string;
  /** Use the hardcoded Loungerie fixture instead of querying FM. */
  fixture?: boolean;
  /** Per-slide width override. */
  width?: number;
  /** Per-slide height override. */
  height?: number;
}

export interface CompileResult {
  /** Absolute paths of every file written. */
  files: string[];
  /** Number of slides compiled. */
  slideCount: number;
  /** Source the slides came from — useful for the CLI to print. */
  source: 'fixture' | 'firm-memory';
}

/**
 * Project Trello-sourced FactEntries into Slide objects. Tags drive
 * the projection per the schema documented in
 * `commands/ingest-trello.ts`:
 *
 *   - `source:trello`               — required filter
 *   - `workstream:<slug>`           — workstream filter
 *   - `palette:<Azul|Vinho|...>`    — palette assignment
 *   - `slide-index:<n>`             — order within the carousel
 *
 * The card title becomes the Slide title; the body becomes the copy.
 * Asset refs are extracted from the body via lines starting with
 * `- asset:` (the projection convention defined in the Trello
 * ingest TODO). If no slide-index tag is present, slides fall back to
 * insertion order.
 */
function projectFactsToSlides(
  facts: FactEntry[],
  workstream: string,
  width: number,
  height: number,
): Slide[] {
  const candidates = facts.filter((f) => {
    const tags = f.tags ?? [];
    if (!tags.includes('source:trello')) return false;
    if (f.workstream && f.workstream !== workstream) return false;
    if (!f.workstream && !tags.includes(`workstream:${workstream}`)) return false;
    return true;
  });

  const indexed = candidates
    .map((f) => {
      const tags = f.tags ?? [];
      const paletteTag = tags.find((t) => t.startsWith('palette:'));
      const indexTag = tags.find((t) => t.startsWith('slide-index:'));
      const palette: PaletteName | null = paletteTag
        ? resolvePaletteName(paletteTag.slice('palette:'.length))
        : null;
      const index = indexTag ? Number.parseInt(indexTag.slice('slide-index:'.length), 10) : NaN;
      const assetRefs: string[] = [];
      const copyLines: string[] = [];
      for (const line of f.body.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('- asset:')) {
          assetRefs.push(trimmed.slice('- asset:'.length).trim());
        } else if (trimmed.startsWith('cta:')) {
          // CTA captured below
        } else if (trimmed.length > 0) {
          copyLines.push(line);
        }
      }
      const ctaLine = f.body.split('\n').find((l) => l.trim().toLowerCase().startsWith('cta:'));
      const cta = ctaLine ? ctaLine.trim().slice(4).trim() : undefined;
      return { f, palette, index, assetRefs, copy: copyLines.join('\n'), cta };
    })
    .filter((row) => row.palette !== null);

  // Stable sort: explicit slide-index first, then by created_at.
  indexed.sort((a, b) => {
    const ai = Number.isFinite(a.index) ? a.index : Number.POSITIVE_INFINITY;
    const bi = Number.isFinite(b.index) ? b.index : Number.POSITIVE_INFINITY;
    if (ai !== bi) return ai - bi;
    return a.f.created_at.localeCompare(b.f.created_at);
  });

  const total = indexed.length;
  return indexed.map((row, i) =>
    makeSlide({
      index: Number.isFinite(row.index) ? row.index : i + 1,
      title: row.f.title,
      // Non-null after filter above.
      palette: row.palette as PaletteName,
      copy: row.copy,
      cta: row.cta,
      assetRefs: row.assetRefs,
      width,
      height,
      total,
    }),
  );
}

/**
 * Main entry. Returns the absolute paths of every artifact written.
 *
 * @param workstream  Workstream slug; matched against FM tags or used as
 *                    a label hint when running the fixture path.
 * @param opts        Output dir + mode flags.
 */
export async function compile(workstream: string, opts: CompileOptions): Promise<CompileResult> {
  const outDir = resolve(opts.out);
  await mkdir(outDir, { recursive: true });

  const width = opts.width ?? 1080;
  const height = opts.height ?? 1350;

  let slides: Slide[];
  let source: CompileResult['source'];

  if (opts.fixture) {
    // Apply width/height overrides to fixture slides.
    slides = LOUNGERIE_FIXTURE_SLIDES.map((s) => ({ ...s, width, height }));
    source = 'fixture';
  } else {
    const paths = resolvePaths();
    await ensureFmRoot(paths);
    const fm = await openFirmMemory({ dataDir: paths.dataDir, namespace: paths.namespace });
    try {
      const facts = await fm.facts.list({ tags: ['source:trello'], limit: 1000 });
      slides = projectFactsToSlides(facts, workstream, width, height);
    } finally {
      await fm.close();
    }
    source = 'firm-memory';
  }

  if (slides.length === 0) {
    throw new Error(
      source === 'fixture'
        ? `No slides in fixture for workstream "${workstream}".`
        : `No FactEntries with tags=[source:trello] matched workstream "${workstream}". Run \`batiste-fm ingest trello\` first or pass --fixture.`,
    );
  }

  const files: string[] = [];
  for (const slide of slides) {
    const stem = `${String(slide.index).padStart(1, '0')}-${slide.palette.toLowerCase()}`;
    const svgPath = join(outDir, `${stem}.svg`);
    const psdPath = join(outDir, `${stem}.psd`);
    const svg = renderSlideSvg(slide);
    await writeFile(svgPath, svg, 'utf8');
    const psd = renderSlidePsd(slide);
    await writeFile(psdPath, psd);
    files.push(svgPath, psdPath);
  }

  return { files, slideCount: slides.length, source };
}
