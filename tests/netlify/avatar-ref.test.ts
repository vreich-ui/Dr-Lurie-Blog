/**
 * T9.6 — update_me avatar validation. An avatar must be an uploaded image
 * artifact reference (image/<id>/<sha256>.<ext>), never a URL or data URI.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { isTrustedAvatarRef } from '../../netlify/functions/admin-users.js';

const SHA = 'a'.repeat(64);

test('accepts a well-formed image artifact reference', () => {
  assert.equal(isTrustedAvatarRef(`image/req_avatar_wolf_20260717_01/${SHA}.png`), true);
  assert.equal(isTrustedAvatarRef(`image/obj123/${SHA}.webp`), true);
});

test('rejects URLs, data URIs, and non-image refs', () => {
  assert.equal(isTrustedAvatarRef('https://example.com/me.png'), false);
  assert.equal(isTrustedAvatarRef('http://x/y.png'), false);
  assert.equal(isTrustedAvatarRef('data:image/png;base64,AAAA'), false);
  assert.equal(isTrustedAvatarRef(`pdf/req/${SHA}.pdf`), false); // pdf, not an image
  assert.equal(isTrustedAvatarRef('image/only/two-parts.png'), false); // no valid sha segment
  assert.equal(isTrustedAvatarRef('/img/foo.png'), false);
  assert.equal(isTrustedAvatarRef(''), false);
});
