import assert from 'node:assert/strict';
import test from 'node:test';

import { materialize, type MaterializableObjectType } from '../../netlify/lib/materialize.js';

const meta = { at: '2026-07-03T12:00:00.000Z', record_version: 1 };

const cases: Array<[MaterializableObjectType, string, unknown, string]> = [
  [
    'site',
    'site_drlurie',
    {
      name: 'Dr. Lurié',
      logo: { text: 'Dr. Lurié' },
      urls: { base: 'https://drlurie.com', canonicalHost: 'drlurie.com' },
      metadataDefaults: { titleTemplate: '%s', description: 'd', ogImage: '/og.png' },
      brandTokens: { colors: { primary: '#000' }, fonts: { sans: 'Inter', serif: 'Georgia', heading: 'Inter' } },
      chrome: { showRssFeed: true, showThemeToggle: true },
      defaultNavigation: { header: 'nav_header', footer: 'nav_footer' },
      blog: { listPath: '/blog', postsPerPage: 10, categoryBase: '/category', tagBase: '/tag' },
    },
    'src/data/site/site.json',
  ],
  ['page', 'page_home', { route: '/', pageType: 'home', title: 'Home', seo: {}, sections: [] }, 'src/data/site/pages/page_home.json'],
  ['navigation', 'nav_footer', { role: 'footer', groups: [] }, 'src/data/site/navigation/nav_footer.json'],
  ['taxonomy', 'tax_drlurie', { kinds: { category: { terms: [] }, tag: { terms: [] } } }, 'src/data/site/taxonomy.json'],
  ['template', 'tpl_home', { name: 'Home template', appliesTo: [], slots: [] }, 'src/data/site/templates/tpl_home.json'],
  [
    'section',
    'sec_cta',
    { section: { id: 's_cta1', type: 'prose', data: { body: 'Hello' } } },
    'src/data/site/sections/sec_cta.json',
  ],
];

test('materialize routes each object type to its per-type materializer and path convention', () => {
  for (const [objectType, objectId, body, expectedPath] of cases) {
    const result = materialize(objectType, objectId, body, meta);
    assert.equal(result.path, expectedPath);
  }
});

test('materialize rejects an unregistered object type at runtime', () => {
  assert.throws(() => {
    // @ts-expect-error - content_item is excluded from MaterializableObjectType; check the runtime guard
    materialize('content_item', 'req_x', {}, meta);
  }, /No materializer registered/);

  assert.throws(() => {
    // @ts-expect-error - deliberately passing an unknown type to check the runtime guard
    materialize('widget', 'widget_x', {}, meta);
  }, /No materializer registered/);
});

test('materialize rejects a body that fails its per-type schema', () => {
  assert.throws(() => materialize('navigation', 'nav_footer', { role: 'not-a-role', groups: [] }, meta));
});
