/**
 * W3 step 2 integration proof — the taxonomy enforcement hook through the REAL
 * publish-article handler, against the REAL registry body (the tax_drlurie
 * seed), in an isolated local site-objects store:
 *
 *   - registry present + resolvable terms → publish succeeds and the COMMITTED
 *     frontmatter carries the canonical slugs (§5.5 step 3 normalization);
 *   - registry present + junk term → 422 TAXONOMY_TERMS_UNRESOLVED, nothing
 *     committed;
 *   - registry absent → covered by every pre-existing publish-article test
 *     (all 56 run storeless of taxonomy and take the skip path unchanged).
 */
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { handler as publishHandler } from '../../netlify/functions/publish-article.js';
import { getSiteObjectsBlobStore } from '../../netlify/lib/blob-store.js';
import { setLocalBlobsRootForTesting } from '../../netlify/lib/local-blobs.js';
import { TAXONOMY_RECORD_KEY } from '../../netlify/lib/taxonomy-enforcement.js';
import { taxonomyBody } from '../../scripts/lib/taxonomy-seed-data.mjs';

const publishSecret = 'taxonomy-publish-test-secret';

// Isolated local store root (site-objects falls back to the file store when no
// NETLIFY runtime env is present) — same isolation pattern as the object suites.
const LOCAL_BLOBS_ROOT = join(process.cwd(), '.netlify', 'local-blobs-test', 'taxonomy-publish');
setLocalBlobsRootForTesting(LOCAL_BLOBS_ROOT);

const setEnv = () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-test-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';
};

const seedRegistry = async () => {
  await rm(LOCAL_BLOBS_ROOT, { recursive: true, force: true });
  const store = await getSiteObjectsBlobStore({});
  await store.setJSON(TAXONOMY_RECORD_KEY, {
    object_id: 'tax_drlurie',
    object_type: 'taxonomy',
    body: taxonomyBody,
  });
};

/** GitHub mock capturing committed blobs; the article path reads as absent. */
const mockGitHub = (slug: string) => {
  const blobWrites: Array<{ content: string; encoding: string }> = [];
  const originalFetch = globalThis.fetch;
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
  return { blobWrites, restore: () => (globalThis.fetch = originalFetch) };
};

const publish = (body: Record<string, unknown>) =>
  publishHandler({
    httpMethod: 'POST',
    headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('resolvable labels publish, and the committed frontmatter carries canonical slugs', async () => {
  setEnv();
  await seedRegistry();
  const github = mockGitHub('taxonomy-normalize-test');
  try {
    const response = await publish({
      slug: 'taxonomy-normalize-test',
      title: 'Taxonomy Normalize Test',
      markdown: '# Body',
      publishDate: '2026-07-11',
      category: 'Skin Health', // label form → canonical slug
      tags: ['Skin Barrier', 'skin-barrier', 'Retinoids'], // dup collapses; label resolves
      overwrite: false,
    });
    assert.equal(response.statusCode, 201, response.body);

    const committed = github.blobWrites[0]?.content ?? '';
    assert.match(committed, /category: "skin-health"/);
    assert.match(committed, /- "skin-barrier"/);
    assert.match(committed, /- "retinoids"/);
    assert.ok(!committed.includes('"Skin Barrier"'), 'raw label must be normalized away');
    assert.equal((committed.match(/- "skin-barrier"/g) ?? []).length, 1, 'duplicates collapse');
  } finally {
    github.restore();
  }
});

test('a junk term rejects with TAXONOMY_TERMS_UNRESOLVED and commits nothing', async () => {
  setEnv();
  await seedRegistry();
  const github = mockGitHub('taxonomy-reject-test');
  try {
    const response = await publish({
      slug: 'taxonomy-reject-test',
      title: 'Taxonomy Reject Test',
      markdown: '# Body',
      publishDate: '2026-07-11',
      category: 'Skin Health',
      tags: ['smoke-test'],
      overwrite: false,
    });
    assert.equal(response.statusCode, 422, response.body);
    const body = JSON.parse(response.body) as { code?: string; unresolved?: string[] };
    assert.equal(body.code, 'TAXONOMY_TERMS_UNRESOLVED');
    assert.deepEqual(body.unresolved, ['tag "smoke-test"']);
    assert.equal(github.blobWrites.length, 0, 'nothing may be committed on rejection');
  } finally {
    github.restore();
  }
});
