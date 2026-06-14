import assert from 'node:assert/strict';
import test from 'node:test';

import { handler } from '../../netlify/functions/deploy-status.js';

const secret = 'deploy-status-test-secret';

const call = (body: Record<string, unknown>) =>
  handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', 'x-publish-key': secret },
    body: JSON.stringify(body),
  });

test('deploy-status rejects requests missing commit and deployId', async () => {
  process.env.PUBLISH_SECRET = secret;
  const response = await call({});
  const body = JSON.parse(response.body) as { ok: boolean; error: string; issues: Array<{ message: string }> };

  assert.equal(response.statusCode, 400);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'Invalid request fields.');
  assert.match(body.issues[0].message, /commit or deployId/);
});

test('deploy-status returns safe queued metadata when Netlify is unconfigured', async () => {
  process.env.PUBLISH_SECRET = secret;
  delete process.env.NETLIFY_SITE_ID;
  delete process.env.SITE_ID;
  delete process.env.NETLIFY_AUTH_TOKEN;
  delete process.env.NETLIFY_BLOBS_TOKEN;

  const response = await call({ commit: 'queued-commit' });
  const body = JSON.parse(response.body) as { ok: boolean; commit: string; deployStatus: string; errorMessage: string };

  assert.equal(response.statusCode, 200);
  assert.equal(body.ok, true);
  assert.equal(body.commit, 'queued-commit');
  assert.equal(body.deployStatus, 'queued');
  assert.match(body.errorMessage, /not configured/);
});

test('deploy-status returns a normalized matching deploy receipt', async () => {
  process.env.PUBLISH_SECRET = secret;
  process.env.NETLIFY_SITE_ID = 'site-id';
  process.env.NETLIFY_AUTH_TOKEN = 'token';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    Response.json([
      {
        id: 'deploy-1',
        deploy_ssl_url: 'https://deploy.example.test',
        ssl_url: 'https://production.example.test',
        commit_ref: 'matching-commit',
        state: 'ready',
        created_at: '2026-06-14T00:00:00.000Z',
        published_at: '2026-06-14T00:01:00.000Z',
      },
    ])) as typeof fetch;

  try {
    const response = await call({ commit: 'matching-commit' });
    const body = JSON.parse(response.body) as Record<string, unknown>;

    assert.equal(response.statusCode, 200);
    assert.equal(body.deployId, 'deploy-1');
    assert.equal(body.deployUrl, 'https://deploy.example.test');
    assert.equal(body.productionUrl, 'https://production.example.test');
    assert.equal(body.commit, 'matching-commit');
    assert.equal(body.deployStatus, 'ready');
    assert.equal(body.finishedAt, '2026-06-14T00:01:00.000Z');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
