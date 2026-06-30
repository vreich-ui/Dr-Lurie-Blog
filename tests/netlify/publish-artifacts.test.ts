import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import sharp from 'sharp';

import { handler as publishHandler } from '../../netlify/functions/publish-article.js';
import { handler as saveArtifactHandler } from '../../netlify/functions/save-artifact.js';

const publishSecret = 'publish-artifact-test-secret';

const createImageBytes = (format: 'jpeg' | 'png' | 'webp') => {
  const image = sharp({
    create: {
      width: 2,
      height: 2,
      channels: 3,
      background: { r: 80, g: 100, b: 120 },
    },
  });

  if (format === 'jpeg') return image.jpeg().toBuffer();
  if (format === 'webp') return image.webp().toBuffer();
  return image.png().toBuffer();
};

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
  const directBytes = await createImageBytes('png');
  const explicitBytes = await createImageBytes('png');
  const derivedBytes = await createImageBytes('jpeg');
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
            content: directBytes.toString('base64'),
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
    assert.equal(blobWrites[1]?.content, directBytes.toString('base64'));
    assert.equal(blobWrites[2]?.encoding, 'base64');
    assert.equal(blobWrites[2]?.content, explicitBytes.toString('base64'));
    assert.equal(blobWrites[3]?.encoding, 'base64');
    assert.equal(blobWrites[3]?.content, derivedBytes.toString('base64'));
    assert.equal(
      createHash('sha256')
        .update(Buffer.from(blobWrites[3]?.content ?? '', 'base64'))
        .digest('hex'),
      String(derivedUpload.artifact.sha256)
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article rejects non-image artifactReferences before creating media entries', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';

  const originalFetch = globalThis.fetch;
  const requestId = `artifact-non-image-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const upload = await postArtifact({
    requestId,
    artifactKind: 'pdf',
    contentType: 'application/pdf',
    filename: 'not-an-image.pdf',
    encoding: 'base64',
    payload: Buffer.from('%PDF-1.7 non image').toString('base64'),
  });
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requestedUrls.push(url);

    if (url.includes('/contents/src/data/post/non-image-artifact-reference.md')) {
      return new Response('not found', { status: 404 });
    }

    return new Response('unexpected fetch', { status: 500 });
  }) as typeof fetch;

  try {
    const response = await publishHandler({
      httpMethod: 'POST',
      headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'non-image-artifact-reference',
        title: 'Non-image Artifact Reference',
        markdown: '# Non-image artifact reference\n\nThis article has enough words for publishing.',
        artifactReferences: [upload.artifact],
        overwrite: false,
      }),
    });

    assert.equal(response.statusCode, 422, response.body);
    assert.match(JSON.parse(response.body).error, /Only image artifactReferences/);
    assert.equal(
      requestedUrls.some((url) => url.endsWith('/git/blobs')),
      false,
      'Non-image artifact references should fail before creating GitHub blobs.'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article fails fast when artifactReferences contains non-ArtifactReference media', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';

  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = (async () => {
    fetchCount += 1;
    return new Response('unexpected fetch', { status: 500 });
  }) as typeof fetch;

  try {
    const response = await publishHandler({
      httpMethod: 'POST',
      headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'invalid-artifact-reference',
        title: 'Invalid Artifact Reference',
        markdown: '# Invalid artifact reference',
        artifactReferences: [{ blobKey: 'image/request/invented.png', url: 'https://example.com/invented.png' }],
      }),
    });

    assert.equal(response.statusCode, 400, response.body);
    assert.match(JSON.parse(response.body).error, /not a valid ArtifactReference/);
    assert.equal(fetchCount, 0, 'Invalid artifactReferences should fail before GitHub requests.');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article rewrites saved artifact blob keys before committing markdown', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'feature/rewrite-artifact-paths';

  const requestId = `artifact-rewrite-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const artifactBytes = await createImageBytes('png');
  const upload = await postArtifact({
    requestId,
    artifactKind: 'image',
    contentType: 'image/png',
    filename: 'stored-artifact.png',
    encoding: 'base64',
    payload: artifactBytes.toString('base64'),
    metadata: { filename: 'Hero Selected.PNG' },
  });
  const artifact = upload.artifact as { blobKey: string };
  const originalFetch = globalThis.fetch;
  const blobWrites: Array<{ content: string; encoding: string }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url.includes('/contents/src/data/post/artifact-rewrite-test.md')) {
      return new Response('not found', { status: 404 });
    }

    if (url.includes('/git/ref/heads/feature%2Frewrite-artifact-paths')) {
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
      return Response.json({ sha: 'new-tree' });
    }

    if (url.endsWith('/git/commits') && method === 'POST') {
      return Response.json({ sha: 'new-commit' });
    }

    if (url.includes('/git/refs/heads/feature%2Frewrite-artifact-paths') && method === 'PATCH') {
      return Response.json({ ok: true });
    }

    return new Response(`unexpected ${method} ${url}`, { status: 500 });
  }) as typeof fetch;

  try {
    const response = await publishHandler({
      httpMethod: 'POST',
      headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'artifact-rewrite-test',
        title: 'Artifact Rewrite Test',
        markdown: `![Hero](${artifact.blobKey})\n`,
        publishDate: '2026-06-14T00:00:00.000Z',
        featuredImage: artifact.blobKey,
        artifactReferences: [upload.artifact],
        overwrite: false,
      }),
    });

    assert.equal(response.statusCode, 201, response.body);
    assert.equal(blobWrites[0]?.encoding, 'utf-8');
    assert.equal(
      blobWrites[0]?.content,
      '---\npublishDate: 2026-06-14T00:00:00.000Z\ntitle: "Artifact Rewrite Test"\nimage: "~/assets/images/uploads/artifact-rewrite-test/hero-selected.png"\n---\n![Hero](~/assets/images/uploads/artifact-rewrite-test/hero-selected.png)\n'
    );
    assert.equal(blobWrites[1]?.content, artifactBytes.toString('base64'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article normalizes stale artifact blobKeys and corrects the artifact index', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'feature/reconcile-artifact-paths';

  const requestId = `artifact-reconcile-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const artifactBytes = await createImageBytes('png');
  const upload = await postArtifact({
    requestId,
    artifactKind: 'image',
    contentType: 'image/png',
    filename: 'reconcile.png',
    encoding: 'base64',
    payload: artifactBytes.toString('base64'),
    metadata: { filename: 'Reconciled Hero.PNG' },
  });
  const artifact = upload.artifact as Record<string, string | number>;
  const staleBlobKey = `artifacts/${artifact.blobKey}`;
  const { getArtifactIndexBlobStore } = await import('../../netlify/lib/blob-store.js');
  const indexStore = await getArtifactIndexBlobStore({});
  await indexStore.setJSON(`request-artifacts/${encodeURIComponent(requestId)}/${artifact.sha256}.json`, {
    ...upload.artifact,
    blobKey: staleBlobKey,
  });

  const originalFetch = globalThis.fetch;
  const blobWrites: Array<{ content: string; encoding: string }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url.includes('/contents/src/data/post/artifact-reconcile-test.md')) {
      return new Response('not found', { status: 404 });
    }

    if (url.includes('/git/ref/heads/feature%2Freconcile-artifact-paths')) {
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
      return Response.json({ sha: 'new-tree' });
    }

    if (url.endsWith('/git/commits') && method === 'POST') {
      return Response.json({ sha: 'new-commit' });
    }

    if (url.includes('/git/refs/heads/feature%2Freconcile-artifact-paths') && method === 'PATCH') {
      return Response.json({ ok: true });
    }

    return new Response(`unexpected ${method} ${url}`, { status: 500 });
  }) as typeof fetch;

  try {
    const response = await publishHandler({
      httpMethod: 'POST',
      headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'artifact-reconcile-test',
        title: 'Artifact Reconcile Test',
        markdown: `![Hero](${staleBlobKey})`,
        featuredImage: staleBlobKey,
        artifactReferences: [{ ...upload.artifact, blobKey: staleBlobKey }],
        overwrite: false,
      }),
    });

    assert.equal(response.statusCode, 201, response.body);
    assert.match(blobWrites[0]?.content, /~\/assets\/images\/uploads\/artifact-reconcile-test\/reconciled-hero.png/);
    assert.equal(blobWrites[1]?.content, artifactBytes.toString('base64'));
    const correctedIndex = JSON.parse(
      (await indexStore.get(`request-artifacts/${encodeURIComponent(requestId)}/${artifact.sha256}.json`)) || '{}'
    ) as { blobKey?: string };
    assert.equal(correctedIndex.blobKey, artifact.blobKey);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article reports stale saved image references instead of a generic 500', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';

  const requestId = `stale-artifact-publish-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const upload = await postArtifact({
    requestId,
    artifactKind: 'image',
    contentType: 'image/png',
    filename: 'stale.png',
    encoding: 'base64',
    payload: (await createImageBytes('png')).toString('base64'),
  });
  const artifact = upload.artifact as { blobKey: string };
  const { getArtifactBlobStore } = await import('../../netlify/lib/blob-store.js');
  const artifactStore = await getArtifactBlobStore({});
  await artifactStore.del(artifact.blobKey);

  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requestedUrls.push(`${init?.method ?? 'GET'} ${url}`);

    if (url.includes('/contents/src/data/post/stale-artifact-publish-test.md')) {
      return new Response('not found', { status: 404 });
    }

    return new Response(`unexpected ${init?.method ?? 'GET'} ${url}`, { status: 500 });
  }) as typeof fetch;

  try {
    const response = await publishHandler({
      httpMethod: 'POST',
      headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'stale-artifact-publish-test',
        title: 'Stale Artifact Publish Test',
        markdown: '# Stale artifact publish test',
        artifactReferences: [upload.artifact],
      }),
    });

    assert.equal(response.statusCode, 422, response.body);
    assert.deepEqual(JSON.parse(response.body), {
      error: 'These saved image references exist in JSON, but the backing blob files are missing or unreadable.',
    });
    assert.deepEqual(
      requestedUrls.filter((url) => url.includes('/git/blobs')),
      []
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article ignores a stale existingFeaturedImagePath when the featured image is a selected artifact', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'feature/image-artifacts';

  const requestId = `artifact-featured-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const artifactBytes = await createImageBytes('png');
  const upload = await postArtifact({
    requestId,
    artifactKind: 'image',
    contentType: 'image/png',
    filename: 'featured-artifact.png',
    encoding: 'base64',
    payload: artifactBytes.toString('base64'),
    metadata: { filename: 'Featured Artifact.PNG' },
  });
  const originalFetch = globalThis.fetch;
  const blobWrites: Array<{ content: string; encoding: string }> = [];
  let treePaths: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url.includes('/contents/src/data/post/artifact-featured-image-test.md')) {
      return new Response('not found', { status: 404 });
    }

    if (url.includes('/git/ref/heads/feature%2Fimage-artifacts')) {
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

    if (url.includes('/git/refs/heads/feature%2Fimage-artifacts') && method === 'PATCH') {
      return Response.json({ ok: true });
    }

    return new Response(`unexpected ${method} ${url}`, { status: 500 });
  }) as typeof fetch;

  try {
    const response = await publishHandler({
      httpMethod: 'POST',
      headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'artifact-featured-image-test',
        title: 'Artifact Featured Image Test',
        markdown: '# Artifact featured image test',
        featuredImage: 'featured-artifact.png',
        existingFeaturedImagePath: 'https://example.com/stale-image.jpg',
        artifactReferences: [upload.artifact],
        overwrite: false,
      }),
    });

    assert.equal(response.statusCode, 201, response.body);
    assert.deepEqual(treePaths, [
      'src/data/post/artifact-featured-image-test.md',
      'src/assets/images/uploads/artifact-featured-image-test/featured-artifact.png',
    ]);
    assert.match(
      blobWrites[0]?.content ?? '',
      /image: "~\/assets\/images\/uploads\/artifact-featured-image-test\/featured-artifact\.png"/
    );
    assert.equal(blobWrites[1]?.content, artifactBytes.toString('base64'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article rejects corrupt artifact bytes before GitHub writes', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';

  const requestId = `corrupt-artifact-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const corruptBytes = Buffer.from('not an image');
  const corruptSha256 = createHash('sha256').update(corruptBytes).digest('hex');
  const artifact = {
    blobKey: `image/${requestId}/${corruptSha256}.png`,
    sizeBytes: corruptBytes.byteLength,
    sha256: corruptSha256,
    contentType: 'image/png',
    createdAtISO: new Date().toISOString(),
    artifactKind: 'image',
    originalFilename: 'corrupt.png',
    label: 'corrupt.png',
  };
  const { getArtifactBlobStore, getArtifactIndexBlobStore } = await import('../../netlify/lib/blob-store.js');
  const artifactStore = await getArtifactBlobStore({});
  const indexStore = await getArtifactIndexBlobStore({});
  await artifactStore.set(artifact.blobKey, corruptBytes, {
    metadata: {
      contentType: artifact.contentType,
      sha256: artifact.sha256,
      sizeBytes: String(artifact.sizeBytes),
      createdAtISO: artifact.createdAtISO,
    },
  });
  await indexStore.setJSON(`request-artifacts/${encodeURIComponent(requestId)}/${artifact.sha256}.json`, artifact, {
    metadata: {
      requestId,
      sha256: artifact.sha256,
      contentType: artifact.contentType,
    },
  });
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requestedUrls.push(`${init?.method ?? 'GET'} ${url}`);

    if (url.includes('/contents/src/data/post/corrupt-artifact-test.md')) {
      return new Response('not found', { status: 404 });
    }

    return new Response(`unexpected ${init?.method ?? 'GET'} ${url}`, { status: 500 });
  }) as typeof fetch;

  try {
    const response = await publishHandler({
      httpMethod: 'POST',
      headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'corrupt-artifact-test',
        title: 'Corrupt Artifact Test',
        markdown: '# Corrupt artifact test',
        artifactReferences: [artifact],
      }),
    });

    assert.equal(response.statusCode, 422, response.body);
    assert.match(
      JSON.parse(response.body).error,
      /Invalid image artifact: .*corrupt\.png could not be decoded as a valid PNG/
    );
    assert.deepEqual(
      requestedUrls.filter((url) => /\/git\/(blobs|trees|commits|refs)/.test(url)),
      []
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article rejects corrupt admin files before GitHub writes', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';

  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requestedUrls.push(`${init?.method ?? 'GET'} ${url}`);

    if (url.includes('/contents/src/data/post/corrupt-admin-file-test.md')) {
      return new Response('not found', { status: 404 });
    }

    return new Response(`unexpected ${init?.method ?? 'GET'} ${url}`, { status: 500 });
  }) as typeof fetch;

  try {
    const response = await publishHandler({
      httpMethod: 'POST',
      headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'corrupt-admin-file-test',
        title: 'Corrupt Admin File Test',
        markdown: '# Corrupt admin file test',
        files: [{ name: 'hero.png', type: 'image/png', base64: Buffer.from('not an image').toString('base64') }],
      }),
    });

    assert.equal(response.statusCode, 422, response.body);
    assert.match(
      JSON.parse(response.body).error,
      /Invalid image artifact: hero\.png could not be decoded as a valid PNG/
    );
    assert.deepEqual(
      requestedUrls.filter((url) => /\/git\/(blobs|trees|commits|refs)/.test(url)),
      []
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article rejects content-type and extension mismatches before GitHub writes', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';

  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  const webpBytes = await createImageBytes('webp');

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requestedUrls.push(`${init?.method ?? 'GET'} ${url}`);

    if (url.includes('/contents/src/data/post/mismatch-image-test.md')) {
      return new Response('not found', { status: 404 });
    }

    return new Response(`unexpected ${init?.method ?? 'GET'} ${url}`, { status: 500 });
  }) as typeof fetch;

  try {
    const response = await publishHandler({
      httpMethod: 'POST',
      headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'mismatch-image-test',
        title: 'Mismatch Image Test',
        markdown: '# Mismatch image test',
        files: [{ name: 'hero.png', type: 'image/png', base64: webpBytes.toString('base64') }],
      }),
    });

    assert.equal(response.statusCode, 422, response.body);
    assert.match(
      JSON.parse(response.body).error,
      /Invalid image artifact: hero\.png could not be decoded as a valid PNG/
    );
    assert.deepEqual(
      requestedUrls.filter((url) => /\/git\/(blobs|trees|commits|refs)/.test(url)),
      []
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article uses a saved artifact for a path-only image repoPath update', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';

  const requestId = `artifact-target-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const artifactBytes = await createImageBytes('webp');
  const upload = await postArtifact({
    requestId,
    artifactKind: 'image',
    contentType: 'image/webp',
    filename: 'nostalgia-mood.webp',
    encoding: 'base64',
    payload: artifactBytes.toString('base64'),
  });
  const originalFetch = globalThis.fetch;
  const blobWrites: Array<{ content: string; encoding: string }> = [];
  let treePaths: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url.includes('/contents/src/data/post/the-blue-dot-on-the-floor.md')) {
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
        slug: 'the-blue-dot-on-the-floor',
        title: 'The Blue Dot on the Floor',
        markdown: '# The blue dot on the floor',
        featuredImage: 'src/assets/images/uploads/the-blue-dot-on-the-floor/nostalgia-mood.webp',
        images: [{ repoPath: 'src/assets/images/uploads/the-blue-dot-on-the-floor/nostalgia-mood.webp' }],
        artifactReferences: [upload.artifact],
      }),
    });

    assert.equal(response.statusCode, 201, response.body);
    assert.deepEqual(treePaths, [
      'src/data/post/the-blue-dot-on-the-floor.md',
      'src/assets/images/uploads/the-blue-dot-on-the-floor/nostalgia-mood.webp',
    ]);
    assert.match(
      blobWrites[0]?.content ?? '',
      /image: "~\/assets\/images\/uploads\/the-blue-dot-on-the-floor\/nostalgia-mood\.webp"/
    );
    assert.equal(blobWrites[1]?.content, artifactBytes.toString('base64'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article validates existing repo image references without rewriting the image', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';

  const existingBytes = await createImageBytes('png');
  const originalFetch = globalThis.fetch;
  const blobWrites: Array<{ content: string; encoding: string }> = [];
  let treePaths: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url.includes('/contents/src/data/post/repo-reference-test.md')) {
      return new Response('not found', { status: 404 });
    }

    if (url.includes('/contents/src/assets/images/uploads/shared/existing-hero.png')) {
      return Response.json({
        type: 'file',
        encoding: 'base64',
        content: existingBytes.toString('base64'),
      });
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
        slug: 'repo-reference-test',
        title: 'Repo Reference Test',
        markdown: '# Repo reference test',
        existingFeaturedImagePath: 'src/assets/images/uploads/shared/existing-hero.png',
        images: [{ repoPath: 'src/assets/images/uploads/shared/existing-hero.png' }],
      }),
    });

    assert.equal(response.statusCode, 201, response.body);
    assert.deepEqual(treePaths, ['src/data/post/repo-reference-test.md']);
    assert.equal(blobWrites.length, 1);
    assert.match(blobWrites[0]?.content ?? '', /image: "~\/assets\/images\/uploads\/shared\/existing-hero\.png"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article rejects corrupt existing repo image references before GitHub writes', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';

  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    requestedUrls.push(`${method} ${url}`);

    if (url.includes('/contents/src/data/post/corrupt-repo-reference-test.md')) {
      return new Response('not found', { status: 404 });
    }

    if (url.includes('/contents/src/assets/images/uploads/shared/corrupt-hero.png')) {
      return Response.json({
        type: 'file',
        encoding: 'base64',
        content: Buffer.from('not an image').toString('base64'),
      });
    }

    return new Response(`unexpected ${method} ${url}`, { status: 500 });
  }) as typeof fetch;

  try {
    const response = await publishHandler({
      httpMethod: 'POST',
      headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'corrupt-repo-reference-test',
        title: 'Corrupt Repo Reference Test',
        markdown: '# Corrupt repo reference test',
        existingFeaturedImagePath: 'src/assets/images/uploads/shared/corrupt-hero.png',
      }),
    });

    assert.equal(response.statusCode, 422, response.body);
    assert.match(
      JSON.parse(response.body).error,
      /Invalid image artifact: corrupt-hero\.png could not be decoded as a valid PNG/
    );
    assert.deepEqual(
      requestedUrls.filter((url) => /\/git\/(blobs|trees|commits|refs)/.test(url)),
      []
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article validates external image references without requiring upload bytes', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';

  const externalBytes = await createImageBytes('webp');
  const originalFetch = globalThis.fetch;
  const blobWrites: Array<{ content: string; encoding: string }> = [];
  let treePaths: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url === 'https://cdn.example.com/images/existing-hero.webp') {
      return new Response(new Uint8Array(externalBytes), { headers: { 'content-type': 'image/webp' } });
    }

    if (url.includes('/contents/src/data/post/external-reference-test.md')) {
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
        slug: 'external-reference-test',
        title: 'External Reference Test',
        markdown: '# External reference test',
        featuredImage: 'https://cdn.example.com/images/existing-hero.webp',
      }),
    });

    assert.equal(response.statusCode, 201, response.body);
    assert.deepEqual(treePaths, ['src/data/post/external-reference-test.md']);
    assert.equal(blobWrites.length, 1);
    assert.match(blobWrites[0]?.content ?? '', /image: "https:\/\/cdn\.example\.com\/images\/existing-hero\.webp"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article accepts valid PNG, WebP, and JPEG media entries', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';

  const originalFetch = globalThis.fetch;
  const pngBytes = await createImageBytes('png');
  const webpBytes = await createImageBytes('webp');
  const jpegBytes = await createImageBytes('jpeg');
  const blobWrites: Array<{ content: string; encoding: string }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url.includes('/contents/src/data/post/valid-image-formats-test.md')) {
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
        slug: 'valid-image-formats-test',
        title: 'Valid Image Formats Test',
        markdown: '# Valid image formats test',
        files: [
          { name: 'hero.png', type: 'image/png', base64: pngBytes.toString('base64') },
          { name: 'inline.webp', type: 'image/webp', base64: webpBytes.toString('base64') },
          { name: 'card.jpg', type: 'image/jpeg', base64: jpegBytes.toString('base64') },
        ],
      }),
    });

    assert.equal(response.statusCode, 201, response.body);
    assert.equal(blobWrites.length, 4);
    assert.equal(blobWrites[1]?.content, pngBytes.toString('base64'));
    assert.equal(blobWrites[2]?.content, webpBytes.toString('base64'));
    assert.equal(blobWrites[3]?.content, jpegBytes.toString('base64'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article resolves artifact pointers in article_body nodes via index lookup', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';

  const requestId = `node-artifact-resolve-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const imageBytes = await createImageBytes('png');
  const upload = await postArtifact({
    requestId,
    artifactKind: 'image',
    contentType: 'image/png',
    filename: 'inline-hero.png',
    encoding: 'base64',
    payload: imageBytes.toString('base64'),
    metadata: { filename: 'Inline Hero.PNG' },
  });
  const artifact = upload.artifact as { blobKey: string; sha256: string };

  const originalFetch = globalThis.fetch;
  const blobWrites: Array<{ content: string; encoding: string }> = [];
  let treePaths: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url.includes('/contents/src/data/post/node-artifact-resolve-test.md')) {
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
    // artifact blobKey is in article_body node media.src but NOT in top-level artifactReferences
    const response = await publishHandler({
      httpMethod: 'POST',
      headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'node-artifact-resolve-test',
        title: 'Node Artifact Resolve Test',
        article_body: {
          schema_version: 'article_body.v1',
          nodes: [
            {
              id: 'n_hero',
              kind: 'content',
              rendering: { placement: 'inline' },
              public: {
                title: 'Hero section',
                body: 'Article body content.',
                media: { src: artifact.blobKey, type: 'image', alt: 'Hero image' },
              },
            },
          ],
        },
        artifactReferences: [],
        overwrite: false,
      }),
    });

    assert.equal(response.statusCode, 201, response.body);
    const markdownContent = blobWrites[0]?.content ?? '';
    assert.ok(
      !markdownContent.includes(artifact.blobKey),
      `Raw artifact blobKey must not appear in markdown.\nGot: ${markdownContent.slice(0, 400)}`
    );
    assert.ok(
      markdownContent.includes('~/assets/images/uploads/node-artifact-resolve-test/'),
      `Resolved upload path must appear in markdown.\nGot: ${markdownContent.slice(0, 400)}`
    );
    assert.ok(
      treePaths.some((p) => p.startsWith('src/assets/images/uploads/node-artifact-resolve-test/')),
      `Image file must be committed to the tree.\nTree: ${treePaths.join(', ')}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article sets image frontmatter to first artifact entry when no explicit featuredImage is named', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';

  const requestId = `featured-fallback-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const imageBytes = await createImageBytes('png');
  const upload = await postArtifact({
    requestId,
    artifactKind: 'image',
    contentType: 'image/png',
    filename: 'article-hero.png',
    encoding: 'base64',
    payload: imageBytes.toString('base64'),
    metadata: { filename: 'Article Hero.PNG' },
  });

  const originalFetch = globalThis.fetch;
  const blobWrites: Array<{ content: string; encoding: string }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url.includes('/contents/src/data/post/featured-fallback-test.md')) {
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
    // No featuredImage or existingFeaturedImagePath — image: frontmatter must fall back to the artifact
    const response = await publishHandler({
      httpMethod: 'POST',
      headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'featured-fallback-test',
        title: 'Featured Fallback Test',
        markdown: '# Featured fallback test',
        artifactReferences: [upload.artifact],
        overwrite: false,
      }),
    });

    assert.equal(response.statusCode, 201, response.body);
    const markdownContent = blobWrites[0]?.content ?? '';
    assert.ok(markdownContent.includes('image:'), `Expected "image:" in frontmatter.\nGot: ${markdownContent.slice(0, 300)}`);
    assert.ok(
      markdownContent.includes('~/assets/images/uploads/featured-fallback-test/'),
      `Expected upload path in image frontmatter.\nGot: ${markdownContent.slice(0, 300)}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article returns 422 when article_body node artifact pointer is not in the index', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';

  const requestId = `node-unresolved-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const fakeSha256 = 'f'.repeat(64);
  const fakeBlobKey = `image/${requestId}/${fakeSha256}.png`;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('/contents/src/data/post/node-unresolved-ptr-test.md')) {
      return new Response('not found', { status: 404 });
    }
    return new Response(`unexpected ${method} ${url}`, { status: 500 });
  }) as typeof fetch;

  try {
    const response = await publishHandler({
      httpMethod: 'POST',
      headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'node-unresolved-ptr-test',
        title: 'Node Unresolved Pointer Test',
        article_body: {
          schema_version: 'article_body.v1',
          nodes: [
            {
              id: 'n_hero',
              kind: 'content',
              rendering: { placement: 'inline' },
              public: {
                media: { src: fakeBlobKey, type: 'image', alt: 'Broken image' },
              },
            },
          ],
        },
        artifactReferences: [],
        overwrite: false,
      }),
    });

    assert.equal(response.statusCode, 422, response.body);
    const body = JSON.parse(response.body) as { error?: string };
    assert.ok(
      typeof body.error === 'string' && body.error.includes('not found in the artifact index'),
      `Expected 'not found in the artifact index' in error.\nGot: ${body.error}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article returns 422 when article_body node src extension differs from canonical blobKey', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';

  // Upload a PNG artifact; node will reference the same sha256 but with .jpg extension
  const requestId = `node-ext-mismatch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const imageBytes = await createImageBytes('png');
  const upload = await postArtifact({
    requestId,
    artifactKind: 'image',
    contentType: 'image/png',
    filename: 'hero.png',
    encoding: 'base64',
    payload: imageBytes.toString('base64'),
  });
  const artifact = upload.artifact as { blobKey: string; sha256: string };
  // Construct a pointer with the same requestId/sha256 but wrong extension
  const wrongExtSrc = artifact.blobKey.replace(/\.[^.]+$/, '.jpg');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('/contents/src/data/post/node-ext-mismatch-test.md')) {
      return new Response('not found', { status: 404 });
    }
    return new Response(`unexpected ${method} ${url}`, { status: 500 });
  }) as typeof fetch;

  try {
    const response = await publishHandler({
      httpMethod: 'POST',
      headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'node-ext-mismatch-test',
        title: 'Node Extension Mismatch Test',
        article_body: {
          schema_version: 'article_body.v1',
          nodes: [
            {
              id: 'n_hero',
              kind: 'content',
              rendering: { placement: 'inline' },
              public: {
                media: { src: wrongExtSrc, type: 'image', alt: 'Hero image' },
              },
            },
          ],
        },
        artifactReferences: [],
        overwrite: false,
      }),
    });

    assert.equal(response.statusCode, 422, response.body);
    const body = JSON.parse(response.body) as { error?: string };
    assert.ok(
      typeof body.error === 'string' && body.error.includes('does not match the canonical artifact blobKey'),
      `Expected canonical blobKey mismatch error.\nGot: ${body.error}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
