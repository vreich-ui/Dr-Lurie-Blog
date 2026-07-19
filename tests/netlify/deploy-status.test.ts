import assert from 'node:assert/strict';
import test from 'node:test';

import { handler } from '../../netlify/functions/deploy-status.js';

// The handler composes getDeployReceiptByCommit + getPublishedProductionDeploy,
// both on the global fetch. Same stub-by-URL + pinned-env discipline as
// production-release.test.ts.

const ENV_KEYS = ['NETLIFY_SITE_ID', 'SITE_ID', 'NETLIFY_AUTH_TOKEN', 'NETLIFY_BLOBS_TOKEN', 'PUBLISH_SECRET'] as const;

const withEnv = async (overrides: Partial<Record<(typeof ENV_KEYS)[number], string>>, fn: () => Promise<void>) => {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(overrides)) process.env[key] = value;
  try {
    await fn();
  } finally {
    for (const key of ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

type FetchRoute = (url: string) => Response | undefined;

const withFetch = async (route: FetchRoute, fn: () => Promise<void>) => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const response = route(url);
    if (!response) throw new Error(`unexpected fetch: ${url}`);
    return response;
  }) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
};

const jsonResponse = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

const CONFIGURED = { NETLIFY_SITE_ID: 'site-abc', NETLIFY_AUTH_TOKEN: 'tok-abc', PUBLISH_SECRET: 'pub-secret' };

const statusEvent = (body: Record<string, unknown>) => ({
  httpMethod: 'POST',
  headers: { 'content-type': 'application/json', 'x-publish-key': 'pub-secret' },
  body: JSON.stringify(body),
});

const parseBody = (response: { body: string }) => JSON.parse(response.body) as Record<string, unknown>;

// /sites/{id}/deploys contains both substrings — check /deploys first.
const route =
  (publishedCommit?: string): FetchRoute =>
  (url) => {
    if (url.includes('/deploys')) {
      return jsonResponse([{ id: 'd1', state: 'ready', commit_ref: 'abc123', ssl_url: 'https://drlurie.com' }]);
    }
    if (url.includes('/sites/')) {
      if (!publishedCommit) return new Response('nope', { status: 500 });
      return jsonResponse({ published_deploy: { id: 'pub1', state: 'ready', commit_ref: publishedCommit } });
    }
    return undefined;
  };

test('deploy_status reports productionConfirmed:true when the published deploy serves the commit', async () => {
  await withEnv(CONFIGURED, async () => {
    await withFetch(route('abc123'), async () => {
      const response = await handler(statusEvent({ commit: 'abc123' }));
      assert.equal(response.statusCode, 200);
      const body = parseBody(response);
      assert.equal(body.deployStatus, 'ready');
      assert.equal(body.productionConfirmed, true);
      assert.equal((body.publishedDeploy as Record<string, unknown>).deployId, 'pub1');
    });
  });
});

test('deploy_status reports productionConfirmed:false for a ready-but-unpublished commit', async () => {
  await withEnv(CONFIGURED, async () => {
    await withFetch(route('oldsha999'), async () => {
      const body = parseBody(await handler(statusEvent({ commit: 'abc123' })));
      assert.equal(body.deployStatus, 'ready', 'the receipt itself still reads ready');
      assert.equal(body.productionConfirmed, false);
      assert.equal((body.publishedDeploy as Record<string, unknown>).commit, 'oldsha999');
    });
  });
});

test('deploy_status omits the published fields when the site lookup is unavailable (unknown, not "not live")', async () => {
  await withEnv(CONFIGURED, async () => {
    await withFetch(route(undefined), async () => {
      const body = parseBody(await handler(statusEvent({ commit: 'abc123' })));
      assert.equal(body.deployStatus, 'ready');
      assert.ok(!('productionConfirmed' in body));
      assert.ok(!('publishedDeploy' in body));
    });
  });
});
