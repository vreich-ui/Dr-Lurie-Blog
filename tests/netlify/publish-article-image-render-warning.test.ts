import assert from 'node:assert/strict';
import test from 'node:test';

import sharp from 'sharp';

import { handler as publishHandler } from '../../netlify/functions/publish-article.js';
import { handler as saveArtifactHandler } from '../../netlify/functions/save-artifact.js';

const publishSecret = 'image-render-warning-test-secret';

const createImageBytes = () =>
  sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .png()
    .toBuffer();

const setPublishEnv = () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';
};

const postArtifact = async (requestId: string) => {
  const bytes = await createImageBytes();
  const response = await saveArtifactHandler({
    httpMethod: 'POST',
    headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
    body: JSON.stringify({
      requestId,
      artifactKind: 'image',
      contentType: 'image/png',
      encoding: 'base64',
      payload: bytes.toString('base64'),
    }),
  });
  assert.ok(response.statusCode >= 200 && response.statusCode < 300, response.body);
  return (JSON.parse(response.body) as { artifact: { blobKey: string } }).artifact;
};

type PublishBody = { warnings?: Array<{ code: string; node_id: string; reason: string }> };

/**
 * Materialize an image artifact, then publish an article_body whose nodes are built from the
 * artifact's blobKey. Returns the response plus the committed Markdown blob.
 */
const publishArticleBody = async (
  slug: string,
  requestId: string,
  buildNodes: (blobKey: string) => unknown[],
  buildExtra: (blobKey: string) => Record<string, unknown> = () => ({})
): Promise<{ statusCode: number; body: PublishBody; markdown: string }> => {
  setPublishEnv();
  const artifact = await postArtifact(requestId);

  const blobWrites: Array<{ content: string; encoding: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('/contents/')) return new Response('not found', { status: 404 });
    if (url.includes('/git/ref/heads/main')) return Response.json({ object: { sha: 'base-sha' } });
    if (url.endsWith('/git/commits/base-sha')) return Response.json({ tree: { sha: 'base-tree' } });
    if (url.endsWith('/git/blobs') && method === 'POST') {
      blobWrites.push(JSON.parse(String(init?.body)) as { content: string; encoding: string });
      return Response.json({ sha: `blob-${blobWrites.length}` });
    }
    if (url.endsWith('/git/trees') && method === 'POST') return Response.json({ sha: 'new-tree' });
    if (url.endsWith('/git/commits') && method === 'POST') return Response.json({ sha: 'new-commit' });
    if (url.includes('/git/refs/heads/main') && method === 'PATCH') return Response.json({ ok: true });
    return new Response(`unexpected ${method} ${url}`, { status: 500 });
  }) as typeof fetch;

  try {
    const response = await publishHandler({
      httpMethod: 'POST',
      headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
      body: JSON.stringify({
        slug,
        title: 'Image Render Warning Test',
        publishDate: '2026-07-02T10:00:00.000Z',
        article_body: { schema_version: 'article_body.v1', nodes: buildNodes(artifact.blobKey) },
        artifactReferences: [artifact],
        ...buildExtra(artifact.blobKey),
      }),
    });
    return {
      statusCode: response.statusCode,
      body: JSON.parse(response.body) as PublishBody,
      // blobWrites[0] is the committed Markdown blob (written before media blobs).
      markdown: blobWrites[0]?.content ?? '',
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
};

const imageNode = (blobKey: string, rendering?: Record<string, unknown>) => ({
  id: 'n_img1',
  kind: 'content',
  public: { title: 'Section', media: { type: 'image', src: blobKey, alt: 'An image' } },
  ...(rendering ? { rendering } : {}),
});

test('inline image node publishes and appears in the committed Markdown body (no warning)', async () => {
  const { statusCode, body, markdown } = await publishArticleBody(
    'image-warn-inline',
    'req_test_imgwarn_inline_20260702_01',
    (blobKey) => [imageNode(blobKey, { placement: 'inline' })]
  );

  assert.equal(statusCode, 201);
  assert.ok(markdown.includes('!['), 'inline image must be embedded in the Markdown body');
  assert.ok(markdown.includes('~/assets/images/uploads/'), 'image should resolve to a published asset path');
  assert.equal(body.warnings, undefined, 'a correctly-placed inline image must not warn');
});

test('image node with no placement still publishes (201) but returns an image_not_rendered warning', async () => {
  const { statusCode, body } = await publishArticleBody(
    'image-warn-missing',
    'req_test_imgwarn_missing_20260702_01',
    (blobKey) => [imageNode(blobKey)]
  );

  assert.equal(statusCode, 201, 'publish still succeeds — the commit is valid');
  assert.ok(Array.isArray(body.warnings), 'warnings array must be present');
  assert.equal(body.warnings?.[0]?.code, 'image_not_rendered');
  assert.equal(body.warnings?.[0]?.node_id, 'n_img1');
  assert.match(body.warnings?.[0]?.reason ?? '', /placement/);
});

test('hero image that is the explicit featuredImage publishes with no warning', async () => {
  const { statusCode, body } = await publishArticleBody(
    'image-warn-hero',
    'req_test_imgwarn_hero_20260702_01',
    // Hero is designated by node id 'n_hero' (the schema rejects placement/presentation 'hero').
    // Its image is emitted to the frontmatter, not the body.
    (blobKey) => [
      {
        id: 'n_hero',
        kind: 'content',
        public: { title: 'Hero', media: { type: 'image', src: blobKey, alt: 'Hero' } },
      },
    ],
    (blobKey) => ({ featuredImage: blobKey })
  );

  assert.equal(statusCode, 201);
  assert.equal(body.warnings, undefined, 'the hero/featured image renders in frontmatter, so no warning');
});
