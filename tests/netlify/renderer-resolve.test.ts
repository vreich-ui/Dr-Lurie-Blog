import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parsePageExport,
  parseSharedSectionExport,
  resolvePage,
  resolvePageMetadata,
  resolvePageSections,
  type ResolvePageDeps,
} from '../../src/lib/renderer/resolve.js';
import type { NavTarget } from '../../src/schema/bodies/navigation-v1.js';

// A minimal page export mirroring the page_home shape: hero (route-kind
// actions) and a shared_ref to a newsletter section.
const pageExport = () => ({
  __generated: { from: 'objects/page/by-id/page_home.json', at: '2026-07-08T00:00:00.000Z', record_version: 1 },
  route: '/',
  pageType: 'home' as const,
  title: 'Dr. Lurié Skin Care | Healthy Skin for Skincare Newcomers',
  seo: { ogImage: '/Social/og-home.jpg' },
  sections: [
    {
      id: 's_hero',
      type: 'hero' as const,
      data: {
        heading: 'Healthy Skin for Skincare Newcomers',
        actions: [
          { label: 'Start Here', target: { kind: 'route' as const, href: '/start-here' }, style: 'primary' as const },
          {
            label: 'Join Newsletter',
            target: { kind: 'route' as const, href: '/newsletter' },
            style: 'secondary' as const,
          },
        ],
      },
    },
    { id: 's_newsletter', type: 'shared_ref' as const, data: { section: 'sec_newsletter_signup' } },
  ],
  navigationOverrides: { footer: 'nav_footer_home' },
});

const sectionExport = () => ({
  __generated: {
    from: 'objects/section/by-id/sec_newsletter_signup.json',
    at: '2026-07-08T00:00:00.000Z',
    record_version: 1,
  },
  section: {
    id: 's_signup',
    type: 'newsletter_signup',
    data: { formName: 'newsletter', heading: 'Learn about healthy skin.', anchor: 'newsletter' },
  },
});

// Deps: hero hrefs get a "/" prefix marker so we can assert the resolver ran;
// the shared section comes from the parsed section export.
const deps = (): ResolvePageDeps => ({
  resolveActionHref: (target: NavTarget) => (target.kind === 'route' ? `resolved:${target.href}` : 'x'),
  resolveSharedSection: () => parseSharedSectionExport(sectionExport()),
});

test('parsePageExport strips the __generated marker and validates the body', () => {
  const body = parsePageExport(pageExport());
  assert.equal(body.route, '/');
  assert.equal(body.pageType, 'home');
  assert.equal((body as unknown as Record<string, unknown>).__generated, undefined);
});

test('parseSharedSectionExport returns the inner variant {type, data}', () => {
  const inner = parseSharedSectionExport(sectionExport());
  assert.equal(inner.type, 'newsletter_signup');
  assert.equal((inner.data as { formName: string }).formName, 'newsletter');
});

test('resolvePageSections dereferences shared_ref to its target variant', () => {
  const sections = resolvePageSections(parsePageExport(pageExport()), deps());
  // The shared_ref becomes the newsletter_signup variant, keyed by the page section id.
  const newsletter = sections[1];
  assert.equal(newsletter.id, 's_newsletter');
  assert.equal(newsletter.type, 'newsletter_signup');
  assert.equal((newsletter.data as { formName: string }).formName, 'newsletter');
  assert.deepEqual(newsletter.resolved, {}); // newsletter has no references
});

test('resolvePageSections resolves hero action hrefs aligned by index; non-hero resolve empty', () => {
  const sections = resolvePageSections(parsePageExport(pageExport()), deps());
  const hero = sections[0];
  assert.equal(hero.type, 'hero');
  assert.deepEqual(hero.resolved, { actionHrefs: ['resolved:/start-here', 'resolved:/newsletter'] });
  assert.deepEqual(hero.ctx, {});
});

test('resolvePageMetadata: home page uses its title verbatim and emits the OG image at card size', () => {
  const metadata = resolvePageMetadata(parsePageExport(pageExport()));
  assert.equal(metadata.title, 'Dr. Lurié Skin Care | Healthy Skin for Skincare Newcomers');
  assert.equal(metadata.ignoreTitleTemplate, true);
  assert.deepEqual(metadata.openGraph, { images: [{ url: '/Social/og-home.jpg', width: 1200, height: 630 }] });
});

test('resolvePageMetadata: a non-home pageType does not force the verbatim-title flag', () => {
  const body = parsePageExport({ ...pageExport(), pageType: 'standard' });
  assert.equal(resolvePageMetadata(body).ignoreTitleTemplate, undefined);
});

test('resolvePage returns metadata + dispatch-ready sections together', () => {
  const resolved = resolvePage(parsePageExport(pageExport()), deps());
  assert.equal(resolved.metadata.title.length > 0, true);
  assert.equal(resolved.sections.length, 2);
  assert.deepEqual(
    resolved.sections.map((section) => section.type),
    ['hero', 'newsletter_signup']
  );
});

// ── content_grid resolution (T3.9, M-8) ───────────────────────────────────────

const gridPageExport = (source: unknown, limit = 4) => ({
  ...pageExport(),
  sections: [{ id: 's_grid', type: 'content_grid' as const, data: { heading: 'Start here', source, limit } }],
});

const CARDS = [
  { id: 'p1', title: 'Post One', description: 'First post' },
  { id: 'p2', title: 'Post Two', description: 'Second post' },
  { id: 'p3', title: 'Post Three', description: 'Third post' },
];

const gridDeps = (): ResolvePageDeps => ({
  ...deps(),
  contentGrid: {
    resolveManualItem: (id) => CARDS.find((card) => card.id === id),
    runQuery: (_query, limit) => CARDS.slice(0, limit),
    idOf: (card) => card.id,
  },
});

test('content_grid cards source needs no post resolvers; cell links resolve to hrefs aligned by index', () => {
  const page = parsePageExport(
    gridPageExport({
      kind: 'cards',
      cards: [
        { description: 'An unlinked text cell.' },
        { title: 'A linked cell', link: { label: 'Start Here', target: { kind: 'route', href: '/start-here' } } },
      ],
    })
  );
  // No `contentGrid` deps supplied at all — a cards source must not require them.
  const sections = resolvePageSections(page, deps());
  assert.deepEqual(sections[0].resolved, { cardHrefs: [undefined, 'resolved:/start-here'] });
});

test('content_grid manual source resolves each item through resolveManualItem, in order', () => {
  const page = parsePageExport(gridPageExport({ kind: 'manual', items: ['p2', 'p1'] }));
  const sections = resolvePageSections(page, gridDeps());
  assert.deepEqual(sections[0].resolved, {
    cards: [
      { id: 'p2', title: 'Post Two', description: 'Second post' },
      { id: 'p1', title: 'Post One', description: 'First post' },
    ],
  });
});

test('content_grid query source runs the query capped at limit', () => {
  const page = parsePageExport(gridPageExport({ kind: 'query', query: { sort: 'published_time_desc' } }, 2));
  const sections = resolvePageSections(page, gridDeps());
  const resolved = sections[0].resolved as { cards: unknown[] };
  assert.equal(resolved.cards.length, 2);
});

test('content_grid manual + fallback backfills from the query, de-duplicated', () => {
  const page = parsePageExport(
    gridPageExport({ kind: 'manual', items: ['p1'], fallback: { kind: 'query', query: {} } }, 3)
  );
  const sections = resolvePageSections(page, gridDeps());
  const resolved = sections[0].resolved as { cards: Array<{ id: string }> };
  // p1 from the manual pick; p2/p3 backfilled by the fallback query (p1 not duplicated).
  assert.deepEqual(
    resolved.cards.map((card) => card.id),
    ['p1', 'p2', 'p3']
  );
});

test('a post-backed content_grid without contentGrid resolvers throws loudly, not silently', () => {
  const page = parsePageExport(gridPageExport({ kind: 'manual', items: ['p1'] }));
  assert.throws(() => resolvePageSections(page, deps()), /requires contentGrid resolvers/);
});
