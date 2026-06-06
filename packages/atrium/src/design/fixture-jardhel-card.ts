/**
 * Design-as-code fixture · Jardhel Martins Cachola business card.
 *
 * Source of truth: pulled from the founder's signature in
 * `releases/2026-04-23-ana-luisa-vault-v1/01_carta_ana_luisa.md` and
 * the existing `cachola_tech/brand/cartao_visita_jardhel.svg`
 * (CT-BRAND-CARD-001). Edit this file and re-run `batiste-fm compile
 * card --fixture jardhel --out <path>` to regenerate.
 */

import type { BusinessCard } from './business-card.js';

export const JARDHEL_CARD: BusinessCard = {
  name: 'Jardhel Martins Cachola',
  title: 'Sócio-fundador · Founder',
  wordmark: 'CACHOLA TECH',
  tagline: 'The firm, on the record.',
  email: 'jardhel@cachola.tech',
  phones: ['+55 (11) 9 2609-5799', '+31 (0) 6 2730 3537'],
  cities: 'SÃO PAULO · EINDHOVEN',
  ref: 'CT-BRAND-CARD-001',
};

/** Registry of named card fixtures. Add new people here. */
export const CARD_FIXTURES: Record<string, BusinessCard> = {
  jardhel: JARDHEL_CARD,
};
