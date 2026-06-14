import assert from 'node:assert/strict';
import test from 'node:test';

import { handler } from '../../netlify/functions/verify-article-images.js';

const secret = 'verify-images-secret';

const call = (expectedImageUrls: string[]) =>
  handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', 'x-publish-key': secret },
    body: JSON.stringify({ articleUrl: 'https://site.example.test/article/', expectedImageUrls }),
  });

const installFetch = (imageResponse: Response, html: string) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === 'https://site.example.test/article/') return new Response(html, { status: 200 });
    if (url === 'https://site.example.test/image.png') return imageResponse;
    return new Response('missing', { status: 404 });
  }) as typeof fetch;
  return () => (globalThis.fetch = originalFetch);
};

test('verify-article-images returns verified true when page contains image and image fetch returns 200 image/*', async () => {
  process.env.PUBLISH_SECRET = secret;
  const restore = installFetch(
    new Response('png', { status: 200, headers: { 'content-type': 'image/png' } }),
    '<html><img src="https://site.example.test/image.png"></html>'
  );
  try {
    const response = await call(['https://site.example.test/image.png']);
    const body = JSON.parse(response.body) as { verified: boolean };
    assert.equal(response.statusCode, 200);
    assert.equal(body.verified, true);
  } finally {
    restore();
  }
});

test('verify-article-images returns verified false when page lacks expected image', async () => {
  process.env.PUBLISH_SECRET = secret;
  const restore = installFetch(
    new Response('png', { status: 200, headers: { 'content-type': 'image/png' } }),
    '<html>No expected image.</html>'
  );
  try {
    const body = JSON.parse((await call(['https://site.example.test/image.png'])).body) as { verified: boolean };
    assert.equal(body.verified, false);
  } finally {
    restore();
  }
});

test('verify-article-images returns verified false when image URL returns 404', async () => {
  process.env.PUBLISH_SECRET = secret;
  const restore = installFetch(new Response('missing', { status: 404 }), '<img src="/image.png">');
  try {
    const body = JSON.parse((await call(['https://site.example.test/image.png'])).body) as { verified: boolean };
    assert.equal(body.verified, false);
  } finally {
    restore();
  }
});

test('verify-article-images returns verified false when image URL returns 200 text/html', async () => {
  process.env.PUBLISH_SECRET = secret;
  const restore = installFetch(
    new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    '<img src="/image.png">'
  );
  try {
    const body = JSON.parse((await call(['https://site.example.test/image.png'])).body) as { verified: boolean };
    assert.equal(body.verified, false);
  } finally {
    restore();
  }
});
