import '../../src/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  DEFAULT_PURCHASE_TOKEN_TTL_MS,
  mintPurchaseToken,
  purchaseTokenHash,
  purchaseTokenSecret,
  verifyPurchaseToken,
  type PurchaseTokenPayload,
} from '../../packages/core/server/lib/purchase-tokens.js';

const SECRET = 'unit-test-secret-0123456789abcdef';
const NOW = Date.parse('2026-07-12T12:00:00.000Z');

const payload = (): PurchaseTokenPayload => ({
  order_key: 'cs_test_a1B2c3',
  artifact_ref: 'pdf/guides/abc.pdf',
  exp: NOW + DEFAULT_PURCHASE_TOKEN_TTL_MS,
});

test('mint → verify round-trips the payload', () => {
  const token = mintPurchaseToken(payload(), SECRET);
  const verified = verifyPurchaseToken(token, SECRET, NOW);
  assert.ok(verified.ok);
  assert.deepEqual(verified.ok && verified.payload, payload());
});

test('expired tokens are refused with a distinct reason (72h default TTL)', () => {
  const token = mintPurchaseToken(payload(), SECRET);
  const atExpiry = verifyPurchaseToken(token, SECRET, NOW + DEFAULT_PURCHASE_TOKEN_TTL_MS);
  assert.deepEqual(atExpiry, { ok: false, reason: 'expired' });
  assert.equal(DEFAULT_PURCHASE_TOKEN_TTL_MS, 72 * 60 * 60 * 1000);
});

test('tampering with the payload or signature invalidates the token', () => {
  const token = mintPurchaseToken(payload(), SECRET);
  const [body, signature] = token.split('.');

  const otherBody = Buffer.from(JSON.stringify({ ...payload(), artifact_ref: 'pdf/guides/other.pdf' })).toString(
    'base64url'
  );
  assert.deepEqual(verifyPurchaseToken(`${otherBody}.${signature}`, SECRET, NOW), {
    ok: false,
    reason: 'bad_signature',
  });

  const wrongSecret = verifyPurchaseToken(token, 'another-secret-0123456789abcdef', NOW);
  assert.deepEqual(wrongSecret, { ok: false, reason: 'bad_signature' });

  assert.equal(verifyPurchaseToken(body, SECRET, NOW).ok, false); // no signature part
  assert.equal(verifyPurchaseToken('..', SECRET, NOW).ok, false);
  assert.equal(verifyPurchaseToken('', SECRET, NOW).ok, false);
});

test('a signed but non-payload-shaped body is malformed, not a crash', () => {
  const bogus = Buffer.from(JSON.stringify({ hello: 'world' })).toString('base64url');
  const signature = createHmac('sha256', SECRET).update(bogus).digest('base64url');
  assert.deepEqual(verifyPurchaseToken(`${bogus}.${signature}`, SECRET, NOW), { ok: false, reason: 'malformed' });
});

test('purchaseTokenHash emits the sha256:<hex> shape order records store', () => {
  const token = mintPurchaseToken(payload(), SECRET);
  assert.match(purchaseTokenHash(token), /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(purchaseTokenHash(token), purchaseTokenHash(`${token}x`));
});

test('purchaseTokenSecret refuses short/absent secrets (503 path, never a weak fallback)', () => {
  assert.equal(purchaseTokenSecret({}), undefined);
  assert.equal(purchaseTokenSecret({ PURCHASE_TOKEN_SECRET: 'short' }), undefined);
  assert.equal(purchaseTokenSecret({ PURCHASE_TOKEN_SECRET: `  ${SECRET}  ` }), SECRET);
});
