/**
 * `%term%` interpolation for per-term listing surfaces (W6/T6.1,
 * src/lib/renderer/listing-term.ts): one page object serves a route family,
 * so its copy is pattern copy — the loader substitutes the concrete term's
 * display label into every string value at build time.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { applyListingTerm, LISTING_TERM_TOKEN } from '../../src/lib/renderer/listing-term.js';

test('replaces the token in nested objects, arrays, and rich-text strings — keys untouched', () => {
  const body = {
    title: "Category '%term%'",
    seo: { description: 'Articles about %term%.' },
    sections: [
      {
        id: 's_head',
        type: 'lede',
        data: {
          heading: '%term%',
          body: '<p>All about <strong>%term%</strong> — twice: %term%.</p>',
          actions: [],
        },
      },
    ],
  };
  const out = applyListingTerm(body, 'Skin Health');
  assert.equal(out.title, "Category 'Skin Health'");
  assert.equal(out.seo.description, 'Articles about Skin Health.');
  assert.equal(out.sections[0]!.data.heading, 'Skin Health');
  assert.equal(out.sections[0]!.data.body, '<p>All about <strong>Skin Health</strong> — twice: Skin Health.</p>');
  assert.equal(out.sections[0]!.id, 's_head', 'non-token strings pass through');
});

test('deep-clones: the input is never mutated, and non-string values pass through', () => {
  const input = { heading: '%term%', limit: 5, flag: true, nothing: null, list: ['%term%', 7] };
  const out = applyListingTerm(input, 'Retinoids');
  assert.equal(input.heading, LISTING_TERM_TOKEN, 'input untouched');
  assert.deepEqual(out, { heading: 'Retinoids', limit: 5, flag: true, nothing: null, list: ['Retinoids', 7] });
  assert.notEqual(out.list, input.list);
});

test('a term containing the token itself cannot recurse (split/join, not replace-loop)', () => {
  assert.equal(applyListingTerm('Tag: %term%', 'weird %term% label'), 'Tag: weird %term% label');
});
