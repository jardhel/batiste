/**
 * Slide model — the design-as-code intermediate representation.
 *
 * Each Slide is the projection from a Trello card (briefing) to the
 * structure the SVG/PSD renderers consume. The renderers must be pure
 * over this model: same Slide → same byte output.
 *
 * Default dimensions are Instagram portrait (1080x1350); the consumer
 * can override on a per-slide basis but for the "Compre por Cor"
 * 5-screen carousel they will all be portrait.
 */

import type { PaletteName } from './palette.js';

export interface Slide {
  /** 1-based index in the carousel (1..5 for Compre por Cor). */
  index: number;
  /** Display title — e.g., "Compre por Azul". */
  title: string;
  /** Palette token name; resolves to bg/ink/accent in palette.ts. */
  palette: PaletteName;
  /** Slide body copy — 1-3 lines. Newlines are preserved by the renderer. */
  copy: string;
  /** Optional CTA — e.g., "Ver coleção". */
  cta?: string;
  /**
   * Asset references — Drive file IDs for the live path, plain
   * filenames for the fixture path. Renderers don't fetch these;
   * they emit named placeholder zones so the human designer can
   * drop the photos in.
   */
  assetRefs: string[];
  /** Slide width in px. Default: 1080. */
  width: number;
  /** Slide height in px. Default: 1350. */
  height: number;
  /** Total slides in the carousel — used for the "1/5" index marker. */
  total: number;
}

export const DEFAULT_SLIDE_WIDTH = 1080;
export const DEFAULT_SLIDE_HEIGHT = 1350;

/**
 * Convenience builder. Fills in defaults for width/height/total so
 * callers can describe a slide with the briefing-relevant fields only.
 */
export function makeSlide(
  partial: Omit<Slide, 'width' | 'height' | 'total'> & {
    width?: number;
    height?: number;
    total?: number;
  },
): Slide {
  return {
    width: partial.width ?? DEFAULT_SLIDE_WIDTH,
    height: partial.height ?? DEFAULT_SLIDE_HEIGHT,
    total: partial.total ?? 5,
    ...partial,
  };
}
