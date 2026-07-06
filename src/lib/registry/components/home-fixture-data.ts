/**
 * The C§1.1 homepage section data (with the M-9 fields), copy-verbatim from
 * the audited index.astro literals. This is the render-verification fixture
 * for T3.2 (scripts/verify-section-components.mjs renders the components
 * from this data and requires the output to match the live homepage
 * fragment-for-fragment) and the data source T3.5's seed script assembles
 * the page_home record from — one transcription, used by both, so the
 * fixture the components were proven against IS the seed.
 *
 * Deliberate C§1.1 deviations, both recorded:
 *   - checklist kicker/heading per the M-9 record (05 doc): row 2's literal
 *     `heading:'This is for you if…'` would have dropped the audited h2.
 *   - hero action targets are transitional `route`-kind (Gap Note 2): the
 *     row-1 `page`-kind targets need page_start_here / page_newsletter,
 *     which arrive in P4 — same transitional rule the navigation seeds used.
 */
import type { SectionDataOf } from './types.js';

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

export const homeChecklistData: SectionDataOf<'checklist'> = {
  kicker: 'This is for you if…',
  heading: 'You want skincare to feel understandable.',
  items: [
    'You are new to skincare and want a calm place to begin.',
    'You want to understand what your skin needs before buying more products.',
    'You prefer physician-led education over trend-driven routines.',
    'You want simple explanations that respect both science and everyday life.',
  ],
  anchor: 'audience',
};

export const homeContentGridData: SectionDataOf<'content_grid'> = {
  kicker: 'Start here',
  heading: 'Five simple places to begin.',
  body: '<p>Read these in order or choose the question that feels most useful today.</p>',
  source: {
    kind: 'static',
    cards: [
      {
        title: 'What Healthy Skin Means',
        description:
          'A plain-language starting point for understanding comfort, resilience, and consistency in your skin.',
      },
      {
        title: 'How to Build a Simple Skincare Routine',
        description:
          'The essential steps to begin with, what each one is meant to do, and why more is not always better.',
      },
      {
        title: 'How to Choose Products Without Feeling Overwhelmed',
        description: 'A practical way to read claims, compare options, and focus on what your skin actually needs.',
      },
      {
        title: 'What to Do When Your Skin Feels Sensitive',
        description:
          'How to slow down, simplify your routine, and notice the patterns that may be affecting your skin.',
      },
      {
        title: 'When to Ask a Dermatology Professional',
        description: 'A guide to knowing when education is enough and when a skin concern deserves medical attention.',
      },
    ],
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
