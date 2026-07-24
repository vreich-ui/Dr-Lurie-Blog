import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OBJECT_STORE_MARKER_VALUE,
  objectRecordKey,
  objectStatusIndexKey,
  objectStatusIndexPrefix,
  type ObjectRecordStatus,
} from '../../netlify/lib/object-store-keys.js';
import type { ObjectType } from '../../packages/core/schema/object-record-v1.js';

const cases: Array<[ObjectType, string, string]> = [
  ['site', 'site_drlurie', 'objects/site/by-id/site_drlurie.json'],
  ['page', 'page_home', 'objects/page/by-id/page_home.json'],
  ['section', 'sec_newsletter_signup', 'objects/section/by-id/sec_newsletter_signup.json'],
  ['navigation', 'nav_footer_home', 'objects/navigation/by-id/nav_footer_home.json'],
  ['taxonomy', 'tax_drlurie', 'objects/taxonomy/by-id/tax_drlurie.json'],
  ['template', 'tpl_home', 'objects/template/by-id/tpl_home.json'],
  ['section_template', 'stpl_hero_landing', 'objects/section_template/by-id/stpl_hero_landing.json'],
  ['theme', 'thm_drlurie_default', 'objects/theme/by-id/thm_drlurie_default.json'],
  ['product', 'prod_barrier_repair_guide', 'objects/product/by-id/prod_barrier_repair_guide.json'],
  ['content_item', 'req_smoke_pdf_cta_20260630_01', 'objects/content_item/by-id/req_smoke_pdf_cta_20260630_01.json'],
];

test('objectRecordKey builds by-id keys for every object type', () => {
  for (const [objectType, objectId, expected] of cases) {
    assert.equal(objectRecordKey(objectType, objectId), expected);
  }
});

test('objectStatusIndexKey builds marker-blob status index keys', () => {
  const statuses: ObjectRecordStatus[] = ['active', 'archived'];

  for (const [objectType, objectId] of cases) {
    for (const status of statuses) {
      assert.equal(
        objectStatusIndexKey(objectType, status, objectId),
        `objects/${objectType}/index/by-status/${status}/${objectId}`
      );
    }
  }

  assert.equal(OBJECT_STORE_MARKER_VALUE, '');
});

test('objectStatusIndexPrefix builds list prefixes for status indexes', () => {
  assert.equal(objectStatusIndexPrefix('page', 'active'), 'objects/page/index/by-status/active/');
  assert.equal(objectStatusIndexPrefix('navigation', 'archived'), 'objects/navigation/index/by-status/archived/');
});
