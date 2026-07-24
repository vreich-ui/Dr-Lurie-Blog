/**
 * W11 T11.3 — SiteBinding adversarial set.
 *
 * The core server layer is parameterized by a per-site binding carrying env-var
 * NAMES (never values), read live at call time. These tests pin the security
 * properties the seam exists for:
 *
 *   1. Cross-binding isolation — two bindings in one process never share
 *      resolved credentials: each read resolves through its own name list,
 *      and nothing is cached at module scope.
 *   2. Fails closed — a binding whose variables are absent (or empty) resolves
 *      to nothing, even while a sibling binding's variables hold values.
 *   3. The platform name chains are pinned in ORDER — the pre-W11 `A || B`
 *      fallback chains are load-bearing wire behavior; silent reordering is a
 *      credential-resolution change and must fail here.
 */
import '../../src/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getBlobStoreSourceDiagnostics,
  getSiteObjectsBlobStore,
} from '../../packages/core/server/lib/blob-store.js';
import {
  PLATFORM_ENV_NAMES,
  readBindingVar,
  readBoundEnv,
  type SiteBinding,
} from '../../packages/core/server/lib/site-binding.js';

const bindingA: SiteBinding = {
  siteId: 'site_alpha',
  env: {
    ...PLATFORM_ENV_NAMES,
    blobSiteId: ['ALPHA_BLOB_SITE_ID'],
    blobToken: ['ALPHA_BLOB_TOKEN'],
    publishSecret: ['ALPHA_PUBLISH_SECRET'],
  },
  dataRoot: 'sites/alpha/data/site',
};

const bindingB: SiteBinding = {
  siteId: 'site_beta',
  env: {
    ...PLATFORM_ENV_NAMES,
    blobSiteId: ['BETA_BLOB_SITE_ID'],
    blobToken: ['BETA_BLOB_TOKEN'],
    publishSecret: ['BETA_PUBLISH_SECRET'],
  },
  dataRoot: 'sites/beta/data/site',
};

const TEST_VARS = [
  'ALPHA_BLOB_SITE_ID',
  'ALPHA_BLOB_TOKEN',
  'ALPHA_PUBLISH_SECRET',
  'BETA_BLOB_SITE_ID',
  'BETA_BLOB_TOKEN',
  'BETA_PUBLISH_SECRET',
];

const clearTestVars = () => {
  for (const name of TEST_VARS) delete process.env[name];
};

test('readBoundEnv: missing and empty-string variables are absent; first non-empty name wins', () => {
  clearTestVars();
  assert.equal(readBoundEnv(['ALPHA_PUBLISH_SECRET']), undefined, 'unset -> undefined');
  process.env.ALPHA_PUBLISH_SECRET = '';
  assert.equal(readBoundEnv(['ALPHA_PUBLISH_SECRET']), undefined, 'empty string -> absent (fails closed)');
  process.env.ALPHA_PUBLISH_SECRET = 'alpha-secret';
  process.env.BETA_PUBLISH_SECRET = 'beta-secret';
  assert.equal(
    readBoundEnv(['ALPHA_PUBLISH_SECRET', 'BETA_PUBLISH_SECRET']),
    'alpha-secret',
    'first name in the list wins'
  );
  clearTestVars();
});

test('cross-binding isolation: each binding resolves ONLY its own variables, live at every call', () => {
  clearTestVars();
  process.env.ALPHA_PUBLISH_SECRET = 'alpha-secret';
  process.env.BETA_PUBLISH_SECRET = 'beta-secret';

  assert.equal(readBindingVar(bindingA, 'publishSecret'), 'alpha-secret');
  assert.equal(readBindingVar(bindingB, 'publishSecret'), 'beta-secret');

  // Rotate ONLY beta's secret: alpha's next read is unaffected, beta's next
  // read sees the new value immediately — proving no cross-binding sharing
  // and no stale module-scope caching in either direction.
  process.env.BETA_PUBLISH_SECRET = 'beta-rotated';
  assert.equal(readBindingVar(bindingA, 'publishSecret'), 'alpha-secret');
  assert.equal(readBindingVar(bindingB, 'publishSecret'), 'beta-rotated');

  // Delete beta's secret entirely: beta fails closed while alpha still resolves.
  delete process.env.BETA_PUBLISH_SECRET;
  assert.equal(readBindingVar(bindingA, 'publishSecret'), 'alpha-secret');
  assert.equal(readBindingVar(bindingB, 'publishSecret'), undefined);
  clearTestVars();
});

test('blob store credentials: per-binding resolution and fail-closed, observed through diagnostics', () => {
  clearTestVars();
  process.env.ALPHA_BLOB_SITE_ID = 'alpha-site-1234';
  process.env.ALPHA_BLOB_TOKEN = 'alpha-token';

  const alpha = getBlobStoreSourceDiagnostics('site-objects', undefined, bindingA);
  const beta = getBlobStoreSourceDiagnostics('site-objects', undefined, bindingB);

  assert.equal(alpha.explicitApiConfigUsed, true, 'alpha has creds -> explicit API config');
  assert.equal(alpha.siteId.envVar, 'ALPHA_BLOB_SITE_ID', 'alpha reports ITS OWN env var name');
  assert.equal(alpha.siteId.redacted, '…1234', 'diagnostics stay redacted');
  assert.equal(beta.explicitApiConfigUsed, false, 'beta has NO creds -> fails closed, never borrows alpha');
  assert.equal(beta.siteId.envVar, undefined);
  clearTestVars();
});

test('store handles: two bindings never share a store instance', async () => {
  clearTestVars();
  // No Netlify runtime in tests -> both fall back to the local file-backed
  // store, but each call must construct its own handle (no shared cache).
  const a = await getSiteObjectsBlobStore(undefined, bindingA);
  const b = await getSiteObjectsBlobStore(undefined, bindingB);
  assert.notEqual(a, b, 'store handles are per-call/per-binding, never a shared module singleton');
});

test('platform name chains are pinned byte-for-byte (order is wire behavior)', () => {
  assert.deepEqual(PLATFORM_ENV_NAMES.blobSiteId, ['NETLIFY_SITE_ID', 'SITE_ID']);
  assert.deepEqual(PLATFORM_ENV_NAMES.blobToken, ['NETLIFY_BLOBS_TOKEN', 'NETLIFY_AUTH_TOKEN']);
  assert.deepEqual(PLATFORM_ENV_NAMES.publishSecret, ['PUBLISH_SECRET', 'NETLIFY_PUBLISH_SECRET']);
  assert.deepEqual(PLATFORM_ENV_NAMES.mcpAuthToken, ['MCP_HTTP_AUTH_TOKEN']);
  assert.deepEqual(PLATFORM_ENV_NAMES.gitContentToken, ['GITHUB_CONTENT_TOKEN']);
  assert.deepEqual(PLATFORM_ENV_NAMES.gitRepository, ['GITHUB_REPOSITORY']);
  assert.deepEqual(PLATFORM_ENV_NAMES.gitBranch, ['GITHUB_BRANCH', 'BRANCH']);
  assert.deepEqual(PLATFORM_ENV_NAMES.buildHookUrl, ['NETLIFY_BUILD_HOOK_URL']);
  assert.deepEqual(PLATFORM_ENV_NAMES.deployLookupToken, ['NETLIFY_AUTH_TOKEN', 'NETLIFY_BLOBS_TOKEN']);
});
