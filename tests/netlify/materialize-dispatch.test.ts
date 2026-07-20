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
  [
    'page',
    'page_home',
    { route: '/', pageType: 'home', title: 'Home', seo: {}, sections: [] },
    'src/data/site/pages/page_home.json',
  ],
  ['navigation', 'nav_footer', { role: 'footer', groups: [] }, 'src/data/site/navigation/nav_footer.json'],
  [
    'taxonomy',
    'tax_drlurie',
    { kinds: { category: { terms: [] }, tag: { terms: [] } } },
    'src/data/site/taxonomy.json',
  ],
  [
    'template',
    'tpl_home',
    { name: 'Home template', appliesTo: [], slots: [] },
    'src/data/site/templates/tpl_home.json',
  ],
  [
    'section_template',
    'stpl_cta',
    { name: 'CTA recipe', blueprint: { id: 's_bp', type: 'cta_banner', data: { heading: 'Go', actions: [] } } },
    'src/data/site/section-templates/stpl_cta.json',
  ],
  [
    'theme',
    'thm_default',
    {
      name: 'Default',
      tokens: { colors: { primary: '#112233' }, fonts: { sans: 'Inter', serif: 'Lora', heading: 'Inter' } },
    },
    'src/data/site/themes/thm_default.json',
  ],
  [
    'section',
    'sec_cta',
    { section: { id: 's_cta1', type: 'prose', data: { body: 'Hello' } } },
    'src/data/site/sections/sec_cta.json',
  ],
  [
    'product',
    'prod_barrier_repair_guide',
    {
      slug: 'barrier-repair-guide',
      presentation: { title: 'The Barrier Repair Guide' },
      commerce: {
        provider: 'stripe',
        mode: 'fixed',
        price: { amount_cents: 1900, currency: 'usd' },
        stripe: { product_id: 'prod_Abc123', price_id: 'price_Abc123' },
        availability: 'available',
      },
      fulfillment: {
        kind: 'download',
        artifact_ref: 'pdf/guides/0000000000000000000000000000000000000000000000000000000000000000.pdf',
        filename: 'barrier-repair-guide.pdf',
      },
    },
    'src/data/site/products/prod_barrier_repair_guide.json',
  ],
  [
    'tracking_config',
    'trk_drlurie',
    {
      providers: { own: { enabled: true, consent_class: 'essential', ingest_path: '/api/t' } },
      consent: { posture: 'geo-adaptive', restricted_regions: ['DE', 'FR', 'GB', 'CH'], honor_gpc: true },
      defaults: {
        page: ['pageview', 'scroll_depth', 'engagement'],
        section: ['section_impression', 'section_dwell', 'cta_click', 'form_start', 'form_submit'],
        content_item: ['read_progress', 'node_impression', 'node_dwell', 'completion'],
        product: ['buy_click'],
        navigation: ['nav_click'],
        taxonomy: ['term_view', 'tag_click'],
        outbound_links: true,
        utm_capture: true,
      },
    },
    'src/data/site/tracking.json',
  ],
];

test('materialize routes each object type to its per-type materializer and path convention', () => {
  for (const [objectType, objectId, body, expectedPath] of cases) {
    const result = materialize(objectType, objectId, body, meta);
    assert.equal(result.path, expectedPath);
  }
});

test('materialize routes content_item to the article export path (W7.3)', () => {
  const result = materialize(
    'content_item',
    'req_agent_probe_20260713_01',
    {
      slug: 'probe-article',
      title: 'Probe',
      nodes: [{ id: 'n_a1', kind: 'content', public: { body: 'One paragraph.' }, private: { strategy: 'summary' } }],
    },
    meta
  );
  assert.equal(result.path, 'src/data/site/articles/req_agent_probe_20260713_01.json');
  // The annotation layer is exported verbatim (the leak rule lives at the renderer).
  assert.match(result.content, /"strategy": "summary"/);
});

test('materialize rejects an unregistered object type at runtime', () => {
  assert.throws(() => {
    // @ts-expect-error - deliberately passing an unknown type to check the runtime guard
    materialize('widget', 'widget_x', {}, meta);
  }, /No materializer registered/);
});

test('materialize rejects a body that fails its per-type schema', () => {
  assert.throws(() => materialize('navigation', 'nav_footer', { role: 'not-a-role', groups: [] }, meta));
});
