import assert from 'node:assert/strict';
import test from 'node:test';

import { handler } from '../../netlify/functions/run-publisher-agent.js';

const secret = 'run-publisher-receipt-secret';

const configure = (publishResult: Record<string, unknown>) => {
  process.env.NODE_ENV = 'test';
  process.env.PUBLISH_SECRET = secret;
  process.env.NETLIFY_PUBLISH_SECRET = secret;
  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.NETLIFY_PUBLISH_ENDPOINT = 'https://site.example.test/.netlify/functions/publish-article';
  process.env.RUN_PUBLISHER_AGENT_TEST_RESULT = JSON.stringify({
    success: true,
    ok: true,
    payload: {
      articlePath: 'src/data/post/agent-receipt.md',
      commitMessage: 'Publish',
      imageCount: 0,
      overwrite: true,
      slug: 'agent-receipt',
    },
    ...publishResult,
  });
};

const call = () =>
  handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', 'x-publish-key': secret },
    body: JSON.stringify({
      slug: 'agent-receipt',
      title: 'Agent Receipt',
      markdown: '# Agent Receipt',
      overwrite: true,
    }),
  });

const installFetch = (options: { deployStatus?: string; verify?: boolean } = {}) => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith('https://api.netlify.com/')) {
      return Response.json([
        {
          id: 'deploy-polled',
          commit_ref: 'queued-commit',
          state: options.deployStatus ?? 'ready',
          ssl_url: 'https://production.example.test',
        },
      ]);
    }
    if (url.endsWith('/.netlify/functions/verify-article-images')) {
      return Response.json({ verified: options.verify === true });
    }
    return new Response('unexpected', { status: 500 });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = originalFetch) };
};

test('run-publisher-agent final response includes deployReceipt', async () => {
  configure({ commit: 'ready-commit', deployStatus: 'ready', productionUrl: 'https://production.example.test' });
  const fetchMock = installFetch({ verify: true });
  try {
    const body = JSON.parse((await call()).body) as { deployReceipt?: Record<string, unknown> };
    assert.equal(body.deployReceipt?.commit, 'ready-commit');
    assert.equal(body.deployReceipt?.deployStatus, 'ready');
  } finally {
    fetchMock.restore();
  }
});

test('run-publisher-agent polls deploy status for queued publish with a commit', async () => {
  configure({ commit: 'queued-commit', deployStatus: 'queued' });
  process.env.NETLIFY_SITE_ID = 'site-id';
  process.env.NETLIFY_AUTH_TOKEN = 'token';
  const fetchMock = installFetch({ deployStatus: 'ready' });
  try {
    const body = JSON.parse((await call()).body) as { deployReceipt: Record<string, unknown> };
    assert.equal(
      fetchMock.calls.some((url) => url.startsWith('https://api.netlify.com/')),
      true
    );
    assert.equal(body.deployReceipt.deployId, 'deploy-polled');
    assert.equal(body.deployReceipt.deployStatus, 'ready');
  } finally {
    fetchMock.restore();
  }
});

test('run-publisher-agent skips image verification unless deploy status is ready', async () => {
  configure({
    commit: 'queued-commit',
    deployStatus: 'queued',
    productionUrl: 'https://production.example.test',
    imagePaths: ['/image.png'],
  });
  delete process.env.NETLIFY_SITE_ID;
  delete process.env.NETLIFY_AUTH_TOKEN;
  const fetchMock = installFetch();
  try {
    const body = JSON.parse((await call()).body) as { imageVerification?: unknown; verified: boolean };
    assert.equal(
      fetchMock.calls.some((url) => url.endsWith('/.netlify/functions/verify-article-images')),
      false
    );
    assert.equal(body.imageVerification, undefined);
    assert.equal(body.verified, false);
  } finally {
    fetchMock.restore();
  }
});

test('run-publisher-agent verified is true only when image verification returns verified true', async () => {
  configure({
    commit: 'ready-commit',
    deployStatus: 'ready',
    productionUrl: 'https://production.example.test',
    imagePaths: ['/image.png'],
  });
  const unverifiedFetch = installFetch({ verify: false });
  try {
    const unverified = JSON.parse((await call()).body) as { verified: boolean };
    assert.equal(unverified.verified, false);
  } finally {
    unverifiedFetch.restore();
  }

  const verifiedFetch = installFetch({ verify: true });
  try {
    const verified = JSON.parse((await call()).body) as { verified: boolean };
    assert.equal(verified.verified, true);
  } finally {
    verifiedFetch.restore();
  }
});
