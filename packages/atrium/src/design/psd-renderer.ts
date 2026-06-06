/**
 * PSD renderer — produces a layered Photoshop file via `ag-psd`.
 *
 * Constraints:
 *   - We avoid the optional `node-canvas` dep by feeding raw RGBA
 *     `imageData` (Uint8Array) for the background and asset placeholder
 *     layers. ag-psd's writer accepts this without canvas.
 *   - Text layers use `text.text` + a minimal `text.style` so the
 *     designer can edit typography in Photoshop. ag-psd can't fully
 *     redraw bitmap data for text layers, so Photoshop will show a
 *     "update text layers" prompt — that's expected for a handoff
 *     artifact (per ag-psd README §"Updating text layers").
 *   - Layer names are kebab-case English so the designer can find them
 *     in the Layers panel without dealing with Portuguese diacritics.
 *
 * Layer order (bottom → top, the order Photoshop expects in `children`):
 *   1. background           — solid palette.bg fill
 *   2. asset-placeholder-N  — one per assetRef, hatched fill, named
 *                             `asset-placeholder-<n>-<slug>`
 *   3. cta-button           — accent-colored solid box (designer adds
 *                             the text overlay manually)
 *   4. cta-text             — text layer with the CTA copy
 *   5. copy                 — slide body text
 *   6. title                — slide title (EB Garamond italic)
 *   7. slide-index          — "1/5" small mark
 */

import { writePsdBuffer, type Psd, type Layer } from 'ag-psd';
import { LOUNGERIE_PALETTE } from './palette.js';
import type { Slide } from './slide.js';

/** Parse "#RRGGBB" → [r, g, b]. */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return [r, g, b];
}

/** Fill a Uint8Array with a single solid RGBA pixel value. */
function solidImageData(width: number, height: number, hex: string, alpha = 255): Uint8Array {
  const [r, g, b] = hexToRgb(hex);
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = alpha;
  }
  return out;
}

/**
 * A simple diagonal-stripe pattern over a solid background. Used for
 * asset placeholder layers — gives the designer a visual cue that
 * "this zone is a stand-in, replace it" without needing an external
 * pattern image.
 */
function hatchedImageData(
  width: number,
  height: number,
  bgHex: string,
  inkHex: string,
): Uint8Array {
  const [br, bg, bb] = hexToRgb(bgHex);
  const [ir, ig, ib] = hexToRgb(inkHex);
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const onStripe = (x + y) % 12 === 0; // diagonal hairline every 12px
      const r = onStripe ? ir : br;
      const g = onStripe ? ig : bg;
      const b = onStripe ? ib : bb;
      out[idx] = r;
      out[idx + 1] = g;
      out[idx + 2] = b;
      out[idx + 3] = 230;
    }
  }
  return out;
}

/** kebab-case slug for a freeform asset ref string. */
function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '') // strip extension
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/**
 * Build the in-memory Psd object for a slide. Exported for testing
 * and so the compiler can pass to writePsdBuffer itself.
 */
export function buildSlidePsd(slide: Slide): Psd {
  const { width, height, palette: paletteName, title, copy, cta, assetRefs, index, total } = slide;
  const token = LOUNGERIE_PALETTE[paletteName];

  // Layout in slide pixel space; asset zones in a single horizontal row
  // up to 3, otherwise wrapped to 2 rows.
  const marginX = 80;
  const assetTop = 380;
  const assetBottom = 1140;
  const cols = assetRefs.length === 0 ? 1 : Math.min(assetRefs.length, assetRefs.length <= 3 ? assetRefs.length : Math.ceil(assetRefs.length / 2));
  const rows = assetRefs.length === 0 ? 0 : Math.ceil(assetRefs.length / cols);
  const innerW = width - marginX * 2;
  const innerH = assetBottom - assetTop;
  const gap = 24;
  const zoneW = rows > 0 ? Math.floor((innerW - gap * (cols - 1)) / cols) : 0;
  const zoneH = rows > 0 ? Math.floor((innerH - gap * (rows - 1)) / rows) : 0;

  const children: Layer[] = [];

  // 1. Background
  children.push({
    name: 'background',
    top: 0,
    left: 0,
    bottom: height,
    right: width,
    imageData: {
      width,
      height,
      data: solidImageData(width, height, token.bg),
    },
  });

  // 2. Asset placeholders (one per ref)
  assetRefs.forEach((ref, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = marginX + col * (zoneW + gap);
    const y = assetTop + row * (zoneH + gap);
    children.push({
      name: `asset-placeholder-${i + 1}-${slug(ref)}`,
      top: y,
      left: x,
      bottom: y + zoneH,
      right: x + zoneW,
      imageData: {
        width: zoneW,
        height: zoneH,
        data: hatchedImageData(zoneW, zoneH, token.bg, token.ink),
      },
    });
  });

  // 3. CTA box (solid accent stripe at the bottom — designer can re-stroke)
  if (cta) {
    const ctaW = 320;
    const ctaH = 56;
    const ctaX = marginX;
    const ctaY = 1180;
    children.push({
      name: 'cta-button',
      top: ctaY,
      left: ctaX,
      bottom: ctaY + ctaH,
      right: ctaX + ctaW,
      imageData: {
        width: ctaW,
        height: ctaH,
        data: solidImageData(ctaW, ctaH, token.accent, 80),
      },
    });
    children.push({
      name: 'cta-text',
      top: ctaY,
      left: ctaX,
      bottom: ctaY + ctaH,
      right: ctaX + ctaW,
      text: {
        text: cta.toUpperCase(),
        style: {
          font: { name: 'Inter' },
          fontSize: 16,
          fillColor: { r: hexToRgb(token.ink)[0], g: hexToRgb(token.ink)[1], b: hexToRgb(token.ink)[2] },
        },
      },
    });
  }

  // 4. Copy
  children.push({
    name: 'copy',
    top: 240,
    left: marginX,
    bottom: 380,
    right: width - marginX,
    text: {
      text: copy,
      style: {
        font: { name: 'EB Garamond' },
        fontSize: 28,
        fillColor: { r: hexToRgb(token.ink)[0], g: hexToRgb(token.ink)[1], b: hexToRgb(token.ink)[2] },
      },
    },
  });

  // 5. Title
  children.push({
    name: 'title',
    top: 130,
    left: marginX,
    bottom: 220,
    right: width - marginX,
    text: {
      text: title,
      style: {
        font: { name: 'EB Garamond' },
        fontSize: 56,
        fillColor: { r: hexToRgb(token.ink)[0], g: hexToRgb(token.ink)[1], b: hexToRgb(token.ink)[2] },
      },
    },
  });

  // 6. Slide index marker (top of stack)
  children.push({
    name: 'slide-index',
    top: 1280,
    left: width - marginX - 100,
    bottom: 1320,
    right: width - marginX,
    text: {
      text: `${index}/${total}`,
      style: {
        font: { name: 'Inter' },
        fontSize: 11,
        fillColor: { r: hexToRgb(token.ink)[0], g: hexToRgb(token.ink)[1], b: hexToRgb(token.ink)[2] },
      },
    },
  });

  return {
    width,
    height,
    children,
    // Provide a composite imageData (solid bg) so ag-psd doesn't error
    // on missing required composite. This is the bottom layer Photoshop
    // sees when it opens the file before redrawing layers.
    imageData: {
      width,
      height,
      data: solidImageData(width, height, token.bg),
    },
  };
}

/**
 * Render a slide to a PSD Buffer. Use `invalidateTextLayers` so
 * Photoshop will redraw text layer bitmaps on open (per ag-psd
 * README; we don't render text glyphs ourselves).
 */
export function renderSlidePsd(slide: Slide): Buffer {
  const psd = buildSlidePsd(slide);
  return writePsdBuffer(psd, { invalidateTextLayers: true });
}
