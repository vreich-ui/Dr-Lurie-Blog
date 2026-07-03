import assert from 'node:assert/strict';
import test from 'node:test';

import { handler as verifyHandler } from '../../netlify/functions/verify-article-images.js';
import {
  createAdminArtifactPreviewLoader,
  getAdminBlobImageEndpoint,
} from '../../src/lib/admin/artifact-preview.js';

const publishSecret = 'verify-images-matching-test-secret';

type VerifyResponseBody = {
  verified: boolean;
  inconclusive?: boolean;
  pageStatus?: number;
  errors?: string[];
  images: Array<{
    expected: string;
    present: boolean;
    ok: boolean;
    matchedUrl?: string;
    matchedBy?: string;
    error?: string;
  }>;
};

const callVerify = async (
  expectedImages: string[],
  routes: Record<string, () => Response>
): Promise<VerifyResponseBody> => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [route, respond] of Object.entries(routes)) {
      if (url === route) return respond();
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  try {
    const response = await verifyHandler({
      httpMethod: 'POST',
      headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/learn/my-article', expectedImages }),
    });
    return JSON.parse(response.body) as VerifyResponseBody;
  } finally {
    globalThis.fetch = originalFetch;
  }
};

const pageHtml = (imgTags: string) => `<!doctype html><html><body><article>${imgTags}</article></body></html>`;
const pngResponse = () => new Response('png-bytes', { status: 200, headers: { 'content-type': 'image/png' } });
const webpResponse = () => new Response('webp-bytes', { status: 200, headers: { 'content-type': 'image/webp' } });

test('verify matches Astro-hashed build URLs by filename stem for committed display paths', async () => {
  const body = await callVerify(['~/assets/images/uploads/my-article/hero-shot.png'], {
    'https://example.com/learn/my-article': () =>
      new Response(pageHtml('<img src="/_astro/hero-shot.C3jHx8yz.webp" alt="hero">'), {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    'https://example.com/_astro/hero-shot.C3jHx8yz.webp': webpResponse,
  });

  assert.equal(body.verified, true, JSON.stringify(body));
  assert.equal(body.inconclusive, false);
  assert.equal(body.pageStatus, 200);
  assert.equal(body.images[0].present, true);
  assert.equal(body.images[0].matchedBy, 'filename-stem');
  assert.equal(body.images[0].matchedUrl, 'https://example.com/_astro/hero-shot.C3jHx8yz.webp');
  assert.equal(body.images[0].ok, true);
});

test('verify collects srcset variants and exact URL matches report matchedBy exact', async () => {
  const body = await callVerify(['/images/direct.png', '/_astro/inline-pic.Zx12ab.webp'], {
    'https://example.com/learn/my-article': () =>
      new Response(
        pageHtml(
          '<img src="/images/direct.png">' +
            '<img src="/_astro/other.abc.webp" srcset="/_astro/inline-pic.Zx12ab.webp 400w, /_astro/other.abc.webp 720w">'
        ),
        { status: 200, headers: { 'content-type': 'text/html' } }
      ),
    'https://example.com/images/direct.png': pngResponse,
    'https://example.com/_astro/inline-pic.Zx12ab.webp': webpResponse,
  });

  assert.equal(body.verified, true, JSON.stringify(body));
  assert.equal(body.images[0].matchedBy, 'exact');
  assert.equal(body.images[1].matchedBy, 'exact', 'srcset-only variants must be collected as sources');
});

test('verify reports a definite failure (not inconclusive) when the page is live but the image is absent', async () => {
  const body = await callVerify(['~/assets/images/uploads/my-article/missing-pic.png'], {
    'https://example.com/learn/my-article': () =>
      new Response(pageHtml('<img src="/_astro/unrelated.Aa11bb.webp">'), {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
  });

  assert.equal(body.verified, false);
  assert.equal(body.inconclusive, false, 'a live page with a missing image is a proven defect, not inconclusive');
  assert.equal(body.images[0].present, false);
  assert.ok(body.images[0].error, 'the missing image must carry an error');
});

test('verify marks a non-200 page as inconclusive with deploy-timing guidance', async () => {
  const body = await callVerify(['~/assets/images/uploads/my-article/hero-shot.png'], {
    'https://example.com/learn/my-article': () => new Response('not deployed yet', { status: 404 }),
  });

  assert.equal(body.verified, false);
  assert.equal(body.inconclusive, true, 'a page that is not live yet must be inconclusive');
  assert.equal(body.pageStatus, 404);
  assert.match(String(body.errors?.[0]), /deploy may not be live yet/);
  assert.match(String(body.errors?.[0]), /deploy_status/);
});

// ---------------------------------------------------------------------------
// Admin artifact preview (Stage 5.3): blobKeys resolve through admin-get-blob-image
// ---------------------------------------------------------------------------

test('getAdminBlobImageEndpoint builds the admin preview URL for valid image blobKeys only', () => {
  const sha = 'a'.repeat(64);
  assert.equal(
    getAdminBlobImageEndpoint(`image/req_publish_demo_20260703_01/${sha}.png`),
    `/.netlify/functions/admin-get-blob-image?blobKey=${encodeURIComponent(`image/req_publish_demo_20260703_01/${sha}.png`)}`
  );
  assert.equal(getAdminBlobImageEndpoint(`pdf/req_publish_demo_20260703_01/${sha}.pdf`), undefined);
  assert.equal(getAdminBlobImageEndpoint('https://example.com/x.png'), undefined);
  assert.equal(getAdminBlobImageEndpoint('~/assets/images/uploads/slug/x.png'), undefined);
});

test('createAdminArtifactPreviewLoader fetches with the identity token and returns an object URL', async () => {
  const sha = 'b'.repeat(64);
  const blobKey = `image/req_publish_demo_20260703_02/${sha}.png`;
  const requests: Array<{ url: string; authorization: string | undefined }> = [];

  const loader = createAdminArtifactPreviewLoader({
    getToken: async () => 'identity-token-123',
    fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get('authorization') ?? undefined,
      });
      return new Response(Buffer.from('png-bytes'), { status: 200, headers: { 'content-type': 'image/png' } });
    }) as typeof fetch,
    createObjectUrl: () => 'blob:mock-object-url',
  });

  const url = await loader(blobKey);

  assert.equal(url, 'blob:mock-object-url');
  assert.equal(requests.length, 1);
  assert.ok(requests[0].url.includes(encodeURIComponent(blobKey)));
  assert.equal(requests[0].authorization, 'Bearer identity-token-123');
});

test('createAdminArtifactPreviewLoader resolves undefined on auth failure and non-artifact refs', async () => {
  const loader = createAdminArtifactPreviewLoader({
    getToken: async () => 'identity-token-123',
    fetchFn: (async () => new Response('forbidden', { status: 403 })) as typeof fetch,
    createObjectUrl: () => 'blob:should-not-happen',
  });

  assert.equal(await loader(`image/req_publish_demo_20260703_03/${'c'.repeat(64)}.png`), undefined);
  assert.equal(await loader('not-an-artifact-ref'), undefined);
});
