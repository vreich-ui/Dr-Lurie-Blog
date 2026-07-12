import assert from 'node:assert/strict';
import test from 'node:test';

import { sectionAnnotationAttrs } from '../../src/lib/renderer/section-annotations.js';

test('an inline section is annotated with the page identity only', () => {
  const attrs = sectionAnnotationAttrs('page_home', { id: 's_hero', type: 'hero' });
  assert.deepEqual(attrs, {
    'data-cms-object-id': 'page_home',
    'data-cms-section-id': 's_hero',
    'data-cms-section-type': 'hero',
  });
});

test('a shared_ref-derived section additionally names the shared object it belongs to', () => {
  const attrs = sectionAnnotationAttrs('page_home', {
    id: 's_newsletter',
    type: 'newsletter_signup',
    sharedObjectId: 'sec_newsletter_signup',
  });
  assert.equal(attrs['data-cms-object-id'], 'page_home');
  assert.equal(attrs['data-cms-section-id'], 's_newsletter');
  assert.equal(attrs['data-cms-shared-object'], 'sec_newsletter_signup');
});

test('a related content_grid announces its selection algorithm to the canvas', () => {
  const attrs = sectionAnnotationAttrs('page_article', {
    id: 's_related',
    type: 'content_grid',
    data: { heading: 'Related Posts', source: { kind: 'related', algorithm: 'tag_similarity' }, limit: 4 },
  });
  assert.equal(attrs['data-cms-related-algorithm'], 'tag_similarity');
});

test('query/manual/cards grids and other types carry NO algorithm annotation', () => {
  const query = sectionAnnotationAttrs('page_home', {
    id: 's_grid',
    type: 'content_grid',
    data: { source: { kind: 'query', query: {} }, limit: 4 },
  });
  assert.equal('data-cms-related-algorithm' in query, false);
  const prose = sectionAnnotationAttrs('page_home', { id: 's_p', type: 'prose', data: { body: '<p>x</p>' } });
  assert.equal('data-cms-related-algorithm' in prose, false);
});
