import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  MARGINALIA_INDEX_MARKER_VALUE,
  marginaliaCommentKey,
  marginaliaCommentsPrefix,
  marginaliaThreadIndexKey,
  marginaliaThreadIndexPrefix,
  marginaliaThreadKey,
} from './marginalia-store-keys.js';

describe('marginalia-store-keys', () => {
  it('builds the thread header key', () => {
    assert.strictEqual(
      marginaliaThreadKey('page', 'page_home', 'mgt_1'),
      'marginalia/page/page_home/threads/mgt_1.json'
    );
  });

  it('builds a comment key nested under its thread', () => {
    assert.strictEqual(
      marginaliaCommentKey('page', 'page_home', 'mgt_1', 'mgc_1'),
      'marginalia/page/page_home/threads/mgt_1/comments/mgc_1.json'
    );
  });

  it('builds the comments prefix for one thread — every comment key starts with it', () => {
    const prefix = marginaliaCommentsPrefix('page', 'page_home', 'mgt_1');
    assert.strictEqual(prefix, 'marginalia/page/page_home/threads/mgt_1/comments/');
    assert.ok(marginaliaCommentKey('page', 'page_home', 'mgt_1', 'mgc_1').startsWith(prefix));
  });

  it('builds the index marker key nested under the index prefix', () => {
    const prefix = marginaliaThreadIndexPrefix('content_item', 'req_20260805_abc');
    const key = marginaliaThreadIndexKey('content_item', 'req_20260805_abc', 'mgt_9');
    assert.strictEqual(prefix, 'marginalia/content_item/req_20260805_abc/index/');
    assert.ok(key.startsWith(prefix));
    assert.strictEqual(key.slice(prefix.length), 'mgt_9');
  });

  it('scopes keys by object type AND id — two different objects never collide', () => {
    assert.notStrictEqual(marginaliaThreadIndexPrefix('page', 'page_a'), marginaliaThreadIndexPrefix('page', 'page_b'));
    assert.notStrictEqual(
      marginaliaThreadIndexPrefix('page', 'page_home'),
      marginaliaThreadIndexPrefix('section', 'page_home')
    );
  });

  it('the index marker value is empty — a listable-by-prefix presence marker only', () => {
    assert.strictEqual(MARGINALIA_INDEX_MARKER_VALUE, '');
  });
});
