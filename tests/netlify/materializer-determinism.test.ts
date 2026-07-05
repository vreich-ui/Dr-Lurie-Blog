import assert from 'node:assert/strict';
import test from 'node:test';

import { materialize } from '../../netlify/lib/materialize.js';

const meta = { at: '2026-07-03T12:00:00.000Z', record_version: 7 };

test('determinism: materializing the same body twice produces byte-identical output (per type)', () => {
  const bodies: Array<[Parameters<typeof materialize>[0], string, unknown]> = [
    [
      'site',
      'site_drlurie',
      {
        name: 'Dr. Lurié',
        logo: { text: 'Dr. Lurié' },
        urls: { base: 'https://drlurie.com', canonicalHost: 'drlurie.com' },
        metadataDefaults: { titleTemplate: '%s', description: 'd', ogImage: '/og.png' },
        brandTokens: { colors: { primary: '#000', secondary: '#fff' }, fonts: { sans: 'Inter', serif: 'Georgia', heading: 'Inter' } },
        chrome: { showRssFeed: true, showThemeToggle: true },
        defaultNavigation: { header: 'nav_header', footer: 'nav_footer' },
        blog: { listPath: '/blog', postsPerPage: 10, categoryBase: '/category', tagBase: '/tag' },
      },
    ],
    ['page', 'page_home', { route: '/', pageType: 'home', title: 'Home', seo: {}, sections: [] }],
    ['navigation', 'nav_footer', { role: 'footer', groups: [] }],
    ['taxonomy', 'tax_drlurie', { kinds: { category: { terms: [] }, tag: { terms: [] } } }],
    ['template', 'tpl_home', { name: 'Home template', appliesTo: [], slots: [] }],
    ['section', 'sec_cta', { section: { id: 's_cta1', type: 'prose', data: { body: 'Hello' } } }],
  ];

  for (const [objectType, objectId, body] of bodies) {
    const first = materialize(objectType, objectId, body, meta);
    const second = materialize(objectType, objectId, body, meta);
    assert.equal(second.content, first.content, `${objectType} materialization was not byte-identical across two calls`);
    assert.equal(second.path, first.path);
  }
});

test('determinism: object key insertion order never affects output (explicit sort, not incidental)', () => {
  // Same logical content as the site golden fixture, but every plain-object
  // field is built with its keys in reverse-of-alphabetical insertion order.
  // If the materializer relied on incidental object key iteration order
  // instead of sorting explicitly, this would diverge from the golden case.
  const reorderedBody = {
    blog: { tagBase: '/tag', categoryBase: '/category', postsPerPage: 10, listPath: '/blog' },
    defaultNavigation: { footer: 'nav_footer', header: 'nav_header' },
    chrome: { showThemeToggle: true, showRssFeed: true },
    brandTokens: {
      fonts: { heading: 'Inter', serif: 'Georgia', sans: 'Inter' },
      colors: { secondary: '#f59e0b', primary: '#1f2937' },
    },
    metadataDefaults: { ogImage: '/images/og-default.png', description: 'Dermatology insights.', titleTemplate: '%s — Dr. Lurié' },
    urls: { canonicalHost: 'drlurie.com', base: 'https://drlurie.com' },
    logo: { text: 'Dr. Lurié' },
    name: 'Dr. Lurié',
  };
  const canonicalOrderBody = {
    name: 'Dr. Lurié',
    logo: { text: 'Dr. Lurié' },
    urls: { base: 'https://drlurie.com', canonicalHost: 'drlurie.com' },
    metadataDefaults: { titleTemplate: '%s — Dr. Lurié', description: 'Dermatology insights.', ogImage: '/images/og-default.png' },
    brandTokens: {
      colors: { primary: '#1f2937', secondary: '#f59e0b' },
      fonts: { sans: 'Inter', serif: 'Georgia', heading: 'Inter' },
    },
    chrome: { showRssFeed: true, showThemeToggle: true },
    defaultNavigation: { header: 'nav_header', footer: 'nav_footer' },
    blog: { listPath: '/blog', postsPerPage: 10, categoryBase: '/category', tagBase: '/tag' },
  };

  const fromReordered = materialize('site', 'site_drlurie', reorderedBody, meta);
  const fromCanonical = materialize('site', 'site_drlurie', canonicalOrderBody, meta);

  assert.equal(fromReordered.content, fromCanonical.content);
});
