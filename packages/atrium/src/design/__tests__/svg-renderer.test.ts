/**
 * Tests for the pure-string SVG renderer.
 *
 * These assert that the SVG handoff artifact has the load-bearing
 * pieces a designer needs: title text, palette hex anchored to the
 * background fill, and one annotated zone per asset reference.
 */

import { describe, expect, it } from 'vitest';
import { LOUNGERIE_PALETTE } from '../palette.js';
import { makeSlide } from '../slide.js';
import { renderSlideSvg } from '../svg-renderer.js';

describe('renderSlideSvg', () => {
  const slide = makeSlide({
    index: 1,
    title: 'Compre por Azul',
    palette: 'Azul',
    copy: 'A nova coleção em tons de azul.',
    cta: 'Ver coleção',
    assetRefs: ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg'],
  });

  it('emits a well-formed SVG envelope', () => {
    const svg = renderSlideSvg(slide);
    expect(svg).toContain('<?xml version="1.0"');
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('width="1080"');
    expect(svg).toContain('height="1350"');
  });

  it('contains the slide title text', () => {
    const svg = renderSlideSvg(slide);
    expect(svg).toContain('Compre por Azul');
  });

  it('uses the palette background hex', () => {
    const svg = renderSlideSvg(slide);
    expect(svg).toContain(LOUNGERIE_PALETTE.Azul.bg);
    expect(svg).toContain(LOUNGERIE_PALETTE.Azul.ink);
  });

  it('renders one annotated zone per asset ref', () => {
    const svg = renderSlideSvg(slide);
    // Each zone emits an "ASSET · <NAME>" annotation in caps.
    const annotations = svg.match(/ASSET · /g) ?? [];
    expect(annotations.length).toBe(5);
    expect(svg).toContain('ASSET · A');
    expect(svg).toContain('ASSET · E');
  });

  it('emits the slide index marker (1/5)', () => {
    const svg = renderSlideSvg(slide);
    expect(svg).toContain('1/5');
  });

  it('renders a CTA when provided, omits when absent', () => {
    const withCta = renderSlideSvg(slide);
    expect(withCta).toContain('VER COLEÇÃO');

    const noCta = renderSlideSvg({ ...slide, cta: undefined });
    expect(noCta).not.toContain('VER COLEÇÃO');
  });

  it('escapes XML special characters in user-provided text', () => {
    const evil = makeSlide({
      index: 1,
      title: 'A & B <script>',
      palette: 'Azul',
      copy: 'line with "quote" & ampersand',
      assetRefs: ['ok.jpg'],
    });
    const svg = renderSlideSvg(evil);
    expect(svg).toContain('A &amp; B &lt;script&gt;');
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&quot;quote&quot;');
  });

  it('uses EB Garamond italic for the title', () => {
    const svg = renderSlideSvg(slide);
    expect(svg).toContain('font-family="EB Garamond');
    expect(svg).toContain('font-style="italic"');
  });
});
