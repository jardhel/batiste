/**
 * Loungerie · "Compre por Cor" palette
 * ====================================
 *
 * Five palette tokens for the 5-screen Instagram campaign. These are
 * **placeholder hex values** chosen to be plausible-but-restrained
 * (no neon, no oversaturated screen-blue). The human designer is
 * expected to override them — that's why they live in this file as
 * data, not baked into the renderers.
 *
 * Naming follows the brief's Portuguese labels (Azul/Vinho/Rosa/Verde/Mood)
 * because the Trello card labels are in Portuguese, and the projected
 * `FactEntry.tags` will round-trip the same string ("palette:Azul"
 * etc.). Don't rename without updating the Trello label projection.
 *
 * Rationale (designer notes — feel free to ignore and swap):
 *   - Azul:  dusty navy on warm cream — editorial, not corporate-blue.
 *   - Vinho: deep bordeaux on dusty rose — Loungerie's intimate-apparel core.
 *   - Rosa:  muted blush on warm white — soft femininity, not Barbie-pink.
 *   - Verde: forest sage on bone — botanical, slightly dated-on-purpose.
 *   - Mood:  charcoal ink on oat — the catch-all "dark/editorial" look
 *            for non-color-coded slides (intros, outros, lookbook spreads).
 *
 * Each token has:
 *   - `bg`     primary background fill
 *   - `ink`    primary text + hairline-rule color (must contrast cleanly on bg)
 *   - `accent` CTA stroke / divider accent
 */

export type PaletteName = 'Azul' | 'Vinho' | 'Rosa' | 'Verde' | 'Mood';

export interface PaletteToken {
  /** Background fill. */
  bg: string;
  /** Primary text + hairline rule color. High contrast against `bg`. */
  ink: string;
  /** CTA stroke / divider / micro-accent. */
  accent: string;
}

export const LOUNGERIE_PALETTE: Record<PaletteName, PaletteToken> = {
  Azul: {
    bg: '#F2EDE4', // warm cream
    ink: '#2A3A55', // dusty navy
    accent: '#8C9CB8', // washed slate-blue
  },
  Vinho: {
    bg: '#E8D5D0', // dusty rose
    ink: '#5A1F2A', // deep bordeaux
    accent: '#A75666', // muted wine
  },
  Rosa: {
    bg: '#F7EDE8', // warm white
    ink: '#7A4A55', // muted plum-brown (for legibility on blush)
    accent: '#D4A5A0', // muted blush
  },
  Verde: {
    bg: '#EFE9DC', // bone
    ink: '#3B4A3A', // forest sage
    accent: '#7C8E6E', // soft sage
  },
  Mood: {
    bg: '#E5DCCB', // oat
    ink: '#2B2A28', // near-black charcoal ink
    accent: '#6E6A60', // warm gray
  },
};

/**
 * Resolve a palette name from a free-form Trello label string. Tolerant
 * of casing and surrounding whitespace; returns null if unrecognized so
 * the compiler can warn rather than silently default.
 */
export function resolvePaletteName(label: string): PaletteName | null {
  const norm = label.trim().toLowerCase();
  switch (norm) {
    case 'azul':
      return 'Azul';
    case 'vinho':
      return 'Vinho';
    case 'rosa':
      return 'Rosa';
    case 'verde':
      return 'Verde';
    case 'mood':
      return 'Mood';
    default:
      return null;
  }
}
