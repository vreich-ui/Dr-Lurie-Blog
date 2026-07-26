/**
 * The homepage section data — one transcription, used by both the render
 * gate (scripts/verify-section-components.mjs renders the components from
 * this data and requires the output to match the live homepage
 * fragment-for-fragment) and the seed (scripts/lib/page-home-seed-data.mjs,
 * pinned deep-equal by tests/netlify/page-home-seed.test.ts), so the fixture
 * the components were proven against IS the seed.
 *
 * Home-page conversion restructure (2026-07-10): the two audited card grids —
 * "This is for you if…" (formerly a `checklist` inline section) and the
 * "Start here" article grid — are both instances of the ONE reusable
 * `content_grid` type, each stored as its own shared `section` object
 * (sec_home_audience_grid / sec_home_start_grid) the page references via
 * `shared_ref`. Hero and bio remain inline on the page. Copy is verbatim from
 * the audited literals.
 *
 * Standing deviations, both recorded:
 *   - hero action targets are transitional `route`-kind (Gap Note 2) until
 *     nav targets are upgraded to `page`-kind (T3.11/T4.5);
 *   - the start-here grid uses the settled M-8 `query` source (latest posts),
 *     applied by PR #380 — not the retired placeholder cards.
 */
import type { SectionDataOf } from '../../../../packages/core/lib/registry/components/types.js';

export const homeHeroData: SectionDataOf<'hero'> = {
  kicker: 'Physician-led skin health education',
  heading: 'Healthy Skin for Skincare Newcomers',
  body:
    '<p>A calmer, clearer way to begin caring for your skin — without complicated routines, product pressure, or trend-led advice.</p>' +
    '<p>Dr. Lurié Skin Care helps newcomers understand the basics of healthy skin, choose simple next steps, and build confidence through physician-led education.</p>',
  actions: [
    { label: 'Start Here', target: { kind: 'route', href: '/start-here' }, style: 'primary' },
    { label: 'Join Newsletter', target: { kind: 'route', href: '/newsletter' }, style: 'secondary' },
  ],
};

/** The audience grid — curated text cells (`cards` source), shared object sec_home_audience_grid. */
export const homeAudienceGridData: SectionDataOf<'content_grid'> = {
  kicker: 'This is for you if…',
  heading: 'You want skincare to feel understandable.',
  source: {
    kind: 'cards',
    cards: [
      { description: 'You are new to skincare and want a calm place to begin.' },
      { description: 'You want to understand what your skin needs before buying more products.' },
      { description: 'You prefer physician-led education over trend-driven routines.' },
      { description: 'You want simple explanations that respect both science and everyday life.' },
    ],
  },
  limit: 4,
  anchor: 'audience',
};

/** The start-here grid — latest published posts (`query` source), shared object sec_home_start_grid. */
export const homeStartGridData: SectionDataOf<'content_grid'> = {
  kicker: 'Start here',
  heading: 'Five simple places to begin.',
  body: '<p>Read these in order or choose the question that feels most useful today.</p>',
  source: {
    kind: 'query',
    query: {
      sort: 'published_time_desc',
    },
  },
  limit: 5,
  anchor: 'start-here',
};

export const homeBioData: SectionDataOf<'bio'> = {
  kicker: 'About',
  heading: 'Meet Dr. Lurié',
  body: '<p>Dr. Lurié brings a physician and scientist’s lens to skin health education, translating complex ideas into steady guidance for people who are beginning their skincare journey.</p>',
  trustNotes: [
    'Physician-led perspective on skin health education.',
    'MD, PhD in Biophysics with decades of pharmaceutical research and development experience.',
    'Clear explanations designed for people who are just beginning to care for their skin intentionally.',
  ],
  disclaimer: 'Educational content only. Not medical advice.',
  anchor: 'about',
};

export const homeNewsletterSignupData: SectionDataOf<'newsletter_signup'> = {
  kicker: 'Newsletter',
  heading: 'Learn about healthy skin one clear step at a time.',
  body: '<p>Join the Dr. Lurié newsletter for concise skin health education, beginner-friendly explanations, and calm guidance you can return to when you need it.</p>',
  formName: 'newsletter',
  consentText: 'No overwhelm, no trend chasing — just clear education for healthier skin.',
  anchor: 'newsletter',
};
