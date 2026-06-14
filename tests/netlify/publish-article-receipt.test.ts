import assert from 'node:assert/strict';
import test from 'node:test';

import { handler } from '../../netlify/functions/publish-article.js';

const secret = 'publish-receipt-secret';

const configurePublishEnv = () => {
  process.env.PUBLISH_SECRET = secret;
  process.env.GITHUB_CONTENT_TOKEN = 'github-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';
};

const installFetchMock = (commitSha: string, deploys: unknown[] = []) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url.startsWith('https://api.netlify.com/')) return Response.json(deploys);
    if (url.includes('/contents/src/data/post/receipt-test.md')) return new Response('not found', { status: 404 });
    if (url.includes('/git/ref/heads/main')) return Response.json({ object: { sha: 'base-sha' } });
    if (url.endsWith('/git/commits/base-sha')) return Response.json({ tree: { sha: 'base-tree' } });
    if (url.endsWith('/git/blobs') && method === 'POST') return Response.json({ sha: 'blob-sha' });
    if (url.endsWith('/git/trees') && method === 'POST') return Response.json({ sha: 'tree-sha' });
    if (url.endsWith('/git/commits') && method === 'POST') return Response.json({ sha: commitSha });
    if (url.includes('/git/refs/heads/main') && method === 'PATCH') return Response.json({ ok: true });

    return new Response(`unexpected ${method} ${url}`, { status: 500 });
  }) as typeof fetch;
  return () => (globalThis.fetch = originalFetch);
};

const publish = (extra: Record<string, unknown> = {}) =>
  handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', 'x-publish-key': secret },
    body: JSON.stringify({
      slug: 'receipt-test',
      title: 'Receipt Test',
      markdown: '# Receipt Test',
      overwrite: true,
      ...extra,
    }),
  });

test('publish-article returns fallback queued receipt when Netlify env is missing', async () => {
  configurePublishEnv();
  delete process.env.NETLIFY_SITE_ID;
  delete process.env.SITE_ID;
  delete process.env.NETLIFY_AUTH_TOKEN;
  delete process.env.NETLIFY_BLOBS_TOKEN;
  const restore = installFetchMock('fallback-commit');

  try {
    const response = await publish();
    const body = JSON.parse(response.body) as Record<string, unknown>;
    assert.equal(response.statusCode, 201, response.body);
    assert.equal(body.commit, 'fallback-commit');
    assert.equal(body.deployStatus, 'queued');
  } finally {
    restore();
  }
});

test('publish-article matches Netlify deploy receipts by commit_ref', async () => {
  configurePublishEnv();
  process.env.NETLIFY_SITE_ID = 'site-id';
  process.env.NETLIFY_AUTH_TOKEN = 'token';
  const restore = installFetchMock('matched-commit', [
    { id: 'other', commit_ref: 'other-commit', state: 'ready' },
    {
      id: 'deploy-matched',
      commit_ref: 'matched-commit',
      state: 'ready',
      deploy_ssl_url: 'https://deploy.example.test',
      ssl_url: 'https://production.example.test',
    },
  ]);

  try {
    const response = await publish();
    const body = JSON.parse(response.body) as Record<string, unknown>;
    assert.equal(response.statusCode, 201, response.body);
    assert.equal(body.deployId, 'deploy-matched');
    assert.equal(body.commit, 'matched-commit');
    assert.equal(body.deployStatus, 'ready');
  } finally {
    restore();
  }
});

test('publish-article wait timeout returns deployStatus timed_out', async () => {
  configurePublishEnv();
  process.env.NETLIFY_SITE_ID = 'site-id';
  process.env.NETLIFY_AUTH_TOKEN = 'token';
  const restore = installFetchMock('timeout-commit', [
    { id: 'deploy-timeout', commit_ref: 'timeout-commit', state: 'building' },
  ]);

  try {
    const response = await publish({ waitForDeploy: true, deployWaitTimeoutSeconds: 0 });
    const body = JSON.parse(response.body) as Record<string, unknown>;
    assert.equal(response.statusCode, 201, response.body);
    assert.equal(body.deployId, 'deploy-timeout');
    assert.equal(body.deployStatus, 'timed_out');
  } finally {
    restore();
  }
});
