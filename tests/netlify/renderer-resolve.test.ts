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

// A minimal page export mirroring the T3.5 page_home shape: hero (route-kind
// actions), a static content_grid, and a shared_ref to a newsletter section.
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
