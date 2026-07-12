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
