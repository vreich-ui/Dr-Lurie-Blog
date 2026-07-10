/**
 * Seed data for the home-page object family: the two shared grid sections
 * (`sec_home_audience_grid`, `sec_home_start_grid` — both instances of the ONE
 * reusable `content_grid` type), the shared newsletter section
 * (`sec_newsletter_signup`), and the homepage record (`page_home`).
 *
 * Home-page conversion restructure (2026-07-10): hero and bio stay inline on
 * the page; the two audited card grids are standalone shared `section`
 * objects the page references via `shared_ref`, so an agent can edit or
 * repoint each grid independently (and reuse them on other pages) with no
 * code change. The audience grid uses the sanctioned `cards` source (curated
 * text cells — replaced the retired transitional `static` variant, playbook
 * trap 9); the start-here grid keeps the settled M-8 `query` source.
 *
 * Copy is verbatim from the audited literals. The SAME section data lives,
 * typed, in src/lib/registry/components/home-fixture-data.ts — the fixture
 * the render gate proves the components against. A test
 * (tests/netlify/page-home-seed.test.ts) pins the two transcriptions
 * deep-equal so they cannot drift; this file exists because plain-node seed
 * scripts cannot import TypeScript (same split as navigation-seed-data.mjs).
 *
 * Standing deviations (recorded in home-fixture-data.ts too):
 *   - hero action targets are transitional `route`-kind (Gap Note 2) until
 *     nav targets upgrade to `page`-kind (T3.11/T4.5).
 *
 * `navigationOverrides.footer` carries nav_footer_home (S-4); the
 * `structure_home_footer` validation rule (2026-07-10 incident) blocks any
 * patch/publish that would drop it.
 *
 * SEO note: the audited homepage metadata sets ignoreTitleTemplate (the title
 * is used verbatim, no "| site" suffix). page.v1 `seo` has no such flag — the
 * `home` PageType's loader applies the verbatim-title behavior.
 */

export const PAGE_HOME_SEED_SITE = 'site_drlurie';

export const SECTION_NEWSLETTER_SIGNUP_ID = 'sec_newsletter_signup';
export const SECTION_HOME_AUDIENCE_GRID_ID = 'sec_home_audience_grid';
export const SECTION_HOME_START_GRID_ID = 'sec_home_start_grid';
export const PAGE_HOME_ID = 'page_home';

const newsletterSignupData = {
  kicker: 'Newsletter',
  heading: 'Learn about healthy skin one clear step at a time.',
  body: '<p>Join the Dr. Lurié newsletter for concise skin health education, beginner-friendly explanations, and calm guidance you can return to when you need it.</p>',
  formName: 'newsletter',
  consentText: 'No overwhelm, no trend chasing — just clear education for healthier skin.',
  anchor: 'newsletter',
};

const audienceGridData = {
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

const startGridData = {
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

/** Body of the shared 'section' object (the D§2.5 one-instance wrapper). */
export const sectionNewsletterSignupBody = {
  section: {
    id: 's_signup',
    type: 'newsletter_signup',
    data: newsletterSignupData,
  },
};

export const sectionHomeAudienceGridBody = {
  section: {
    id: 's_audiencegrid',
    type: 'content_grid',
    data: audienceGridData,
  },
};

export const sectionHomeStartGridBody = {
  section: {
    id: 's_startgrid',
    type: 'content_grid',
    data: startGridData,
  },
};

/** Body of page_home — audited order: hero, audience grid, start grid, bio, newsletter, all grids/newsletter by reference. */
export const pageHomeBody = {
  route: '/',
  pageType: 'home',
  title: 'Dr. Lurié Skin Care | Healthy Skin for Skincare Newcomers',
  // seo: adopted from the production store record during the 2026-07-10
  // credentialed heal — the record carried a real meta description plus
  // explicit robots/title that the original transcription lacked. Kept
  // deliberately (good SEO, matches the hero copy) so seed === store.
  seo: {
    title: 'Dr. Lurié Skin Care | Healthy Skin for Skincare Newcomers',
    description:
      'A calmer, clearer way to begin caring for your skin without complicated routines, product pressure, or trend-led advice.',
    ogImage: '/Social/og-home.jpg',
    robots: { index: true, follow: true },
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
      type: 'shared_ref',
      data: { section: SECTION_HOME_AUDIENCE_GRID_ID },
    },
    {
      id: 's_startgrid',
      type: 'shared_ref',
      data: { section: SECTION_HOME_START_GRID_ID },
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
 * Ordered: every referenced section MUST exist before the page that
 * references it (reference-integrity validation on page_home resolves them).
 */
export const PAGE_HOME_SEEDS = [
  {
    objectType: 'section',
    objectId: SECTION_NEWSLETTER_SIGNUP_ID,
    body: sectionNewsletterSignupBody,
    expectedWarningIds: [],
  },
  {
    objectType: 'section',
    objectId: SECTION_HOME_AUDIENCE_GRID_ID,
    body: sectionHomeAudienceGridBody,
    expectedWarningIds: [],
  },
  {
    objectType: 'section',
    objectId: SECTION_HOME_START_GRID_ID,
    body: sectionHomeStartGridBody,
    expectedWarningIds: [],
  },
  { objectType: 'page', objectId: PAGE_HOME_ID, body: pageHomeBody, expectedWarningIds: [] },
];
