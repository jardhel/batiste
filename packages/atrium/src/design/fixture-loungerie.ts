/**
 * Hardcoded "Compre por Cor" briefing fixture.
 *
 * This is the **demo path** for the design-as-code compiler — it lets
 * the compiler run end-to-end before live Trello OAuth is wired in
 * v1.3. The shape of this fixture mirrors what the Trello → FactEntry
 * projection produces (per `commands/ingest-trello.ts` TODO comments):
 *
 *   - one card per slide
 *   - one palette label per card (Azul/Vinho/Rosa/Verde/Mood)
 *   - checklist items become `assetRefs`
 *   - card name becomes the slide title
 *   - card description becomes the slide copy
 *
 * Edit this file freely — it is a placeholder, not a contract. The
 * goal is plausibility, so a Loungerie merchandiser looking at the
 * generated PSDs would say "yes that's the shape of our brief."
 */

import { makeSlide, type Slide } from './slide.js';

export const LOUNGERIE_WORKSTREAM_SLUG = 'loungerie-compre-por-cor';

export const LOUNGERIE_FIXTURE_SLIDES: Slide[] = [
  makeSlide({
    index: 1,
    title: 'Compre por Azul',
    palette: 'Azul',
    copy:
      'A nova coleção em tons de azul.\nDo navy ao céu — sua paleta favorita,\nem peças que combinam entre si.',
    cta: 'Ver coleção Azul',
    assetRefs: [
      'loungerie-azul-product-1.jpg',
      'loungerie-azul-product-2.jpg',
      'loungerie-azul-product-3.jpg',
      'loungerie-azul-detalhe.jpg',
      'loungerie-azul-look.jpg',
    ],
  }),
  makeSlide({
    index: 2,
    title: 'Compre por Vinho',
    palette: 'Vinho',
    copy:
      'Bordeaux profundo para a estação.\nSofisticação que veste por dentro\ne aparece nos detalhes.',
    cta: 'Ver coleção Vinho',
    assetRefs: [
      'loungerie-vinho-product-1.jpg',
      'loungerie-vinho-product-2.jpg',
      'loungerie-vinho-product-3.jpg',
      'loungerie-vinho-detalhe.jpg',
      'loungerie-vinho-look.jpg',
    ],
  }),
  makeSlide({
    index: 3,
    title: 'Compre por Rosa',
    palette: 'Rosa',
    copy:
      'Rosa que não pede licença.\nDo blush ao quartzo, peças leves\npara compor o seu rosa.',
    cta: 'Ver coleção Rosa',
    assetRefs: [
      'loungerie-rosa-product-1.jpg',
      'loungerie-rosa-product-2.jpg',
      'loungerie-rosa-product-3.jpg',
      'loungerie-rosa-detalhe.jpg',
      'loungerie-rosa-look.jpg',
    ],
  }),
  makeSlide({
    index: 4,
    title: 'Compre por Verde',
    palette: 'Verde',
    copy:
      'Verde sálvia, oliva, musgo.\nA paleta botânica que continua\ndepois que a estação muda.',
    cta: 'Ver coleção Verde',
    assetRefs: [
      'loungerie-verde-product-1.jpg',
      'loungerie-verde-product-2.jpg',
      'loungerie-verde-product-3.jpg',
      'loungerie-verde-detalhe.jpg',
      'loungerie-verde-look.jpg',
    ],
  }),
  makeSlide({
    index: 5,
    title: 'Mood do mês',
    palette: 'Mood',
    copy:
      'Tudo junto, em um só lugar.\nOs quatro tons da temporada,\ncompondo o seu próprio look.',
    cta: 'Ver lookbook',
    assetRefs: [
      'loungerie-mood-flatlay.jpg',
      'loungerie-mood-look-1.jpg',
      'loungerie-mood-look-2.jpg',
      'loungerie-mood-still-1.jpg',
      'loungerie-mood-still-2.jpg',
    ],
  }),
];
