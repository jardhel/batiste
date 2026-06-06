/**
 * SVG renderer — pure-string template, no runtime deps.
 *
 * Output is a *handoff artifact* for the human designer: the palette,
 * type system, hairline rules, and asset zones are locked, but the
 * actual product photos are dropped in by hand. The hatched rectangles
 * mark where each `assetRef` goes; the small caps annotation under
 * each zone tells the designer which Drive file (or fixture filename)
 * belongs there.
 *
 * The hairline rule style mirrors the Cachola Tech brand SVGs (see
 * `src/ui/static/brand/lockup-stacked.svg`), but uses `palette.ink`
 * so each slide reads as a Loungerie artifact, not a Cachola Tech one.
 */

import { LOUNGERIE_PALETTE } from './palette.js';
import type { Slide } from './slide.js';

/** Escape XML special characters for safe text content. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Layout constants in slide coordinate space (px). Tuned for the
 * 1080x1350 default; scale linearly when slide.width/height differ.
 */
const LAYOUT = {
  marginX: 80,
  marginTopRule: 80,
  titleY: 180,
  copyY: 270,
  assetGridTop: 380,
  assetGridBottom: 1140,
  ctaY: 1210,
  bottomRuleY: 1270,
  indexY: 1300,
};

/**
 * Compute the asset zone grid. We arrange asset placeholder rectangles
 * in a single horizontal row with up to 5 zones; if more refs are
 * given, we wrap to a second row. Each zone is an annotated rectangle.
 */
function assetZones(
  refs: string[],
  width: number,
  top: number,
  bottom: number,
  marginX: number,
): Array<{ x: number; y: number; w: number; h: number; ref: string }> {
  if (refs.length === 0) return [];
  const cols = Math.min(refs.length, refs.length <= 3 ? refs.length : Math.ceil(refs.length / 2));
  const rows = Math.ceil(refs.length / cols);
  const innerW = width - marginX * 2;
  const innerH = bottom - top;
  const gap = 24;
  const zoneW = (innerW - gap * (cols - 1)) / cols;
  const zoneH = (innerH - gap * (rows - 1)) / rows;
  return refs.map((ref, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      x: marginX + col * (zoneW + gap),
      y: top + row * (zoneH + gap),
      w: zoneW,
      h: zoneH,
      ref,
    };
  });
}

/**
 * Render a single slide to an SVG string.
 *
 * The output is self-contained (no external resources) and includes:
 *   - Background rect in palette.bg
 *   - Top + bottom hairline rule in palette.ink (Cachola Tech brand style)
 *   - Title in EB Garamond italic
 *   - Copy below in EB Garamond regular (newlines respected)
 *   - Asset placeholder rectangles with diagonal hatch pattern + caps annotation
 *   - CTA stroked rectangle in palette.accent (when cta present)
 *   - Slide index "1/5" small in bottom-right
 */
export function renderSlideSvg(slide: Slide): string {
  const { width, height, palette: paletteName, title, copy, cta, assetRefs, index, total } = slide;
  const token = LOUNGERIE_PALETTE[paletteName];

  const zones = assetZones(
    assetRefs,
    width,
    LAYOUT.assetGridTop,
    LAYOUT.assetGridBottom,
    LAYOUT.marginX,
  );

  // Diagonal hatch pattern id is unique per slide so multiple SVGs can
  // be inlined together without id collisions.
  const hatchId = `hatch-${paletteName.toLowerCase()}-${index}`;
  const hatchStroke = token.ink;

  const copyLines = copy.split('\n');
  const copyTspans = copyLines
    .map(
      (line, i) =>
        `<tspan x="${LAYOUT.marginX}" dy="${i === 0 ? 0 : 36}">${xmlEscape(line)}</tspan>`,
    )
    .join('');

  const ctaSvg = cta
    ? (() => {
        const ctaW = 320;
        const ctaH = 56;
        const ctaX = LAYOUT.marginX;
        const ctaY = LAYOUT.ctaY - ctaH / 2;
        return [
          `<rect x="${ctaX}" y="${ctaY}" width="${ctaW}" height="${ctaH}" fill="none" stroke="${token.accent}" stroke-width="1.25"/>`,
          `<text x="${ctaX + ctaW / 2}" y="${LAYOUT.ctaY + 6}" text-anchor="middle" font-family="Inter, 'Helvetica Neue', sans-serif" font-size="16" fill="${token.ink}" letter-spacing="0.18em">${xmlEscape(cta.toUpperCase())}</text>`,
        ].join('');
      })()
    : '';

  const zonesSvg = zones
    .map((z) => {
      const annotateY = z.y + z.h + 22;
      return [
        `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" fill="url(#${hatchId})" stroke="${token.ink}" stroke-width="0.5" opacity="0.85"/>`,
        `<text x="${z.x + 8}" y="${annotateY}" font-family="Inter, 'Helvetica Neue', sans-serif" font-size="10" fill="${token.ink}" letter-spacing="0.22em">ASSET · ${xmlEscape(z.ref.toUpperCase())}</text>`,
      ].join('');
    })
    .join('');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${xmlEscape(title)}">`,
    '<defs>',
    `<pattern id="${hatchId}" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">`,
    `<rect width="8" height="8" fill="${token.bg}"/>`,
    `<line x1="0" y1="0" x2="0" y2="8" stroke="${hatchStroke}" stroke-width="0.4" opacity="0.45"/>`,
    '</pattern>',
    '</defs>',
    // Background
    `<rect width="${width}" height="${height}" fill="${token.bg}"/>`,
    // Top hairline rule (Cachola Tech brand-style, but ink-tinted)
    `<line x1="${LAYOUT.marginX}" y1="${LAYOUT.marginTopRule}" x2="${width - LAYOUT.marginX}" y2="${LAYOUT.marginTopRule}" stroke="${token.ink}" stroke-width="0.5"/>`,
    // Title (EB Garamond italic, brand convention)
    `<text x="${LAYOUT.marginX}" y="${LAYOUT.titleY}" font-family="EB Garamond, 'Libertinus Serif', 'Times New Roman', serif" font-style="italic" font-size="56" fill="${token.ink}" letter-spacing="-0.01em">${xmlEscape(title)}</text>`,
    // Copy (EB Garamond regular)
    `<text x="${LAYOUT.marginX}" y="${LAYOUT.copyY}" font-family="EB Garamond, 'Libertinus Serif', 'Times New Roman', serif" font-size="28" fill="${token.ink}">${copyTspans}</text>`,
    // Asset placeholder zones
    zonesSvg,
    // CTA
    ctaSvg,
    // Bottom hairline rule
    `<line x1="${LAYOUT.marginX}" y1="${LAYOUT.bottomRuleY}" x2="${width - LAYOUT.marginX}" y2="${LAYOUT.bottomRuleY}" stroke="${token.ink}" stroke-width="0.5"/>`,
    // Slide index (e.g., "1/5") bottom-right
    `<text x="${width - LAYOUT.marginX}" y="${LAYOUT.indexY}" text-anchor="end" font-family="Inter, 'Helvetica Neue', sans-serif" font-size="11" fill="${token.ink}" letter-spacing="0.32em">${index}/${total}</text>`,
    '</svg>',
    '',
  ].join('\n');
}
