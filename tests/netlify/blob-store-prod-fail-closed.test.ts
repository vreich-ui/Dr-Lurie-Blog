/**
 * W14 T14.4 — the file-backed blob fallback must never run in a production
 * function runtime.
 *
 * Found live: a freshly provisioned site without NETLIFY_SITE_ID failed blob
 * runtime detection, silently fell back to the TEST store, read empty
 * inventories, and died at the first write against the lambda's read-only
 * disk. Detection failure must be loud.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { getNetlifyBlobStore } from '../../packages/core/server/lib/blob-store.js';

const NETLIFY_KEYS = ['NETLIFY', 'NETLIFY_SITE_ID', 'SITE_ID', 'NETLIFY_BLOBS_TOKEN', 'NETLIFY_AUTH_TOKEN'] as const;

const withEnv = async (env: Record<string, string | undefined>, run: () => Promise<void>) => {
  const saved = new Map<string, string | undefined>();
  for (const key of [...NETLIFY_KEYS, 'LAMBDA_TASK_ROOT', 'AWS_LAMBDA_FUNCTION_NAME']) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(env)) if (value !== undefined) process.env[key] = value;
  try {
    await run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test('a production lambda with failed blob detection throws instead of using the test store', async () => {
  await withEnv({ LAMBDA_TASK_ROOT: '/var/task' }, async () => {
    await assert.rejects(() => getNetlifyBlobStore('site-objects', {}), /refusing the file-backed test fallback/);
  });
});

test('local dev (no lambda markers) still gets the file-backed fallback', async () => {
  await withEnv({}, async () => {
    const store = await getNetlifyBlobStore('site-objects', {});
    assert.ok(store, 'file-backed store is still available outside a lambda');
  });
});
