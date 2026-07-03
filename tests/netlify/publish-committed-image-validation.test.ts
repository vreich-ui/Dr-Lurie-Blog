import assert from 'node:assert/strict';
import test from 'node:test';

import sharp from 'sharp';

import { _publishInternal, handler as publishHandler } from '../../netlify/functions/publish-article.js';
import { handler as saveArtifactHandler } from '../../netlify/functions/save-artifact.js';

const publishSecret = 'committed-image-validation-test-secret';

type MediaEntryParam = Parameters<typeof _publishInternal.validateCommittedImageReferences>[2][number];

const makeImageEntry = (overrides: Partial<MediaEntryParam> = {}): MediaEntryParam => ({
  kind: 'image',
  content: '',
  contentType: 'image/png',
  displayPath: '~/assets/images/uploads/some-slug/pic.png',
  encoding: 'base64',
  filename: 'pic.png',
  path: 'src/assets/images/uploads/some-slug/pic.png',
  rawBytes: Buffer.alloc(0),
  ...overrides,
});

const artifactReference = (requestId: string, sha256: string) => ({
  blobKey: `image/${requestId}/${sha256}.png`,
  sha256,
  sizeBytes: 10,
  contentType: 'image/png',
  createdAtISO: '2026-07-03T00:00:00.000Z',
  artifactKind: 'image' as const,
});

// ---------------------------------------------------------------------------
// validateCommittedImageReferences — direct coverage of every throw branch
// (PR #329 landed the guard with no tests on its throw paths).
// ---------------------------------------------------------------------------

test('validateCommittedImageReferences throws 422 when a raw image artifact ref survives into the markdown', () => {
  const requestId = 'req_publish_civ_20260703_01';
  const sha = 'a'.repeat(64);
  const markdown = `---\ntitle: "x"\n---\n\n![alt](image/${requestId}/${sha}.png)\n`;

  assert.throws(
    () => _publishInternal.validateCommittedImageReferences(markdown, undefined, [], false),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /raw image artifact reference/);
      assert.ok(error.message.includes(`image/${requestId}/${sha}.png`), 'must name the surviving raw ref');
      assert.equal((error as { statusCode?: number }).statusCode, 422);
      return true;
    }
  );
});

test('validateCommittedImageReferences throws 422 when the frontmatter image does not match a materialized entry', () => {
  const markdown = `---\ntitle: "x"\nimage: "~/assets/images/uploads/some-slug/ghost.png"\n---\n\nBody.\n`;

  assert.throws(
    () =>
      _publishInternal.validateCommittedImageReferences(
        markdown,
        '~/assets/images/uploads/some-slug/ghost.png',
        [makeImageEntry()],
        true
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /does not match a materialized image media entry/);
      assert.equal((error as { statusCode?: number }).statusCode, 422);
      return true;
    }
  );
});

test('validateCommittedImageReferences throws 422 when markdown references an artifact-backed asset that is not committed', () => {
  const requestId = 'req_publish_civ_20260703_02';
  const entry = makeImageEntry({
    artifactReference: artifactReference(requestId, 'b'.repeat(64)),
    persist: false,
  });
  const markdown = `---\ntitle: "x"\n---\n\n![alt](${entry.displayPath})\n`;

  assert.throws(
    () => _publishInternal.validateCommittedImageReferences(markdown, undefined, [entry], false),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /not being committed with this publish/);
      assert.ok(error.message.includes(entry.displayPath));
      assert.equal((error as { statusCode?: number }).statusCode, 422);
      return true;
    }
  );
});

test('validateCommittedImageReferences passes a fully materialized publish', () => {
  const entry = makeImageEntry({ artifactReference: artifactReference('req_publish_civ_20260703_03', 'c'.repeat(64)) });
  const markdown = `---\ntitle: "x"\nimage: "${entry.displayPath}"\n---\n\n![alt](${entry.displayPath})\n`;

  assert.doesNotThrow(() =>
    _publishInternal.validateCommittedImageReferences(markdown, entry.displayPath, [entry], true)
  );
});

// ---------------------------------------------------------------------------
// End-to-end: handler wiring for raw refs, the hero-suppression collision, and
// hero + inline dual-slot dedup.
// ---------------------------------------------------------------------------

const setPublishEnv = () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';
};

const createImageBytes = (red: number) =>
  sharp({ create: { width: 2, height: 2, channels: 3, background: { r: red, g: 20, b: 30 } } })
    .png()
    .toBuffer();

const postArtifact = async (requestId: string, red: number) => {
  const bytes = await createImageBytes(red);
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
  return (JSON.parse(response.body) as { artifact: { blobKey: string; sha256: string } }).artifact;
};

type PublishBody = {
  error?: string;
  imagePaths?: string[];
  warnings?: Array<{ code: string; node_id: string; reason: string }>;
};

const publishWithMockedGitHub = async (
  payload: Record<string, unknown>
): Promise<{
  statusCode: number;
  body: PublishBody;
  markdown: string;
  committedMediaBlobCount: number;
}> => {
  setPublishEnv();

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
      body: JSON.stringify(payload),
    });
    return {
      statusCode: response.statusCode,
      body: JSON.parse(response.body) as PublishBody,
      // blobWrites[0] is the committed Markdown blob (written before media blobs).
      markdown: blobWrites[0]?.content ?? '',
      committedMediaBlobCount: Math.max(0, blobWrites.length - 1),
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
};

test('publish-article returns 422 when legacy markdown input carries a raw image artifact ref', async () => {
  const requestId = 'req_publish_civ_20260703_04';
  const rawRef = `image/${requestId}/${'d'.repeat(64)}.png`;
  const { statusCode, body } = await publishWithMockedGitHub({
    slug: 'raw-ref-in-markdown',
    title: 'Raw Ref In Markdown',
    publishDate: '2026-07-03T10:00:00.000Z',
    markdown: `Intro paragraph.\n\n![hero](${rawRef})\n`,
  });

  assert.equal(statusCode, 422, JSON.stringify(body));
  assert.match(String(body.error), /raw image artifact reference/);
  assert.ok(String(body.error).includes(rawRef));
});

test('hero-suppression collision: hero node loses the hero slot and gets a hero_image_not_rendered warning', async () => {
  const requestId = 'req_publish_civ_20260703_05';
  const heroNodeArtifact = await postArtifact(requestId, 40);
  const featuredArtifact = await postArtifact(requestId, 200);
  assert.notEqual(heroNodeArtifact.sha256, featuredArtifact.sha256);

  const { statusCode, body, markdown } = await publishWithMockedGitHub({
    slug: 'hero-collision',
    title: 'Hero Collision',
    publishDate: '2026-07-03T10:00:00.000Z',
    article_body: {
      schema_version: 'article_body.v1',
      nodes: [
        {
          id: 'n_hero',
          kind: 'content',
          public: { title: 'Hero', media: { type: 'image', src: heroNodeArtifact.blobKey, alt: 'Hero' } },
          rendering: { placement: 'inline' },
        },
        { id: 'n_body1', kind: 'content', public: { body: 'Body copy.' } },
      ],
    },
    featuredImage: featuredArtifact.blobKey,
    artifactReferences: [heroNodeArtifact, featuredArtifact],
  });

  assert.equal(statusCode, 201, JSON.stringify(body));
  const heroWarning = body.warnings?.find((warning) => warning.code === 'hero_image_not_rendered');
  assert.ok(heroWarning, `expected a hero_image_not_rendered warning, got ${JSON.stringify(body.warnings)}`);
  assert.equal(heroWarning?.node_id, 'n_hero');
  assert.match(heroWarning?.reason ?? '', /appears nowhere/i);

  // The collision itself: frontmatter carries the featured artifact, the hero node's inline
  // embed is suppressed, so the hero node's image is absent from the committed markdown.
  const heroSha = heroNodeArtifact.blobKey.split('/').pop()?.replace('.png', '') ?? '';
  assert.doesNotMatch(markdown, new RegExp(heroSha), 'the losing hero image must not appear in the markdown');
});

test('hero node whose image IS the featured image publishes with no hero warning and no duplicate embed', async () => {
  const requestId = 'req_publish_civ_20260703_06';
  const artifact = await postArtifact(requestId, 90);

  const { statusCode, body, markdown } = await publishWithMockedGitHub({
    slug: 'hero-match',
    title: 'Hero Match',
    publishDate: '2026-07-03T10:00:00.000Z',
    article_body: {
      schema_version: 'article_body.v1',
      nodes: [
        {
          id: 'n_hero',
          kind: 'content',
          public: { title: 'Hero', media: { type: 'image', src: artifact.blobKey, alt: 'Hero' } },
          rendering: { placement: 'inline' },
        },
      ],
    },
    featuredImage: artifact.blobKey,
    artifactReferences: [artifact],
  });

  assert.equal(statusCode, 201, JSON.stringify(body));
  assert.equal(body.warnings, undefined, `no warning expected: ${JSON.stringify(body.warnings)}`);
  assert.match(markdown, /image: "~\/assets\/images\/uploads\/hero-match\//);
  assert.doesNotMatch(markdown, /!\[/, 'the hero image must not be duplicated as an inline embed');
});

test('one artifact in the hero slot AND an inline node commits one file with two references', async () => {
  const requestId = 'req_publish_civ_20260703_07';
  const artifact = await postArtifact(requestId, 150);

  const { statusCode, body, markdown, committedMediaBlobCount } = await publishWithMockedGitHub({
    slug: 'hero-and-inline-dedup',
    title: 'Hero And Inline Dedup',
    publishDate: '2026-07-03T10:00:00.000Z',
    article_body: {
      schema_version: 'article_body.v1',
      nodes: [
        {
          id: 'n_hero',
          kind: 'content',
          public: { title: 'Hero', media: { type: 'image', src: artifact.blobKey, alt: 'Hero' } },
          rendering: { placement: 'inline' },
        },
        {
          id: 'n_img2',
          kind: 'content',
          public: { title: 'Inline', media: { type: 'image', src: artifact.blobKey, alt: 'Inline' } },
          rendering: { placement: 'inline' },
        },
      ],
    },
    featuredImage: artifact.blobKey,
    artifactReferences: [artifact],
  });

  assert.equal(statusCode, 201, JSON.stringify(body));
  assert.equal(committedMediaBlobCount, 1, 'the shared artifact must be committed exactly once');
  assert.equal(body.warnings, undefined, `no warnings expected: ${JSON.stringify(body.warnings)}`);

  const displayPathMatch = markdown.match(/image: "(~\/assets\/images\/uploads\/hero-and-inline-dedup\/[^"]+)"/);
  assert.ok(displayPathMatch, `frontmatter image expected in:\n${markdown}`);
  const displayPath = displayPathMatch[1];

  const bodyReferences = markdown.split('\n---\n')[1] ?? '';
  const inlineOccurrences = bodyReferences.split(displayPath).length - 1;
  assert.equal(inlineOccurrences, 1, 'the inline node renders once; the hero embed is suppressed');
  assert.ok(!markdown.includes(artifact.blobKey), 'no raw blobKey may survive into the committed markdown');
});
