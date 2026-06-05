import assert from 'node:assert/strict';
import test from 'node:test';

import { handler as publishHandler } from '../../netlify/functions/publish-article.js';
import { handler as saveArtifactHandler } from '../../netlify/functions/save-artifact.js';

const publishSecret = 'publish-artifact-test-secret';

const postArtifact = async (body: Record<string, unknown>) => {
  const response = await saveArtifactHandler({
    httpMethod: 'POST',
    headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  assert.ok(response.statusCode >= 200 && response.statusCode < 300, response.body);

  return JSON.parse(response.body) as { artifact: Record<string, unknown> };
};

test('publish-article resolves artifactReferences into base64 media blobs', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';

  const originalFetch = globalThis.fetch;
  const requestId = `artifact-publish-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const explicitBytes = Buffer.from('explicit filename bytes');
  const derivedBytes = Buffer.from('derived filename bytes');
  const explicitUpload = await postArtifact({
    requestId,
    artifactKind: 'image',
    contentType: 'image/png',
    filename: 'stored-name.png',
    encoding: 'base64',
    payload: explicitBytes.toString('base64'),
    metadata: { filename: 'Hero Custom.PNG' },
  });
  const derivedUpload = await postArtifact({
    requestId,
    artifactKind: 'image',
    contentType: 'image/jpeg',
    encoding: 'base64',
    payload: derivedBytes.toString('base64'),
  });
  const blobWrites: Array<{ content: string; encoding: string }> = [];
  let treePaths: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url.includes('/contents/src/data/post/artifact-publish-test.md')) {
      return new Response('not found', { status: 404 });
    }

    if (url.includes('/git/ref/heads/main')) {
      return Response.json({ object: { sha: 'base-sha' } });
    }

    if (url.endsWith('/git/commits/base-sha')) {
      return Response.json({ tree: { sha: 'base-tree' } });
    }

    if (url.endsWith('/git/blobs') && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { content: string; encoding: string };
      blobWrites.push(body);

      return Response.json({ sha: `blob-${blobWrites.length}` });
    }

    if (url.endsWith('/git/trees') && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { tree: Array<{ path: string }> };
      treePaths = body.tree.map((entry) => entry.path);

      return Response.json({ sha: 'new-tree' });
    }

    if (url.endsWith('/git/commits') && method === 'POST') {
      return Response.json({ sha: 'new-commit' });
    }

    if (url.includes('/git/refs/heads/main') && method === 'PATCH') {
      return Response.json({ ok: true });
    }

    return new Response(`unexpected ${method} ${url}`, { status: 500 });
  }) as typeof fetch;

  try {
    const response = await publishHandler({
      httpMethod: 'POST',
      headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'artifact-publish-test',
        title: 'Artifact Publish Test',
        markdown: '# Artifact publish test',
        overwrite: false,
        mediaEntries: [
          {
            name: 'Direct Media.PNG',
            content: Buffer.from('direct media bytes').toString('base64'),
            encoding: 'base64',
          },
        ],
        artifactReferences: [explicitUpload.artifact, derivedUpload.artifact],
      }),
    });

    assert.equal(response.statusCode, 201, response.body);

    const body = JSON.parse(response.body) as { imagePaths: string[]; commit: string };
    const directPath = 'src/assets/images/uploads/artifact-publish-test/direct-media.png';
    const explicitPath = 'src/assets/images/uploads/artifact-publish-test/hero-custom.png';
    const derivedSha = String(derivedUpload.artifact.sha256);
    const derivedPath = `src/assets/images/uploads/artifact-publish-test/${requestId}-${derivedSha}.jpg`;

    assert.equal(body.commit, 'new-commit');
    assert.deepEqual(body.imagePaths, [directPath, explicitPath, derivedPath]);
    assert.deepEqual(treePaths, ['src/data/post/artifact-publish-test.md', directPath, explicitPath, derivedPath]);
    assert.equal(blobWrites[1]?.encoding, 'base64');
    assert.equal(blobWrites[1]?.content, Buffer.from('direct media bytes').toString('base64'));
    assert.equal(blobWrites[2]?.encoding, 'base64');
    assert.equal(blobWrites[2]?.content, explicitBytes.toString('base64'));
    assert.equal(blobWrites[3]?.encoding, 'base64');
    assert.equal(blobWrites[3]?.content, derivedBytes.toString('base64'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
