import assert from 'node:assert/strict';
import test from 'node:test';

import { materialize } from '../../netlify/lib/materialize.js';

const meta = { at: '2026-07-03T12:00:00.000Z', record_version: 3 };

test('golden: site materializes to src/data/site/site.json with __generated marker', () => {
  const body = {
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

  const result = materialize('site', 'site_drlurie', body, meta);

  assert.equal(result.path, 'src/data/site/site.json');
  assert.deepStrictEqual(JSON.parse(result.content), {
    __generated: { from: 'objects/site/by-id/site_drlurie.json', at: meta.at, record_version: meta.record_version },
    ...body,
  });
});

test('golden: page materializes to src/data/site/pages/{page_id}.json with inline sections', () => {
  const body = {
    route: '/about',
    pageType: 'standard',
    title: 'About',
    seo: { title: 'About Dr. Lurié' },
    sections: [
      {
        id: 's_hero1',
        type: 'hero',
        data: { heading: 'About Dr. Lurié', actions: [] },
      },
    ],
  };

  const result = materialize('page', 'page_about', body, meta);

  assert.equal(result.path, 'src/data/site/pages/page_about.json');
  assert.deepStrictEqual(JSON.parse(result.content), {
    __generated: { from: 'objects/page/by-id/page_about.json', at: meta.at, record_version: meta.record_version },
    ...body,
  });
});

test('golden: navigation materializes to src/data/site/navigation/{nav_id}.json', () => {
  const body = {
    role: 'footer',
    groups: [
      {
        id: 'g_primary',
        items: [{ id: 'n_privacy', label: 'Privacy', target: { kind: 'external', href: 'https://drlurie.com/privacy' } }],
      },
    ],
  };

  const result = materialize('navigation', 'nav_footer', body, meta);

  assert.equal(result.path, 'src/data/site/navigation/nav_footer.json');
  assert.deepStrictEqual(JSON.parse(result.content), {
    __generated: { from: 'objects/navigation/by-id/nav_footer.json', at: meta.at, record_version: meta.record_version },
    ...body,
  });
});

test('golden: template materializes to src/data/site/templates/{tpl_id}.json', () => {
  const body = {
    name: 'Standard Page',
    appliesTo: ['standard'],
    slots: [{ slotId: 'hero', allowed: ['hero'], required: true, repeatable: false }],
  };

  const result = materialize('template', 'tpl_standard', body, meta);

  assert.equal(result.path, 'src/data/site/templates/tpl_standard.json');
  assert.deepStrictEqual(JSON.parse(result.content), {
    __generated: { from: 'objects/template/by-id/tpl_standard.json', at: meta.at, record_version: meta.record_version },
    ...body,
  });
});

test('golden: shared section materializes to src/data/site/sections/{sec_id}.json', () => {
  const body = {
    section: {
      id: 's_newsletter1',
      type: 'newsletter_signup',
      data: { heading: 'Stay in the loop', formName: 'newsletter_main' },
    },
  };

  const result = materialize('section', 'sec_newsletter1', body, meta);

  assert.equal(result.path, 'src/data/site/sections/sec_newsletter1.json');
  assert.deepStrictEqual(JSON.parse(result.content), {
    __generated: { from: 'objects/section/by-id/sec_newsletter1.json', at: meta.at, record_version: meta.record_version },
    ...body,
  });
});

test('golden: taxonomy materializes to src/data/site/taxonomy.json — exact byte-for-byte output', () => {
  const body = {
    kinds: {
      category: { terms: [{ term_id: 't_skincare', slug: 'skincare', label: 'Skincare', status: 'active' }] },
      tag: { terms: [] },
    },
  };

  const result = materialize('taxonomy', 'tax_drlurie', body, { at: '2026-07-03T12:00:00.000Z', record_version: 1 });

  assert.equal(result.path, 'src/data/site/taxonomy.json');
  assert.equal(
    result.content,
    `{
  "__generated": {
    "at": "2026-07-03T12:00:00.000Z",
    "from": "objects/taxonomy/by-id/tax_drlurie.json",
    "record_version": 1
  },
  "kinds": {
    "category": {
      "terms": [
        {
          "label": "Skincare",
          "slug": "skincare",
          "status": "active",
          "term_id": "t_skincare"
        }
      ]
    },
    "tag": {
      "terms": []
    }
  }
}
`
  );
});
