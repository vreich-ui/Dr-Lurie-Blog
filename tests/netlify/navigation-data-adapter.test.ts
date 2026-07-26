/**
 * T2.4 verification: adapter(seeded records) deep-equals the current
 * `headerData` / `footerData` / `homeFooterData` literals — the
 * byte-identical cutover guarantee moved to the type level.
 *
 * The expected values below are the literals from src/navigation.ts and
 * src/pages/index.astro with their permalink helpers already applied
 * (site config: base '/', trailingSlash false, blog list at /learn/library —
 * so getPermalink('/x') = '/x', getBlogPermalink() = '/learn/library',
 * getAsset('/rss.xml') = '/rss.xml'). They are copied here rather than
 * imported because ~/navigation only evaluates inside Astro
 * (astrowind:config); if the source literals ever change, this test MUST be
 * updated in the same commit — it is the fidelity pin.
 */
import '../../sites/drlurie/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNavTargetResolver,
  navigationToFooterProps,
  navigationToHeaderProps,
  parseNavigationExport,
} from '../../packages/core/app/utils/navigation-data.js';
import { materializeNavigation } from '../../packages/core/server/lib/materializers/navigation.js';
import { navigationBodySchema } from '../../packages/core/schema/bodies/navigation-v1.js';
import { navFooterBody, navFooterHomeBody, navHeaderBody } from '../../sites/drlurie/seeds/navigation-seed-data.mjs';

const resolve = createNavTargetResolver({ blogPermalink: '/learn/library' });
const FOOT_NOTE = '\n    Educational content only — not medical advice. © Dr. Lurié.\n  ';

// ── the current literals, permalinks applied ─────────────────────────────────

const expectedHeaderData = {
  links: [
    {
      text: 'Start Here',
      href: '/',
      links: [
        { text: 'Home', href: '/', description: 'A science-first overview of what changes in skin after 60.' },
        {
          text: 'About Dr. Lurié',
          href: '/about',
          description: 'Meet the biophysicist behind the age-aware approach.',
        },
        {
          text: 'Start Here guide',
          href: '/start-here',
          description: 'Begin with the simplest path through Dr. Lurié skin health education.',
        },
      ],
    },
    {
      text: 'Learn',
      href: '/learn/library',
      links: [
        {
          text: 'Education Library',
          href: '/learn/library',
          description: 'Browse all skin science articles and practical explainers.',
        },
        {
          text: 'Topics',
          href: '/learn/topics',
          description: 'Explore articles grouped by their category frontmatter topics.',
        },
        {
          text: 'Free Guide',
          href: '/guides/free-guide',
          description: 'Get the structured guide to aging skin and body odor changes.',
        },
      ],
    },
    {
      text: 'Solutions',
      href: '/solutions/shop-preview',
      links: [
        {
          text: 'Shop Preview',
          href: '/solutions/shop-preview',
          description: 'See the upcoming age-aware skincare product direction.',
        },
        {
          text: 'Early Access',
          href: '/solutions/early-access',
          description: 'Join updates as research-led solutions become available.',
        },
        {
          text: 'Join Early Access',
          href: '/solutions/early-access',
          description: 'Request launch notes, previews, and member-only product updates.',
        },
      ],
    },
  ],
  actions: [{ text: 'Join Early Access', href: '/solutions/early-access', variant: 'primary' }],
};

const expectedFooterData = {
  links: [
    {
      title: 'Explore',
      links: [
        { text: 'Home', href: '/' },
        { text: 'About', href: '/about' },
        { text: 'Education', href: '/learn/library' },
        { text: 'Topics', href: '/learn/topics' },
      ],
    },
    {
      title: 'Next steps',
      links: [
        { text: 'Free Guide', href: '/guides/free-guide' },
        { text: 'Shop Preview', href: '/solutions/shop-preview' },
        { text: 'Early Access', href: '/solutions/early-access' },
        { text: 'Contact', href: '/contact' },
      ],
    },
  ],
  secondaryLinks: [
    { text: 'Terms', href: '/terms' },
    { text: 'Privacy Policy', href: '/privacy' },
  ],
  socialLinks: [{ ariaLabel: 'RSS', icon: 'tabler:rss', href: '/rss.xml' }],
  footNote: FOOT_NOTE,
};

const expectedHomeFooterData = {
  brand: 'Dr. Lurié Skin Care',
  descriptor: 'Healthy Skin for Skincare Newcomers',
  links: [
    {
      title: 'Start learning',
      links: [
        { text: 'Start Here', href: '/start-here' },
        { text: 'Library', href: '/learn/library' },
        { text: 'Topics', href: '/learn/topics' },
        { text: 'Free Guide', href: '/guides/free-guide' },
      ],
    },
    {
      title: 'Connect',
      links: [
        { text: 'About', href: '/about' },
        { text: 'Newsletter', href: '/newsletter' },
      ],
    },
  ],
  secondaryLinks: [
    { text: 'Terms', href: '/terms' },
    { text: 'Privacy', href: '/privacy' },
  ],
  socialLinks: [{ ariaLabel: 'RSS', icon: 'tabler:rss', href: '/rss.xml' }],
  footNote: FOOT_NOTE,
};

// ── the deep-equality pins ───────────────────────────────────────────────────

test('adapter(nav_header) deep-equals the current headerData literal', () => {
  const body = navigationBodySchema.parse(navHeaderBody);
  assert.deepStrictEqual(navigationToHeaderProps(body, resolve), expectedHeaderData);
});

test('adapter(nav_footer) deep-equals the current footerData literal — and emits NO brand/descriptor keys', () => {
  const body = navigationBodySchema.parse(navFooterBody);
  const props = navigationToFooterProps(body, resolve);
  assert.deepStrictEqual(props, expectedFooterData);
  // Footer.astro must keep applying its own defaults (SITE.name + the default
  // descriptor); an explicit `brand: undefined` key would override nothing
  // but deepStrictEqual pins the absence anyway — assert it loudly too.
  assert.ok(!('brand' in props));
  assert.ok(!('descriptor' in props));
});

test('adapter(nav_footer_home) deep-equals the current homeFooterData literal', () => {
  const body = navigationBodySchema.parse(navFooterHomeBody);
  assert.deepStrictEqual(navigationToFooterProps(body, resolve), expectedHomeFooterData);
});

test('social links stay icon-only: no text key, ariaLabel carries the label', () => {
  const props = navigationToFooterProps(navigationBodySchema.parse(navFooterBody), resolve);
  assert.ok(!('text' in props.socialLinks[0]));
  assert.equal(props.socialLinks[0].ariaLabel, 'RSS');
});

// ── the full pipeline: seed → materialize → parse export → props ────────────

test('materialized export round-trips through parseNavigationExport to the same props', () => {
  const meta = { at: '2026-07-06T00:00:00.000Z', record_version: 1, exportRoot: 'sites/drlurie/data/site' };
  const exported = JSON.parse(materializeNavigation('nav_header', navHeaderBody, meta).content) as unknown;
  const body = parseNavigationExport(exported);
  assert.deepStrictEqual(navigationToHeaderProps(body, resolve), expectedHeaderData);
});

// ── resolver contract ────────────────────────────────────────────────────────

test('resolver: route/asset/external pass through; listing → blog permalink', () => {
  assert.equal(resolve({ kind: 'route', href: '/about' }), '/about');
  assert.equal(resolve({ kind: 'asset', href: '/rss.xml' }), '/rss.xml');
  assert.equal(resolve({ kind: 'external', href: 'https://example.com/x' }), 'https://example.com/x');
  assert.equal(resolve({ kind: 'listing', list: 'content_index' }), '/learn/library');
});

test('resolver: page/taxonomy targets throw loudly in Phase 2 (no silent dead links)', () => {
  assert.throws(() => resolve({ kind: 'page', page: 'page_home' }), /materialize time/);
  assert.throws(() => resolve({ kind: 'taxonomy', termKind: 'category', term_id: 't_abc' }), /taxonomy registry/);
});

// ── M-9: adminOnly carry-through (admin menu → main nav, client-gated) ────────

test('adapter carries adminOnly on group and item only when set — absent otherwise (byte-identical)', () => {
  const body = navigationBodySchema.parse({
    role: 'header',
    groups: [
      {
        id: 'grp_public',
        title: 'Learn',
        items: [{ id: 'itm_lib', label: 'Library', target: { kind: 'route', href: '/learn/library' } }],
      },
      {
        id: 'grp_admin',
        title: 'Admin',
        adminOnly: true,
        items: [
          { id: 'itm_dash', label: 'Dashboard', target: { kind: 'route', href: '/admin' }, adminOnly: true },
          { id: 'itm_show', label: 'Object Showcase', target: { kind: 'route', href: '/object-showcase' } },
        ],
      },
    ],
  });
  const props = navigationToHeaderProps(body, resolve);

  // Public group and its item stay exactly as before — no adminOnly key leaks in.
  assert.deepStrictEqual(props.links[0], {
    text: 'Learn',
    links: [{ text: 'Library', href: '/learn/library' }],
  });
  // Admin group carries the flag; the item that set it does too, the one that didn't stays clean.
  assert.equal(props.links[1].adminOnly, true);
  assert.equal(props.links[1].links?.[0].adminOnly, true);
  assert.ok(!('adminOnly' in (props.links[1].links?.[1] ?? {})));
});
