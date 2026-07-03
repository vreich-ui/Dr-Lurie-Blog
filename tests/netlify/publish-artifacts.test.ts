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

// HERO_IMAGE_REQUIRED is read once, at module load, mirroring the ADMIN_TOOLS_ENABLED pattern in
// mcp.ts. `publishHandler` above was already imported (with the flag off) before any test body
// runs, so testing the flag=true path requires a fresh module instance loaded with the env var set
// first. A cache-busting query string forces Node's ESM loader to evaluate a new module instance.
let heroRequiredPublishHandler: typeof publishHandler | undefined;
const getHeroRequiredPublishHandler = async (): Promise<typeof publishHandler> => {
  if (!heroRequiredPublishHandler) {
    const previous = process.env.HERO_IMAGE_REQUIRED;
    process.env.HERO_IMAGE_REQUIRED = 'true';
    const mod = (await import(
      '../../netlify/functions/publish-article.js' + '?heroImageRequired=true'
    )) as {
      handler: typeof publishHandler;
    };
    heroRequiredPublishHandler = mod.handler;
    if (previous === undefined) delete process.env.HERO_IMAGE_REQUIRED;
    else process.env.HERO_IMAGE_REQUIRED = previous;
  }
  return heroRequiredPublishHandler;
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

test('publish-article publishes PDF artifactReferences under document uploads', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';

  const originalFetch = globalThis.fetch;
  const requestId = `artifact-pdf-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const pdfBytes = Buffer.from('%PDF-1.7\nreal pdf artifact from save-artifact');
  const upload = await postArtifact({
    requestId,
    artifactKind: 'pdf',
    contentType: 'application/pdf',
    filename: 'article-handout.pdf',
    encoding: 'base64',
    payload: pdfBytes.toString('base64'),
    metadata: { filename: 'Reader Handout.PDF' },
  });
  const blobWrites: Array<{ content: string; encoding: string }> = [];
  let treePaths: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url.includes('/contents/src/data/post/pdf-artifact-reference.md')) {
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
        slug: 'pdf-artifact-reference',
        title: 'PDF Artifact Reference',
        markdown: `# PDF artifact reference\n\n[Download handout](${String(upload.artifact.blobKey)})`,
        artifactReferences: [upload.artifact],
        overwrite: false,
      }),
    });

    assert.equal(response.statusCode, 201, response.body);

    const body = JSON.parse(response.body) as { imagePaths: string[]; media: string[] };
    const documentPath = 'src/assets/documents/uploads/pdf-artifact-reference/reader-handout.pdf';

    assert.deepEqual(body.imagePaths, [documentPath]);
    assert.deepEqual(body.media, [documentPath]);
    assert.deepEqual(treePaths, ['src/data/post/pdf-artifact-reference.md', documentPath]);
    assert.equal(blobWrites[0]?.encoding, 'utf-8');
    assert.match(
      blobWrites[0]?.content,
      /\[Download handout\]\(~\/assets\/documents\/uploads\/pdf-artifact-reference\/reader-handout\.pdf\)/
    );
    assert.equal(blobWrites[1]?.encoding, 'base64');
    assert.equal(blobWrites[1]?.content, pdfBytes.toString('base64'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article renders PDF CTA links from exact artifactReference blobKey', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';

  const originalFetch = globalThis.fetch;
  const requestId = 'req_smoke_pdfcta_20260701_02';
  const pdfBytes = Buffer.from('%PDF-1.7\nreal pdf artifact for cta link');
  const upload = await postArtifact({
    requestId,
    artifactKind: 'pdf',
    contentType: 'application/pdf',
    filename: 'cta-handout.pdf',
    encoding: 'base64',
    payload: pdfBytes.toString('base64'),
  });
  const artifact = upload.artifact as { blobKey: string; sha256: string };
  const blobWrites: Array<{ content: string; encoding: string }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url.includes('/contents/src/data/post/pdf-cta-exact-blobkey.md'))
      return new Response('not found', { status: 404 });
    if (url.includes('/git/ref/heads/main')) return Response.json({ object: { sha: 'base-sha' } });
    if (url.endsWith('/git/commits/base-sha')) return Response.json({ tree: { sha: 'base-tree' } });
    if (url.endsWith('/git/blobs') && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { content: string; encoding: string };
      blobWrites.push(body);
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
        slug: 'pdf-cta-exact-blobkey',
        title: 'PDF CTA Exact BlobKey',
        article_body: {
          schema_version: 'article_body.v1',
          nodes: [
            {
              id: 'n_a1b2c3',
              kind: 'content',
              public: {
                title: 'Download the handout',
                body: 'Use the exact artifact blobKey for the download CTA.',
                ctaText: 'Download handout',
                ctaLink: artifact.blobKey,
              },
            },
          ],
        },
        artifactReferences: [artifact],
        overwrite: false,
      }),
    });

    assert.equal(response.statusCode, 201, response.body);
    assert.ok((blobWrites[0]?.content ?? '').includes('rounded-full'));
    assert.ok((blobWrites[0]?.content ?? '').includes(`href="/${artifact.blobKey}"`));
    assert.ok((blobWrites[0]?.content ?? '').includes('>Download handout</a>'));
    assert.doesNotMatch(blobWrites[0]?.content ?? '', /pending-pdf-artifact-reference/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article writes markdown for a PDF-only top-level CTA article', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';

  const originalFetch = globalThis.fetch;
  const requestId = 'req_smoke_pdfcta_20260701_01';
  const pdfBytes = Buffer.from('%PDF-1.7\npdf only cta article');
  const upload = await postArtifact({
    requestId,
    artifactKind: 'pdf',
    contentType: 'application/pdf',
    filename: 'pdf-only-handout.pdf',
    encoding: 'base64',
    payload: pdfBytes.toString('base64'),
  });
  const artifact = upload.artifact as { blobKey: string; sha256: string };
  const blobWrites: Array<{ content: string; encoding: string }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url.includes('/contents/src/data/post/pdf-only-top-level-cta.md'))
      return new Response('not found', { status: 404 });
    if (url.includes('/git/ref/heads/main')) return Response.json({ object: { sha: 'base-sha' } });
    if (url.endsWith('/git/commits/base-sha')) return Response.json({ tree: { sha: 'base-tree' } });
    if (url.endsWith('/git/blobs') && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { content: string; encoding: string };
      blobWrites.push(body);
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
        slug: 'pdf-only-top-level-cta',
        title: 'PDF Only Top Level CTA',
        ctaText: 'Download PDF worksheet',
        ctaLink: artifact.blobKey,
        article_body: {
          schema_version: 'article_body.v1',
          nodes: [
            {
              id: 'n_a1b2c3',
              kind: 'content',
              public: { body: 'Download the worksheet below.' },
            },
          ],
        },
        artifactReferences: [artifact],
        overwrite: false,
      }),
    });

    assert.equal(response.statusCode, 201, response.body);
    assert.ok((blobWrites[0]?.content ?? '').includes('rounded-full'));
    assert.ok((blobWrites[0]?.content ?? '').includes(`href="/${artifact.blobKey}"`));
    assert.ok((blobWrites[0]?.content ?? '').includes('>Download PDF worksheet</a>'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article top-level PDF CTA overrides existing fallback article_body CTA', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';

  const originalFetch = globalThis.fetch;
  const requestId = 'req_smoke_pdfcta_override_20260701_01';
  const pdfBytes = Buffer.from('%PDF-1.7\npdf cta override article');
  const upload = await postArtifact({
    requestId,
    artifactKind: 'pdf',
    contentType: 'application/pdf',
    filename: 'override-handout.pdf',
    encoding: 'base64',
    payload: pdfBytes.toString('base64'),
  });
  const artifact = upload.artifact as { blobKey: string; sha256: string };
  const blobWrites: Array<{ content: string; encoding: string }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url.includes('/contents/src/data/post/pdf-cta-overrides-fallback.md'))
      return new Response('not found', { status: 404 });
    if (url.includes('/git/ref/heads/main')) return Response.json({ object: { sha: 'base-sha' } });
    if (url.endsWith('/git/commits/base-sha')) return Response.json({ tree: { sha: 'base-tree' } });
    if (url.endsWith('/git/blobs') && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { content: string; encoding: string };
      blobWrites.push(body);
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
        slug: 'pdf-cta-overrides-fallback',
        title: 'PDF CTA Overrides Fallback',
        ctaText: 'Download the PDF guide',
        ctaLink: artifact.blobKey,
        article_body: {
          schema_version: 'article_body.v1',
          nodes: [
            {
              id: 'n_body01',
              kind: 'content',
              public: { body: 'Download the guide below.' },
            },
            {
              id: 'n_fallback01',
              kind: 'action',
              public: {
                ctaText: 'Book a skin consultation',
                ctaLink: 'https://example.com/book-consultation',
              },
              visibility: 'public',
            },
            {
              id: 'n_partner01',
              kind: 'action',
              public: {
                ctaText: 'Shop the gentle cleanser',
                ctaLink: 'https://affiliate.example/gentle-cleanser',
              },
              visibility: 'public',
              commercial: {
                type: 'affiliateMention',
                source: 'affiliate',
                rel: 'sponsored',
                disclosure: { required: true, label: 'Affiliate link' },
              },
            },
          ],
        },
        artifactReferences: [artifact],
        overwrite: false,
      }),
    });

    assert.equal(response.statusCode, 201, response.body);
    const markdown = blobWrites[0]?.content ?? '';
    assert.ok(markdown.includes(`href="/${artifact.blobKey}"`));
    assert.ok(markdown.includes('>Download the PDF guide</a>'));
    assert.ok(markdown.includes('href="https://affiliate.example/gentle-cleanser"'));
    assert.ok(markdown.includes('>Shop the gentle cleanser</a>'));
    assert.doesNotMatch(markdown, /https:\/\/example\.com\/book-consultation/);
    assert.doesNotMatch(markdown, /Book a skin consultation/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article rejects top-level PDF CTA links with the same sha but wrong request', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';

  const originalFetch = globalThis.fetch;
  const pdfBytes = Buffer.from('%PDF-1.7\ntop-level wrong request');
  const upload = await postArtifact({
    requestId: 'req_smoke_pdfcta_20260701_04',
    artifactKind: 'pdf',
    contentType: 'application/pdf',
    filename: 'wrong-request.pdf',
    encoding: 'base64',
    payload: pdfBytes.toString('base64'),
  });
  const artifact = upload.artifact as { blobKey: string; sha256: string };
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
        slug: 'pdf-top-level-wrong-request',
        title: 'PDF Top Level Wrong Request',
        ctaText: 'Download PDF worksheet',
        ctaLink: `/pdf/wrong-request/${artifact.sha256}.pdf`,
        article_body: {
          schema_version: 'article_body.v1',
          nodes: [{ id: 'n_a1b2c3', kind: 'content', public: { body: 'Body.' } }],
        },
        artifactReferences: [artifact],
        overwrite: true,
      }),
    });

    assert.equal(response.statusCode, 422, response.body);
    assert.match(JSON.parse(response.body).error, /exact PDF artifactReference\.blobKey/);
    assert.equal(fetchCount, 0, 'Invalid top-level PDF CTA links should fail before GitHub requests.');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article rejects top-level PDF CTA links without a matching artifactReference', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';

  const originalFetch = globalThis.fetch;
  const pdfBytes = Buffer.from('%PDF-1.7\ntop-level no match');
  const upload = await postArtifact({
    requestId: 'req_smoke_pdfcta_20260701_05',
    artifactKind: 'pdf',
    contentType: 'application/pdf',
    filename: 'known.pdf',
    encoding: 'base64',
    payload: pdfBytes.toString('base64'),
  });
  const artifact = upload.artifact as { blobKey: string; sha256: string };
  const missingSha = 'f'.repeat(64);
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
        slug: 'pdf-top-level-no-match',
        title: 'PDF Top Level No Match',
        ctaText: 'Download PDF worksheet',
        ctaLink: `pdf/req_smoke_pdfcta_20260701_06/${missingSha}.pdf`,
        article_body: {
          schema_version: 'article_body.v1',
          nodes: [{ id: 'n_a1b2c3', kind: 'content', public: { body: 'Body.' } }],
        },
        artifactReferences: [artifact],
        overwrite: true,
      }),
    });

    assert.equal(response.statusCode, 422, response.body);
    assert.match(JSON.parse(response.body).error, /must match an exact artifactReference\.blobKey/);
    assert.equal(fetchCount, 0, 'Unmatched top-level PDF CTA links should fail before GitHub requests.');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article rejects placeholder and derived PDF CTA links', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';

  const originalFetch = globalThis.fetch;
  const requestId = 'req_smoke_pdfcta_20260701_03';
  const pdfBytes = Buffer.from('%PDF-1.7\nreal pdf artifact for derived rejection');
  const upload = await postArtifact({
    requestId,
    artifactKind: 'pdf',
    contentType: 'application/pdf',
    filename: 'derived-handout.pdf',
    encoding: 'base64',
    payload: pdfBytes.toString('base64'),
  });
  const artifact = upload.artifact as { blobKey: string; sha256: string };
  let fetchCount = 0;

  globalThis.fetch = (async () => {
    fetchCount += 1;
    return new Response('unexpected fetch', { status: 500 });
  }) as typeof fetch;

  const publishWithCtaLink = async (ctaLink: string) =>
    publishHandler({
      httpMethod: 'POST',
      headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'pdf-cta-derived-rejected',
        title: 'PDF CTA Derived Rejected',
        article_body: {
          schema_version: 'article_body.v1',
          nodes: [
            {
              id: 'n_a1b2c3',
              kind: 'content',
              public: { body: 'PDF CTA validation.', ctaText: 'Download handout', ctaLink },
            },
          ],
        },
        artifactReferences: [artifact],
        overwrite: true,
      }),
    });

  try {
    const placeholderResponse = await publishWithCtaLink('/pending-pdf-artifact-reference');
    assert.equal(placeholderResponse.statusCode, 422, placeholderResponse.body);
    assert.match(JSON.parse(placeholderResponse.body).error, /placeholder PDF link/);

    const derivedResponse = await publishWithCtaLink(`/pdf/derived-request/${artifact.sha256}.pdf`);
    assert.equal(derivedResponse.statusCode, 422, derivedResponse.body);
    assert.match(JSON.parse(derivedResponse.body).error, /derived from PDF path pieces/);
    assert.equal(fetchCount, 0, 'Invalid PDF CTA links should fail before GitHub requests.');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article rejects corrupt PDF artifact bytes before GitHub writes', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';

  const originalFetch = globalThis.fetch;
  const requestId = `artifact-corrupt-pdf-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const pdfBytes = Buffer.from('%PDF-1.7\nvalid pdf before blob tamper');
  const upload = await postArtifact({
    requestId,
    artifactKind: 'pdf',
    contentType: 'application/pdf',
    filename: 'tampered.pdf',
    encoding: 'base64',
    payload: pdfBytes.toString('base64'),
  });
  const { getArtifactBlobStore } = await import('../../netlify/lib/blob-store.js');
  const artifactStore = await getArtifactBlobStore({});
  await artifactStore.set(String(upload.artifact.blobKey), Buffer.from('not-pdf'.padEnd(pdfBytes.byteLength, '!')));
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requestedUrls.push(url);

    if (url.includes('/contents/src/data/post/corrupt-pdf-artifact.md')) {
      return new Response('not found', { status: 404 });
    }

    return new Response('unexpected fetch', { status: 500 });
  }) as typeof fetch;

  try {
    const response = await publishHandler({
      httpMethod: 'POST',
      headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'corrupt-pdf-artifact',
        title: 'Corrupt PDF Artifact',
        markdown: '# Corrupt PDF artifact',
        artifactReferences: [upload.artifact],
        overwrite: false,
      }),
    });

    assert.equal(response.statusCode, 422, response.body);
    assert.match(JSON.parse(response.body).error, /Invalid PDF artifact/);
    assert.equal(
      requestedUrls.some((url) => url.endsWith('/git/blobs')),
      false,
      'Corrupt PDF artifact references should fail before creating GitHub blobs.'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article rejects unsupported non-image non-PDF artifactReferences with a kind-specific error', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';

  const originalFetch = globalThis.fetch;
  const requestId = `artifact-data-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const upload = await postArtifact({
    requestId,
    artifactKind: 'data',
    contentType: 'application/octet-stream',
    filename: 'data.bin',
    encoding: 'base64',
    payload: Buffer.from('not article media').toString('base64'),
  });
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requestedUrls.push(url);

    if (url.includes('/contents/src/data/post/unsupported-artifact-reference.md')) {
      return new Response('not found', { status: 404 });
    }

    return new Response('unexpected fetch', { status: 500 });
  }) as typeof fetch;

  try {
    const response = await publishHandler({
      httpMethod: 'POST',
      headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'unsupported-artifact-reference',
        title: 'Unsupported Artifact Reference',
        markdown: '# Unsupported artifact reference\n\nThis article has enough words for publishing.',
        artifactReferences: [upload.artifact],
        overwrite: false,
      }),
    });

    assert.equal(response.statusCode, 422, response.body);
    assert.match(
      JSON.parse(response.body).error,
      /Unsupported artifactReference media type: application\/octet-stream/
    );
    assert.equal(
      requestedUrls.some((url) => url.endsWith('/git/blobs')),
      false,
      'Unsupported artifact references should fail before creating GitHub blobs.'
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

test('publish-article materializes and rewrites one image artifact used as featured and inline body media', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'feature/featured-inline-artifact-rewrite';

  const requestId = 'req_publish_featured_inline_20260702_01';
  const artifactBytes = await createImageBytes('png');
  const upload = await postArtifact({
    requestId,
    artifactKind: 'image',
    contentType: 'image/png',
    filename: 'shared-image.png',
    encoding: 'base64',
    payload: artifactBytes.toString('base64'),
    metadata: { filename: 'Shared Hero Inline.PNG' },
  });
  const artifact = upload.artifact as { blobKey: string };
  const originalFetch = globalThis.fetch;
  const blobWrites: Array<{ content: string; encoding: string }> = [];
  let treePaths: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url.includes('/contents/src/data/post/featured-inline-artifact-test.md')) {
      return new Response('not found', { status: 404 });
    }

    if (url.includes('/git/ref/heads/feature%2Ffeatured-inline-artifact-rewrite')) {
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

    if (url.includes('/git/refs/heads/feature%2Ffeatured-inline-artifact-rewrite') && method === 'PATCH') {
      return Response.json({ ok: true });
    }

    return new Response(`unexpected ${method} ${url}`, { status: 500 });
  }) as typeof fetch;

  try {
    const response = await publishHandler({
      httpMethod: 'POST',
      headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'featured-inline-artifact-test',
        title: 'Featured Inline Artifact Test',
        publishDate: '2026-07-02T00:00:00.000Z',
        featuredImage: artifact.blobKey,
        artifactReferences: [upload.artifact],
        article_body: {
          schema_version: 'article_body.v1',
          nodes: [
            {
              id: 'n_intro',
              kind: 'content',
              public: {
                title: 'Inline image section',
                body: 'The same artifact should appear as the hero and inline image.',
                media: {
                  type: 'image',
                  src: artifact.blobKey,
                  alt: 'Shared artifact image',
                },
              },
              rendering: { placement: 'inline' },
              visibility: 'public',
            },
          ],
        },
        overwrite: false,
      }),
    });

    const displayPath = '~/assets/images/uploads/featured-inline-artifact-test/shared-hero-inline.png';
    const repoPath = 'src/assets/images/uploads/featured-inline-artifact-test/shared-hero-inline.png';

    assert.equal(response.statusCode, 201, response.body);
    assert.equal(blobWrites[0]?.encoding, 'utf-8');
    assert.match(blobWrites[0]?.content ?? '', new RegExp(`image: "${displayPath}"`));
    assert.match(blobWrites[0]?.content ?? '', new RegExp(`!\\[Shared artifact image\\]\\(${displayPath}\\)`));
    assert.doesNotMatch(blobWrites[0]?.content ?? '', /image\/[a-z0-9._-]+\/[a-f0-9]{64}\.[a-z0-9]+/i);
    assert.equal(blobWrites[1]?.content, artifactBytes.toString('base64'));
    assert.deepEqual(treePaths, ['src/data/post/featured-inline-artifact-test.md', repoPath]);
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

test('publish-article leaves image frontmatter unset and warns missing_featured_image when no explicit featuredImage is named', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';

  const requestId = 'req_publish_featuredfallback_20260703_01';
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
    // No featuredImage or existingFeaturedImagePath, and the artifact is never referenced by any
    // article_body node — image: frontmatter must stay unset (no auto-promoted hero) and the
    // response must carry a missing_featured_image warning.
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
    assert.ok(
      !markdownContent.match(/^image:\s*/m),
      `Expected no "image:" in frontmatter.\nGot: ${markdownContent.slice(0, 300)}`
    );

    const body = JSON.parse(response.body) as { warnings?: Array<{ code: string }> };
    assert.ok(
      body.warnings?.some((w) => w.code === 'missing_featured_image'),
      `expected missing_featured_image warning, got: ${JSON.stringify(body.warnings)}`
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

test('publish-article returns 422 when article_body node src uses same sha256 as a top-level artifactReference but a different blobKey', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';

  // Upload one artifact under requestA; then publish with the same artifact in artifactReferences
  // but have the article_body node use a different blobKey (requestB) for the same sha256.
  const requestId = `cross-req-sha-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
  // Construct a pointer with a different requestId prefix but the same sha256/extension
  const crossRequestSrc = artifact.blobKey.replace(requestId, 'other-request-id');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('/contents/src/data/post/cross-req-sha-mismatch-test.md')) {
      return new Response('not found', { status: 404 });
    }
    return new Response(`unexpected ${method} ${url}`, { status: 500 });
  }) as typeof fetch;

  try {
    const response = await publishHandler({
      httpMethod: 'POST',
      headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'cross-req-sha-mismatch-test',
        title: 'Cross-Request SHA Mismatch Test',
        article_body: {
          schema_version: 'article_body.v1',
          nodes: [
            {
              id: 'n_hero',
              kind: 'content',
              rendering: { placement: 'inline' },
              public: {
                // src uses a different requestId than the artifact's blobKey
                media: { src: crossRequestSrc, type: 'image', alt: 'Hero image' },
              },
            },
          ],
        },
        // artifactReferences carries the real blobKey; the node's src differs
        artifactReferences: [artifact],
        overwrite: false,
      }),
    });

    assert.equal(response.statusCode, 422, response.body);
    const body = JSON.parse(response.body) as { error?: string };
    assert.ok(
      typeof body.error === 'string' && body.error.includes('does not match its blobKey'),
      `Expected blobKey mismatch error.\nGot: ${body.error}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article resolves cross-request pdf/ node pointer alongside image artifact and commits PDF bytes', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';

  // Image uploaded under requestId_A, PDF under requestId_B (different request — cross-request scenario)
  const requestIdA = 'req_smoke_imgpdf_20260701_01';
  const requestIdB = 'req_smoke_imgpdf_20260701_02';
  const slug = 'img-pdf-combo-test';

  const imageBytes = await createImageBytes('png');
  const imageUpload = await postArtifact({
    requestId: requestIdA,
    artifactKind: 'image',
    contentType: 'image/png',
    filename: 'combo-hero.png',
    encoding: 'base64',
    payload: imageBytes.toString('base64'),
    metadata: { filename: 'Combo Hero.PNG' },
  });
  const imageArtifact = imageUpload.artifact as { blobKey: string; sha256: string };

  const pdfBytes = Buffer.from('%PDF-1.7\ncross-request pdf for combo test');
  const pdfUpload = await postArtifact({
    requestId: requestIdB,
    artifactKind: 'pdf',
    contentType: 'application/pdf',
    filename: 'combo-tracker.pdf',
    encoding: 'base64',
    payload: pdfBytes.toString('base64'),
    metadata: { filename: 'Combo Tracker.PDF' },
  });
  const pdfArtifact = pdfUpload.artifact as { blobKey: string; sha256: string };

  const originalFetch = globalThis.fetch;
  const blobWrites: Array<{ content: string; encoding: string }> = [];
  let treePaths: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url.includes(`/contents/src/data/post/${slug}.md`)) {
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
    // Neither artifact is in top-level artifactReferences — both are cross-request via article_body nodes
    const response = await publishHandler({
      httpMethod: 'POST',
      headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
      body: JSON.stringify({
        slug,
        title: 'Image and PDF Combo Test',
        article_body: {
          schema_version: 'article_body.v1',
          nodes: [
            {
              id: 'n_hero',
              kind: 'content',
              rendering: { placement: 'inline' },
              public: {
                title: 'Track Your Skin Flares',
                body: 'Article intro content here.',
                media: { src: imageArtifact.blobKey, type: 'image', alt: 'Hero image' },
              },
            },
            {
              id: 'n_pdfdl',
              kind: 'content',
              rendering: { placement: 'inline' },
              public: {
                title: 'Download the tracker',
                body: 'Use this worksheet for your next visit.',
                media: { src: pdfArtifact.blobKey, type: 'document', title: 'Download the PDF' },
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

    // No explicit featuredImage/existingFeaturedImagePath was given, so frontmatter must NOT
    // auto-promote either artifact. The image node is id 'n_hero', so articleBodyToMarkdown also
    // suppresses its inline embed (hero-designated nodes render their image via the frontmatter
    // hero slot, never inline) — with no hero slot winner, the image renders nowhere, and the
    // pre-existing hero-suppression-collision warning (hero_image_not_rendered) fires alongside
    // missing_featured_image.
    assert.ok(
      !markdownContent.match(/^image:\s*/m),
      `Expected no image: frontmatter without an explicit featuredImage.\nGot: ${markdownContent.slice(0, 400)}`
    );
    assert.ok(
      !markdownContent.includes('![Hero image]'),
      `hero-designated node's image must not render inline (suppressed for the hero slot).\nGot: ${markdownContent.slice(0, 600)}`
    );

    const responseBody = JSON.parse(response.body) as { warnings?: Array<{ code: string; node_id: string | null }> };
    assert.ok(
      responseBody.warnings?.some((w) => w.code === 'hero_image_not_rendered' && w.node_id === 'n_hero'),
      `expected hero_image_not_rendered warning naming n_hero, got: ${JSON.stringify(responseBody.warnings)}`
    );
    assert.ok(
      responseBody.warnings?.some((w) => w.code === 'missing_featured_image'),
      `expected missing_featured_image warning, got: ${JSON.stringify(responseBody.warnings)}`
    );

    // PDF file must be committed to the tree (this is what fails before the fix)
    assert.ok(
      treePaths.some((p) => p.startsWith(`src/assets/documents/uploads/${slug}/`)),
      `PDF file must be committed to the tree.\nTree: ${treePaths.join(', ')}`
    );

    // Image file must also be committed
    assert.ok(
      treePaths.some((p) => p.startsWith(`src/assets/images/uploads/${slug}/`)),
      `Image file must be committed to the tree.\nTree: ${treePaths.join(', ')}`
    );

    // Raw artifact blobKeys must not appear as bare link targets in the committed markdown.
    // Image blobKey (image/...) must be fully replaced; PDF blobKey may appear as part of the
    // public /pdf/... CDN URL which is correct, but must not appear raw (preceded by "(" in markdown).
    assert.ok(
      !markdownContent.includes(imageArtifact.blobKey),
      `Raw image blobKey must not appear in markdown.\nGot: ${markdownContent.slice(0, 600)}`
    );
    assert.ok(
      !markdownContent.includes(`](${pdfArtifact.blobKey})`),
      `Raw PDF blobKey must not appear as a bare link target in markdown.\nGot: ${markdownContent.slice(0, 600)}`
    );

    // The PDF download link must be present in the body (either as repo path or public CDN URL)
    assert.ok(
      markdownContent.includes('/pdf/req_smoke_imgpdf_20260701_02/') ||
        markdownContent.includes('~/assets/documents/uploads/'),
      `PDF download link must appear in markdown body.\nGot: ${markdownContent.slice(0, 600)}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Path 1: multiple inline images, no featuredImage
// ---------------------------------------------------------------------------
test('publish-article renders multiple distinct inline image artifacts with no featuredImage', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';

  const requestId = 'req_test_multi_inline_20260702_01';
  const slug = 'multi-inline-only-test';
  const uploadsRoot = `src/assets/images/uploads/${slug}/`;
  const displayRoot = `~/assets/images/uploads/${slug}/`;

  // Two DISTINCT image artifacts (different encodings => different sha256).
  const uploadOne = await postArtifact({
    requestId,
    artifactKind: 'image',
    contentType: 'image/png',
    filename: 'first-inline.png',
    encoding: 'base64',
    payload: (await createImageBytes('png')).toString('base64'),
  });
  const uploadTwo = await postArtifact({
    requestId,
    artifactKind: 'image',
    contentType: 'image/webp',
    filename: 'second-inline.webp',
    encoding: 'base64',
    payload: (await createImageBytes('webp')).toString('base64'),
  });
  const artifactOne = uploadOne.artifact as { blobKey: string; sha256: string };
  const artifactTwo = uploadTwo.artifact as { blobKey: string; sha256: string };
  assert.notEqual(artifactOne.sha256, artifactTwo.sha256, 'the two images must be distinct artifacts');

  const originalFetch = globalThis.fetch;
  const blobWrites: Array<{ content: string; encoding: string }> = [];
  let treePaths: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes(`/contents/src/data/post/${slug}.md`)) return new Response('not found', { status: 404 });
    if (url.includes('/git/ref/heads/main')) return Response.json({ object: { sha: 'base-sha' } });
    if (url.endsWith('/git/commits/base-sha')) return Response.json({ tree: { sha: 'base-tree' } });
    if (url.endsWith('/git/blobs') && method === 'POST') {
      blobWrites.push(JSON.parse(String(init?.body)) as { content: string; encoding: string });
      return Response.json({ sha: `blob-${blobWrites.length}` });
    }
    if (url.endsWith('/git/trees') && method === 'POST') {
      treePaths = (JSON.parse(String(init?.body)) as { tree: Array<{ path: string }> }).tree.map((e) => e.path);
      return Response.json({ sha: 'new-tree' });
    }
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
        title: 'Multiple Inline Images',
        publishDate: '2026-07-02T00:00:00.000Z',
        // No featuredImage / existingFeaturedImagePath.
        artifactReferences: [uploadOne.artifact, uploadTwo.artifact],
        article_body: {
          schema_version: 'article_body.v1',
          nodes: [
            {
              id: 'n_one',
              kind: 'content',
              rendering: { placement: 'inline' },
              public: { title: 'One', media: { type: 'image', src: artifactOne.blobKey, alt: 'First image' } },
            },
            {
              id: 'n_two',
              kind: 'content',
              rendering: { placement: 'inline' },
              public: { title: 'Two', media: { type: 'image', src: artifactTwo.blobKey, alt: 'Second image' } },
            },
          ],
        },
        overwrite: false,
      }),
    });

    const markdown = blobWrites[0]?.content ?? '';

    assert.equal(response.statusCode, 201, response.body);

    // Both artifacts materialized under src/assets/images/uploads/<slug>/ and committed to the tree.
    const uploadedImagePaths = treePaths.filter((p) => p.startsWith(uploadsRoot));
    assert.equal(uploadedImagePaths.length, 2, `expected two uploaded images, got ${JSON.stringify(treePaths)}`);
    assert.ok(uploadedImagePaths.some((p) => p.endsWith('.png')));
    assert.ok(uploadedImagePaths.some((p) => p.endsWith('.webp')));

    // Both appear in the committed Markdown as separate inline image references.
    assert.ok(markdown.includes(`![First image](${displayRoot}`), `first inline image missing:\n${markdown}`);
    assert.ok(markdown.includes(`![Second image](${displayRoot}`), `second inline image missing:\n${markdown}`);

    // Neither raw artifact blobKey survives into the committed Markdown.
    assert.doesNotMatch(markdown, /image\/[a-z0-9._-]+\/[a-f0-9]{64}\.[a-z0-9]+/i);
    assert.ok(!markdown.includes(artifactOne.blobKey) && !markdown.includes(artifactTwo.blobKey));

    // With no explicit featuredImage, frontmatter must NOT auto-promote either inline image — that
    // silent fallback is what caused the promoted image to render twice (once as hero, once inline).
    assert.ok(
      !markdown.match(/^image:\s*/m),
      `Expected no image: frontmatter without an explicit featuredImage.\nGot: ${markdown.slice(0, 400)}`
    );

    // Each image's display path appears exactly once across the committed Markdown (no duplicate render).
    const displayRootOccurrences = markdown.split(displayRoot).length - 1;
    assert.equal(
      displayRootOccurrences,
      2,
      `expected each of the two images to appear exactly once, got ${displayRootOccurrences}:\n${markdown}`
    );

    const body = JSON.parse(response.body) as { warnings?: Array<{ code: string }> };
    assert.ok(
      body.warnings?.some((w) => w.code === 'missing_featured_image'),
      `expected missing_featured_image warning, got: ${JSON.stringify(body.warnings)}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Path 2: image featuredImage + PDF CTA link combined
// ---------------------------------------------------------------------------
test('publish-article publishes an image featuredImage alongside a PDF CTA link', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';

  const requestId = 'req_test_img_pdf_cta_20260702_01';
  const slug = 'image-pdf-cta-test';

  const imageUpload = await postArtifact({
    requestId,
    artifactKind: 'image',
    contentType: 'image/png',
    filename: 'combo-hero.png',
    encoding: 'base64',
    payload: (await createImageBytes('png')).toString('base64'),
  });
  const image = imageUpload.artifact as { blobKey: string; sha256: string };

  const pdfUpload = await postArtifact({
    requestId,
    artifactKind: 'pdf',
    contentType: 'application/pdf',
    filename: 'worksheet.pdf',
    encoding: 'base64',
    payload: Buffer.from('%PDF-1.7\nimage + pdf cta combo').toString('base64'),
  });
  const pdf = pdfUpload.artifact as { blobKey: string; sha256: string };

  const originalFetch = globalThis.fetch;
  const blobWrites: Array<{ content: string; encoding: string }> = [];
  let treePaths: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes(`/contents/src/data/post/${slug}.md`)) return new Response('not found', { status: 404 });
    if (url.includes('/git/ref/heads/main')) return Response.json({ object: { sha: 'base-sha' } });
    if (url.endsWith('/git/commits/base-sha')) return Response.json({ tree: { sha: 'base-tree' } });
    if (url.endsWith('/git/blobs') && method === 'POST') {
      blobWrites.push(JSON.parse(String(init?.body)) as { content: string; encoding: string });
      return Response.json({ sha: `blob-${blobWrites.length}` });
    }
    if (url.endsWith('/git/trees') && method === 'POST') {
      treePaths = (JSON.parse(String(init?.body)) as { tree: Array<{ path: string }> }).tree.map((e) => e.path);
      return Response.json({ sha: 'new-tree' });
    }
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
        title: 'Image and PDF CTA',
        publishDate: '2026-07-02T00:00:00.000Z',
        featuredImage: image.blobKey,
        artifactReferences: [imageUpload.artifact, pdfUpload.artifact],
        article_body: {
          schema_version: 'article_body.v1',
          nodes: [
            {
              id: 'n_dl1',
              kind: 'content',
              public: {
                title: 'Download the worksheet',
                body: 'Grab the tracker before your visit.',
                ctaText: 'Download handout',
                ctaLink: pdf.blobKey,
              },
            },
          ],
        },
        overwrite: false,
      }),
    });

    const markdown = blobWrites[0]?.content ?? '';

    assert.equal(response.statusCode, 201, response.body);

    // Image materialized under images/uploads, PDF under documents/uploads.
    assert.ok(
      treePaths.some((p) => p.startsWith(`src/assets/images/uploads/${slug}/`)),
      `image not under images/uploads: ${JSON.stringify(treePaths)}`
    );
    assert.ok(
      treePaths.some((p) => p.startsWith(`src/assets/documents/uploads/${slug}/`)),
      `pdf not under documents/uploads: ${JSON.stringify(treePaths)}`
    );

    // PDF CTA link rewritten to the public /pdf/<requestId>/<sha>.pdf URL.
    assert.ok(
      markdown.includes(`href="/pdf/${requestId}/${pdf.sha256}.pdf"`),
      `pdf cta link not rewritten to /pdf/ public url:\n${markdown}`
    );

    // Image blobKey is fully rewritten away (frontmatter image: uses the ~/assets path).
    assert.ok(!markdown.includes(image.blobKey), 'image blobKey must be rewritten away');
    assert.doesNotMatch(markdown, /image\/[a-z0-9._-]+\/[a-f0-9]{64}\.[a-z0-9]+/i);

    // PDF blobKey never appears as a raw/unrewritten reference — only inside the /pdf/ public URL
    // (blobKey === `pdf/<req>/<sha>.pdf`, so the correct link `/pdf/<req>/<sha>.pdf` contains it,
    // preceded by '/'). Assert it is not used bare as a link target or text.
    for (const boundary of ['"', '(', ' ', '\n']) {
      assert.ok(
        !markdown.includes(`${boundary}${pdf.blobKey}`),
        `raw pdf blobKey must not appear unrewritten (near ${JSON.stringify(boundary)}):\n${markdown}`
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Missing hero/featured image handling (no silent auto-selection) + HERO_IMAGE_REQUIRED
// ---------------------------------------------------------------------------

test('publish-article publishes with no images and no featuredImage, with no missing_featured_image warning', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';
  delete process.env.HERO_IMAGE_REQUIRED;

  const slug = 'missing-hero-no-images-test';
  const originalFetch = globalThis.fetch;
  const blobWrites: Array<{ content: string; encoding: string }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes(`/contents/src/data/post/${slug}.md`)) return new Response('not found', { status: 404 });
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
        title: 'Missing Hero No Images Test',
        markdown: '# No images anywhere in this article\n',
        overwrite: false,
      }),
    });

    assert.equal(response.statusCode, 201, response.body);
    const markdown = blobWrites[0]?.content ?? '';
    assert.ok(!markdown.match(/^image:\s*/m), `expected no image: frontmatter, got: ${markdown.slice(0, 300)}`);

    const body = JSON.parse(response.body) as { warnings?: Array<{ code: string }> };
    assert.ok(
      !body.warnings?.some((w) => w.code === 'missing_featured_image'),
      `did not expect missing_featured_image warning for a text-only article, got: ${JSON.stringify(body.warnings)}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article renders a single inline image exactly once with no featuredImage (T3 regression)', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';
  delete process.env.HERO_IMAGE_REQUIRED;

  const requestId = 'req_test_t3_regression_20260703_01';
  const slug = 't3-regression-single-inline-test';
  const displayRoot = `~/assets/images/uploads/${slug}/`;

  const upload = await postArtifact({
    requestId,
    artifactKind: 'image',
    contentType: 'image/png',
    filename: 'single-inline.png',
    encoding: 'base64',
    payload: (await createImageBytes('png')).toString('base64'),
  });
  const artifact = upload.artifact as { blobKey: string };

  const originalFetch = globalThis.fetch;
  const blobWrites: Array<{ content: string; encoding: string }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes(`/contents/src/data/post/${slug}.md`)) return new Response('not found', { status: 404 });
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
        title: 'T3 Regression Single Inline Test',
        publishDate: '2026-07-03T00:00:00.000Z',
        artifactReferences: [artifact],
        article_body: {
          schema_version: 'article_body.v1',
          nodes: [
            {
              id: 'n_only',
              kind: 'content',
              rendering: { placement: 'inline' },
              public: { title: 'Only', media: { type: 'image', src: artifact.blobKey, alt: 'Only image' } },
            },
          ],
        },
        overwrite: false,
      }),
    });

    assert.equal(response.statusCode, 201, response.body);
    const markdown = blobWrites[0]?.content ?? '';

    assert.ok(!markdown.match(/^image:\s*/m), `expected no image: frontmatter, got: ${markdown.slice(0, 300)}`);

    const occurrences = markdown.split(displayRoot).length - 1;
    assert.equal(occurrences, 1, `expected the image display path exactly once, got ${occurrences}:\n${markdown}`);

    const body = JSON.parse(response.body) as { warnings?: Array<{ code: string }> };
    assert.ok(
      body.warnings?.some((w) => w.code === 'missing_featured_image'),
      `expected missing_featured_image warning, got: ${JSON.stringify(body.warnings)}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article renders two inline images exactly once each with no featuredImage (T5 regression)', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';
  delete process.env.HERO_IMAGE_REQUIRED;

  const requestId = 'req_test_t5_regression_20260703_01';
  const slug = 't5-regression-two-inline-test';
  const displayRoot = `~/assets/images/uploads/${slug}/`;

  const uploadOne = await postArtifact({
    requestId,
    artifactKind: 'image',
    contentType: 'image/png',
    filename: 'first.png',
    encoding: 'base64',
    payload: (await createImageBytes('png')).toString('base64'),
  });
  const uploadTwo = await postArtifact({
    requestId,
    artifactKind: 'image',
    contentType: 'image/webp',
    filename: 'second.webp',
    encoding: 'base64',
    payload: (await createImageBytes('webp')).toString('base64'),
  });
  const artifactOne = uploadOne.artifact as { blobKey: string; sha256: string };
  const artifactTwo = uploadTwo.artifact as { blobKey: string; sha256: string };
  assert.notEqual(artifactOne.sha256, artifactTwo.sha256, 'the two images must be distinct artifacts');

  const originalFetch = globalThis.fetch;
  const blobWrites: Array<{ content: string; encoding: string }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes(`/contents/src/data/post/${slug}.md`)) return new Response('not found', { status: 404 });
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
        title: 'T5 Regression Two Inline Test',
        publishDate: '2026-07-03T00:00:00.000Z',
        artifactReferences: [artifactOne, artifactTwo],
        article_body: {
          schema_version: 'article_body.v1',
          nodes: [
            {
              id: 'n_one',
              kind: 'content',
              rendering: { placement: 'inline' },
              public: { title: 'One', media: { type: 'image', src: artifactOne.blobKey, alt: 'First image' } },
            },
            {
              id: 'n_two',
              kind: 'content',
              rendering: { placement: 'inline' },
              public: { title: 'Two', media: { type: 'image', src: artifactTwo.blobKey, alt: 'Second image' } },
            },
          ],
        },
        overwrite: false,
      }),
    });

    assert.equal(response.statusCode, 201, response.body);
    const markdown = blobWrites[0]?.content ?? '';

    assert.ok(!markdown.match(/^image:\s*/m), `expected no image: frontmatter, got: ${markdown.slice(0, 300)}`);

    const occurrences = markdown.split(displayRoot).length - 1;
    assert.equal(occurrences, 2, `expected each of the two images exactly once, got ${occurrences}:\n${markdown}`);

    const body = JSON.parse(response.body) as { warnings?: Array<{ code: string }> };
    assert.ok(
      body.warnings?.some((w) => w.code === 'missing_featured_image'),
      `expected missing_featured_image warning, got: ${JSON.stringify(body.warnings)}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article with an explicit featuredImage renders the hero correctly with no missing_featured_image warning', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';
  delete process.env.HERO_IMAGE_REQUIRED;

  const requestId = 'req_test_explicit_featured_20260703_01';
  const slug = 'explicit-featured-image-test';

  const upload = await postArtifact({
    requestId,
    artifactKind: 'image',
    contentType: 'image/png',
    filename: 'hero.png',
    encoding: 'base64',
    payload: (await createImageBytes('png')).toString('base64'),
  });
  const artifact = upload.artifact as { blobKey: string };

  const originalFetch = globalThis.fetch;
  const blobWrites: Array<{ content: string; encoding: string }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes(`/contents/src/data/post/${slug}.md`)) return new Response('not found', { status: 404 });
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
        title: 'Explicit Featured Image Test',
        publishDate: '2026-07-03T00:00:00.000Z',
        featuredImage: artifact.blobKey,
        artifactReferences: [artifact],
        markdown: '# Explicit featured image test\n',
        overwrite: false,
      }),
    });

    assert.equal(response.statusCode, 201, response.body);
    const markdown = blobWrites[0]?.content ?? '';
    assert.match(markdown, /^image:\s*"~\/assets\/images\/uploads\/explicit-featured-image-test\//m);

    const body = JSON.parse(response.body) as { warnings?: Array<{ code: string }> };
    assert.ok(
      !body.warnings?.some((w) => w.code === 'missing_featured_image'),
      `did not expect missing_featured_image warning, got: ${JSON.stringify(body.warnings)}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article rejects a missing featured image with 422 before any GitHub write when HERO_IMAGE_REQUIRED is true', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';

  const heroRequiredHandler = await getHeroRequiredPublishHandler();
  const requestId = 'req_test_hero_required_with_images_20260703_01';
  const slug = 'hero-required-with-images-test';

  const upload = await postArtifact({
    requestId,
    artifactKind: 'image',
    contentType: 'image/png',
    filename: 'unused-inline.png',
    encoding: 'base64',
    payload: (await createImageBytes('png')).toString('base64'),
  });
  const artifact = upload.artifact as { blobKey: string };

  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    requestedUrls.push(`${method} ${url}`);
    if (url.includes(`/contents/src/data/post/${slug}.md`)) return new Response('not found', { status: 404 });
    return new Response(`unexpected ${method} ${url}`, { status: 500 });
  }) as typeof fetch;

  try {
    const response = await heroRequiredHandler({
      httpMethod: 'POST',
      headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
      body: JSON.stringify({
        slug,
        title: 'Hero Required With Images Test',
        artifactReferences: [artifact],
        article_body: {
          schema_version: 'article_body.v1',
          nodes: [
            {
              id: 'n_one',
              kind: 'content',
              rendering: { placement: 'inline' },
              public: { title: 'One', media: { type: 'image', src: artifact.blobKey, alt: 'Inline only' } },
            },
          ],
        },
        overwrite: false,
      }),
    });

    assert.equal(response.statusCode, 422, response.body);
    const body = JSON.parse(response.body) as { error?: string };
    assert.equal(body.error, 'featured_image_required');

    assert.deepEqual(
      requestedUrls.filter((url) => /\/git\/(blobs|trees|commits|refs)/.test(url)),
      [],
      `expected no GitHub write calls, got: ${JSON.stringify(requestedUrls)}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article rejects a missing featured image with 422 when HERO_IMAGE_REQUIRED is true even with zero images in the article', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';

  const heroRequiredHandler = await getHeroRequiredPublishHandler();
  const slug = 'hero-required-no-images-test';

  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    requestedUrls.push(`${method} ${url}`);
    if (url.includes(`/contents/src/data/post/${slug}.md`)) return new Response('not found', { status: 404 });
    return new Response(`unexpected ${method} ${url}`, { status: 500 });
  }) as typeof fetch;

  try {
    const response = await heroRequiredHandler({
      httpMethod: 'POST',
      headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
      body: JSON.stringify({
        slug,
        title: 'Hero Required No Images Test',
        markdown: '# No images at all in this article body\n',
        overwrite: false,
      }),
    });

    assert.equal(response.statusCode, 422, response.body);
    const body = JSON.parse(response.body) as { error?: string };
    assert.equal(body.error, 'featured_image_required');

    assert.deepEqual(
      requestedUrls.filter((url) => /\/git\/(blobs|trees|commits|refs)/.test(url)),
      [],
      `expected no GitHub write calls, got: ${JSON.stringify(requestedUrls)}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article edit via existingFeaturedImagePath resolves the hero with no missing_featured_image warning', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';
  delete process.env.HERO_IMAGE_REQUIRED;

  const existingBytes = await createImageBytes('png');
  const originalFetch = globalThis.fetch;
  const blobWrites: Array<{ content: string; encoding: string }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('/contents/src/data/post/existing-hero-edit-test.md')) {
      return new Response('not found', { status: 404 });
    }
    if (url.includes('/contents/src/assets/images/uploads/shared/existing-hero-edit.png')) {
      return Response.json({ type: 'file', encoding: 'base64', content: existingBytes.toString('base64') });
    }
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
        slug: 'existing-hero-edit-test',
        title: 'Existing Hero Edit Test',
        markdown: '# Existing hero edit test\n',
        existingFeaturedImagePath: 'src/assets/images/uploads/shared/existing-hero-edit.png',
        images: [{ repoPath: 'src/assets/images/uploads/shared/existing-hero-edit.png' }],
      }),
    });

    assert.equal(response.statusCode, 201, response.body);
    const markdown = blobWrites[0]?.content ?? '';
    assert.match(markdown, /image:\s*"~\/assets\/images\/uploads\/shared\/existing-hero-edit\.png"/);

    const body = JSON.parse(response.body) as { warnings?: Array<{ code: string }> };
    assert.ok(
      !body.warnings?.some((w) => w.code === 'missing_featured_image'),
      `did not expect missing_featured_image warning, got: ${JSON.stringify(body.warnings)}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article node with no placement is never auto-promoted to hero; warns image_not_rendered and missing_featured_image (T7 regression)', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';
  delete process.env.HERO_IMAGE_REQUIRED;

  const requestId = 'req_test_t7_regression_20260703_01';
  const slug = 't7-regression-no-placement-test';
  const displayRoot = `~/assets/images/uploads/${slug}/`;

  const upload = await postArtifact({
    requestId,
    artifactKind: 'image',
    contentType: 'image/png',
    filename: 'no-placement.png',
    encoding: 'base64',
    payload: (await createImageBytes('png')).toString('base64'),
  });
  const artifact = upload.artifact as { blobKey: string };

  const originalFetch = globalThis.fetch;
  const blobWrites: Array<{ content: string; encoding: string }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes(`/contents/src/data/post/${slug}.md`)) return new Response('not found', { status: 404 });
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
        title: 'T7 Regression No Placement Test',
        publishDate: '2026-07-03T00:00:00.000Z',
        artifactReferences: [artifact],
        article_body: {
          schema_version: 'article_body.v1',
          nodes: [
            {
              id: 'n_noplacement',
              kind: 'content',
              public: {
                title: 'No Placement',
                media: { type: 'image', src: artifact.blobKey, alt: 'No placement image' },
              },
            },
          ],
        },
        overwrite: false,
      }),
    });

    assert.equal(response.statusCode, 201, response.body);
    const markdown = blobWrites[0]?.content ?? '';

    assert.ok(!markdown.match(/^image:\s*/m), `expected no image: frontmatter, got: ${markdown.slice(0, 300)}`);

    const occurrences = markdown.split(displayRoot).length - 1;
    assert.ok(
      occurrences <= 1,
      `image must never render more than once (never auto-promoted), got ${occurrences}:\n${markdown}`
    );

    const body = JSON.parse(response.body) as { warnings?: Array<{ code: string; node_id: string | null }> };
    assert.ok(
      body.warnings?.some((w) => w.code === 'image_not_rendered' && w.node_id === 'n_noplacement'),
      `expected image_not_rendered warning for n_noplacement, got: ${JSON.stringify(body.warnings)}`
    );
    assert.ok(
      body.warnings?.some((w) => w.code === 'missing_featured_image'),
      `expected missing_featured_image warning, got: ${JSON.stringify(body.warnings)}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish-article resolves frontmatter hero to the explicit featuredImage over a colliding n_hero node (T8 regression)', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';
  delete process.env.HERO_IMAGE_REQUIRED;

  const requestId = 'req_test_t8_regression_20260703_01';
  const slug = 't8-regression-hero-collision-test';

  const uploadA = await postArtifact({
    requestId,
    artifactKind: 'image',
    contentType: 'image/png',
    filename: 'hero-node-image.png',
    encoding: 'base64',
    payload: (await createImageBytes('png')).toString('base64'),
    metadata: { filename: 'Hero Node Image.PNG' },
  });
  const uploadB = await postArtifact({
    requestId,
    artifactKind: 'image',
    contentType: 'image/webp',
    filename: 'featured-image.webp',
    encoding: 'base64',
    payload: (await createImageBytes('webp')).toString('base64'),
    metadata: { filename: 'Featured Image.WEBP' },
  });
  const artifactA = uploadA.artifact as { blobKey: string; sha256: string };
  const artifactB = uploadB.artifact as { blobKey: string; sha256: string };
  assert.notEqual(artifactA.sha256, artifactB.sha256, 'the two images must be distinct artifacts');

  const originalFetch = globalThis.fetch;
  const blobWrites: Array<{ content: string; encoding: string }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes(`/contents/src/data/post/${slug}.md`)) return new Response('not found', { status: 404 });
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
        title: 'T8 Regression Hero Collision Test',
        publishDate: '2026-07-03T00:00:00.000Z',
        featuredImage: artifactB.blobKey,
        artifactReferences: [artifactA, artifactB],
        article_body: {
          schema_version: 'article_body.v1',
          nodes: [
            {
              id: 'n_hero',
              kind: 'content',
              rendering: { placement: 'inline' },
              public: { title: 'Hero', media: { type: 'image', src: artifactA.blobKey, alt: 'Hero node image' } },
            },
          ],
        },
        overwrite: false,
      }),
    });

    assert.equal(response.statusCode, 201, response.body);
    const markdown = blobWrites[0]?.content ?? '';

    assert.match(
      markdown,
      /^image:\s*"~\/assets\/images\/uploads\/t8-regression-hero-collision-test\/featured-image\.webp"/m
    );

    const body = JSON.parse(response.body) as { warnings?: Array<{ code: string; node_id: string | null }> };
    assert.ok(
      body.warnings?.some((w) => w.code === 'hero_image_not_rendered' && w.node_id === 'n_hero'),
      `expected hero_image_not_rendered warning naming n_hero, got: ${JSON.stringify(body.warnings)}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
