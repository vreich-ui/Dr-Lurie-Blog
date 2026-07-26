import '../../sites/drlurie/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canvasUploadRequestId,
  createCanvasUploadIntent,
  parseCanvasUploadIntentRequest,
} from '../../packages/core/server/lib/canvas-upload-intent.js';
import { verifyArtifactUploadToken } from '../../packages/core/server/lib/artifact-upload.js';

const SECRET = 'canvas-intent-test-secret';
const NOW_MS = Date.parse('2026-07-12T12:00:00Z');
const SHA = 'a'.repeat(64);

const validRequest = {
  object_id: 'page_about',
  content_type: 'image/png',
  size_bytes: 1234,
  sha256: SHA,
};

test('parseCanvasUploadIntentRequest accepts the canvas body and rejects malformed ones', () => {
  assert.deepEqual(parseCanvasUploadIntentRequest(validRequest), validRequest);

  for (const bad of [
    undefined,
    null,
    'string',
    [],
    {},
    { ...validRequest, object_id: '' },
    { ...validRequest, content_type: 42 },
    { ...validRequest, size_bytes: 12.5 },
    { ...validRequest, sha256: undefined },
  ]) {
    assert.equal(parseCanvasUploadIntentRequest(bad), undefined);
  }
});

test('canvasUploadRequestId mints the standard req_canvas_<object>_<date>_01 shape', () => {
  assert.equal(canvasUploadRequestId('page_about', NOW_MS), 'req_canvas_page_about_20260712_01');
  // Non-snake object ids normalize (sec_about_intro stays; dashes/case fold).
  assert.equal(canvasUploadRequestId('Sec-About-Intro', NOW_MS), 'req_canvas_sec_about_intro_20260712_01');
  assert.equal(canvasUploadRequestId('///', NOW_MS), undefined);
});

test('createCanvasUploadIntent mints a verifiable token whose claims match the echo', () => {
  const result = createCanvasUploadIntent(validRequest, { nowMs: NOW_MS, secret: SECRET });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.claims.requestId, 'req_canvas_page_about_20260712_01');
  assert.equal(result.claims.artifactKind, 'image');
  assert.equal(result.claims.contentType, 'image/png');
  assert.equal(result.claims.filename, 'canvas-upload.png');
  assert.equal(result.claims.expectedSizeBytes, 1234);
  assert.equal(result.claims.expectedSha256, SHA);
  assert.equal(result.publicPath, `/img/req_canvas_page_about_20260712_01/${SHA}.png`);
  assert.ok(result.maxBytes > 0);

  // The token round-trips through the SAME verifier the upload endpoint uses,
  // with claims identical to the echo the client copies into X-Artifact-*.
  const verified = verifyArtifactUploadToken({ token: result.token, nowMs: NOW_MS, secret: SECRET });
  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  const { expiresAt, ...claims } = verified.claims;
  assert.ok(expiresAt > NOW_MS);
  assert.deepEqual(claims, result.claims);
});

test('createCanvasUploadIntent maps jpeg/webp types and normalizes parameters', () => {
  const jpeg = createCanvasUploadIntent(
    { ...validRequest, content_type: 'image/jpeg; charset=binary', sha256: SHA.toUpperCase() },
    { nowMs: NOW_MS, secret: SECRET }
  );
  assert.equal(jpeg.ok, true);
  if (!jpeg.ok) return;
  assert.equal(jpeg.claims.contentType, 'image/jpeg');
  assert.equal(jpeg.claims.filename, 'canvas-upload.jpg');
  assert.equal(jpeg.claims.expectedSha256, SHA);

  const webp = createCanvasUploadIntent(
    { ...validRequest, content_type: 'image/webp' },
    { nowMs: NOW_MS, secret: SECRET }
  );
  assert.equal(webp.ok, true);
  if (!webp.ok) return;
  assert.match(webp.publicPath, /\.webp$/);
});

test('createCanvasUploadIntent rejects types the save-side image validation would refuse', () => {
  for (const contentType of ['image/svg+xml', 'image/gif', 'application/pdf', 'text/html', '']) {
    const result = createCanvasUploadIntent(
      { ...validRequest, content_type: contentType },
      { nowMs: NOW_MS, secret: SECRET }
    );
    assert.equal(result.ok, false, `expected rejection for ${contentType || '(empty)'}`);
    if (result.ok) continue;
    assert.equal(result.statusCode, 400);
  }
});

test('createCanvasUploadIntent rejects bad sizes and digests', () => {
  const zero = createCanvasUploadIntent({ ...validRequest, size_bytes: 0 }, { nowMs: NOW_MS, secret: SECRET });
  assert.equal(zero.ok, false);
  if (!zero.ok) assert.equal(zero.statusCode, 400);

  const huge = createCanvasUploadIntent({ ...validRequest, size_bytes: 50_000_000 }, { nowMs: NOW_MS, secret: SECRET });
  assert.equal(huge.ok, false);
  if (!huge.ok) assert.equal(huge.statusCode, 413);

  const badSha = createCanvasUploadIntent({ ...validRequest, sha256: 'nope' }, { nowMs: NOW_MS, secret: SECRET });
  assert.equal(badSha.ok, false);
  if (!badSha.ok) assert.equal(badSha.statusCode, 400);
});

test('createCanvasUploadIntent fails closed when no signing secret is configured', () => {
  const previous = process.env.ARTIFACT_UPLOAD_TOKEN_SECRET;
  delete process.env.ARTIFACT_UPLOAD_TOKEN_SECRET;
  try {
    const result = createCanvasUploadIntent(validRequest, { nowMs: NOW_MS });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.statusCode, 500);
  } finally {
    if (previous !== undefined) process.env.ARTIFACT_UPLOAD_TOKEN_SECRET = previous;
  }
});
