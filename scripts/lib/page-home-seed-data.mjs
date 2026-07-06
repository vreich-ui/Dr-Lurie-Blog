/**
 * T3.4 + T3.5 — seed data for the first Page-object migration: the shared
 * newsletter section (`sec_newsletter_signup`, C§1.1 row 5 / C§1.5) and the
 * homepage record (`page_home`, C§1.1 with amendment M-9 fields).
 *
 * Copy is verbatim from the audited index.astro literals. The SAME section
 * data lives, typed, in src/lib/registry/components/home-fixture-data.ts —
 * the fixture the T3.2 render gate proved the components against. A test
 * (tests/netlify/page-home-seed.test.ts) pins the two transcriptions
 * deep-equal so they cannot drift; this file exists because plain-node seed
 * scripts cannot import TypeScript (same split as navigation-seed-data.mjs).
 *
 * Deliberate C§1.1 deviations (both recorded in the 05 doc's M-9 note and
 * home-fixture-data.ts):
 *   - checklist kicker/heading per M-9 (the row-2 literal would drop the
 *     audited h2);
 *   - hero action targets are transitional `route`-kind (Gap Note 2) until
 *     page_start_here / page_newsletter exist (P4);
 *   - s_startgrid ships as the transitional `static` cards variant for the
 *     byte-identical cutover; T3.9 applies the settled M-8 configuration
 *     post-cutover.
 *
 * `navigationOverrides.footer` carries nav_footer_home (S-4): T3.6's cutover
 * makes PageLayout consume it, removing T2.5's interim direct reference in
 * index.astro.
 *
 * SEO note for T3.6: the audited homepage metadata sets ignoreTitleTemplate
 * (the title is used verbatim, no "| site" suffix). page.v1 `seo` has no
 * such flag — the `home` PageType's loader applies the verbatim-title
 * behavior, matching today's output. Recorded here so the cutover doesn't
 * rediscover it.
 */

export const PAGE_HOME_SEED_SITE = 'site_drlurie';

export const SECTION_NEWSLETTER_SIGNUP_ID = 'sec_newsletter_signup';
export const PAGE_HOME_ID = 'page_home';

const newsletterSignupData = {
  kicker: 'Newsletter',
  heading: 'Learn about healthy skin one clear step at a time.',
  body: '<p>Join the Dr. Lurié newsletter for concise skin health education, beginner-friendly explanations, and calm guidance you can return to when you need it.</p>',
  formName: 'newsletter',
  consentText: 'No overwhelm, no trend chasing — just clear education for healthier skin.',
  anchor: 'newsletter',
};

/** Body of the shared 'section' object (the D§2.5 one-instance wrapper). */
export const sectionNewsletterSignupBody = {
  section: {
    id: 's_signup',
    type: 'newsletter_signup',
    data: newsletterSignupData,
  },
};

/** Body of page_home — C§1.1 order: hero, audience, startgrid, bio, newsletter ref. */
export const pageHomeBody = {
  route: '/',
  pageType: 'home',
  title: 'Dr. Lurié Skin Care | Healthy Skin for Skincare Newcomers',
  seo: {
    ogImage: '/Social/og-home.jpg',
  },
  sections: [
    {
      id: 's_hero',
      type: 'hero',
      data: {
        kicker: 'Physician-led skin health education',
        heading: 'Healthy Skin for Skincare Newcomers',
        body:
          '<p>A calmer, clearer way to begin caring for your skin — without complicated routines, product pressure, or trend-led advice.</p>' +
          '<p>Dr. Lurié Skin Care helps newcomers understand the basics of healthy skin, choose simple next steps, and build confidence through physician-led education.</p>',
        actions: [
          { label: 'Start Here', target: { kind: 'route', href: '/start-here' }, style: 'primary' },
          { label: 'Join Newsletter', target: { kind: 'route', href: '/newsletter' }, style: 'secondary' },
        ],
      },
    },
    {
      id: 's_audience',
      type: 'checklist',
      data: {
        kicker: 'This is for you if…',
        heading: 'You want skincare to feel understandable.',
        items: [
          'You are new to skincare and want a calm place to begin.',
          'You want to understand what your skin needs before buying more products.',
          'You prefer physician-led education over trend-driven routines.',
          'You want simple explanations that respect both science and everyday life.',
        ],
        anchor: 'audience',
      },
    },
    {
      id: 's_startgrid',
      type: 'content_grid',
      data: {
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
              description:
                'A practical way to read claims, compare options, and focus on what your skin actually needs.',
            },
            {
              title: 'What to Do When Your Skin Feels Sensitive',
              description:
                'How to slow down, simplify your routine, and notice the patterns that may be affecting your skin.',
            },
            {
              title: 'When to Ask a Dermatology Professional',
              description:
                'A guide to knowing when education is enough and when a skin concern deserves medical attention.',
            },
          ],
        },
        limit: 5,
        anchor: 'start-here',
      },
    },
    {
      id: 's_bio',
      type: 'bio',
      data: {
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
      },
    },
    {
      id: 's_newsletter',
      type: 'shared_ref',
      data: { section: SECTION_NEWSLETTER_SIGNUP_ID },
    },
  ],
  navigationOverrides: {
    footer: 'nav_footer_home',
  },
};

/**
 * Ordered: the shared section MUST exist before the page that references it
 * (reference-integrity validation on page_home resolves it once wired).
 */
export const PAGE_HOME_SEEDS = [
  {
    objectType: 'section',
    objectId: SECTION_NEWSLETTER_SIGNUP_ID,
    body: sectionNewsletterSignupBody,
    expectedWarningIds: [],
  },
  { objectType: 'page', objectId: PAGE_HOME_ID, body: pageHomeBody, expectedWarningIds: [] },
];
