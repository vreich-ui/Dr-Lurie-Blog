import '../../sites/drlurie/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { handler } from '../../netlify/functions/get-public-pdf.js';
import { getArtifactBlobStore, setNetlifyBlobsModuleForTesting } from '../../packages/core/server/lib/blob-store.js';
import { requestArtifactReferenceKey } from '../../packages/core/server/lib/artifact-index.js';

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

const setArtifactBytes = async (blobKey: string, bytes: Buffer) => {
  const artifactStore = await getArtifactBlobStore({});

  await artifactStore.set(blobKey, bytes, {
    metadata: {
      contentType: 'application/pdf',
      sha256: sha256(bytes),
      sizeBytes: String(bytes.byteLength),
    },
  });
};

type FakeMetadata = Record<string, string>;

/**
 * Fake `artifacts` blob store, routed in via setNetlifyBlobsModuleForTesting (the same
 * pattern used by save-artifact.test.ts / blob-store.test.ts), so tests can seed exact blob
 * metadata and inspect the ArrayBuffer/metadata pairing get-public-pdf.ts's
 * store.getWithMetadata() call receives.
 */
const createFakeArtifactsStore = () => {
  const blobs = new Map<string, { bytes: Buffer; metadata?: FakeMetadata }>();

  return {
    seed(key: string, bytes: Buffer, metadata?: FakeMetadata) {
      blobs.set(key, { bytes, metadata });
    },
    store: {
      async set(key: string, value: Buffer | string, options?: { metadata?: FakeMetadata }) {
        blobs.set(key, {
          bytes: typeof value === 'string' ? Buffer.from(value) : Buffer.from(value),
          metadata: options?.metadata,
        });
      },
      async setJSON() {
        throw new Error('setJSON is not used by get-public-pdf.');
      },
      async get(key: string) {
        const entry = blobs.get(key);
        return entry ? entry.bytes.toString('utf8') : null;
      },
      async getWithMetadata(key: string, options?: { type?: string }) {
        const entry = blobs.get(key);
        if (!entry) return null;

        const data =
          options?.type === 'arrayBuffer'
            ? entry.bytes.buffer.slice(entry.bytes.byteOffset, entry.bytes.byteOffset + entry.bytes.byteLength)
            : entry.bytes.toString('utf8');

        return { data, metadata: entry.metadata };
      },
      async del(key: string) {
        blobs.delete(key);
      },
      async list() {
        return { blobs: [...blobs.keys()].map((key) => ({ key, etag: '' })), directories: [] };
      },
    },
  };
};

/**
 * Fake `artifact-index` store with a `.get()` call counter — this is what backs the
 * perf-sensitive "read exactly once" / "never read" assertions below.
 */
const createFakeIndexStore = () => {
  const values = new Map<string, string>();
  let getCalls = 0;

  return {
    getCallCount: () => getCalls,
    seedReference(requestId: string, sha: string, reference: unknown) {
      values.set(requestArtifactReferenceKey(requestId, sha), JSON.stringify(reference));
    },
    store: {
      async set() {},
      async setJSON(key: string, value: unknown) {
        values.set(key, JSON.stringify(value));
      },
      async get(key: string) {
        getCalls += 1;
        return values.get(key) ?? null;
      },
      async del(key: string) {
        values.delete(key);
      },
      async list() {
        return { blobs: [...values.keys()].map((key) => ({ key, etag: '' })), directories: [] };
      },
    },
  };
};

const withFakeBlobStores = async (
  run: (stores: {
    artifacts: ReturnType<typeof createFakeArtifactsStore>;
    index: ReturnType<typeof createFakeIndexStore>;
  }) => Promise<void>
) => {
  const previousNetlify = process.env.NETLIFY;
  const previousSiteId = process.env.NETLIFY_SITE_ID;
  const artifacts = createFakeArtifactsStore();
  const index = createFakeIndexStore();

  process.env.NETLIFY = 'true';
  process.env.NETLIFY_SITE_ID = '';

  setNetlifyBlobsModuleForTesting({
    connectLambda() {},
    getStore(input: string | { name: string }) {
      const storeName = typeof input === 'string' ? input : input.name;

      if (storeName === 'artifacts')
        return artifacts.store as unknown as ReturnType<typeof createFakeArtifactsStore>['store'];
      if (storeName === 'artifact-index')
        return index.store as unknown as ReturnType<typeof createFakeIndexStore>['store'];
      throw new Error(`Unexpected blob store: ${storeName}`);
    },
  });

  try {
    await run({ artifacts, index });
  } finally {
    setNetlifyBlobsModuleForTesting(undefined);

    if (previousNetlify === undefined) delete process.env.NETLIFY;
    else process.env.NETLIFY = previousNetlify;

    if (previousSiteId === undefined) delete process.env.NETLIFY_SITE_ID;
    else process.env.NETLIFY_SITE_ID = previousSiteId;
  }
};

const buildBlobKey = (requestId: string, digest: string) => `pdf/${requestId}/${digest}.pdf`;

/**
 * A valid, unique-per-call req_<flow>_<topic>_<yyyymmdd>_<nn> id — required for a seeded
 * ArtifactReference to pass isValidArtifactBlobKey's validateRequestId check (the
 * artifact-index reference tests below need a reference that actually validates, unlike the
 * looser `[a-z0-9._-]+` requestId shape get-public-pdf.ts's own blobKey pattern accepts).
 */
const uniqueRequestId = (label: string): string => {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const seq = String(Math.floor(Math.random() * 100)).padStart(2, '0');
  const topic = label.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'case';
  return `req_test_${topic}_${date}_${seq}`;
};

test('get-public-pdf streams PDF artifact without admin credentials', async () => {
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  const requestId = `public-pdf-stream-${Date.now()}`;
  const bytes = Buffer.from('%PDF-1.4 public pdf content');
  const blobKey = `pdf/${requestId}/${sha256(bytes)}.pdf`;
  await setArtifactBytes(blobKey, bytes);

  const response = await handler({
    httpMethod: 'GET',
    queryStringParameters: { blobKey },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Content-Type'], 'application/pdf');
  assert.equal((response as { isBase64Encoded?: boolean }).isBase64Encoded, true);
  assert.equal(Buffer.from(response.body, 'base64').toString(), bytes.toString());
});

test('get-public-pdf accepts clean public PDF paths and falls back to the sha-based filename', async () => {
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  const requestId = `public-pdf-path-${Date.now()}`;
  const bytes = Buffer.from('%PDF-1.4 public path pdf content');
  const digest = sha256(bytes);
  const blobKey = `pdf/${requestId}/${digest}.pdf`;
  await setArtifactBytes(blobKey, bytes);

  const response = await handler({
    httpMethod: 'GET',
    path: `/${blobKey}`,
    queryStringParameters: null,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Content-Type'], 'application/pdf');
  // No originalFilename/label metadata and no artifact-index reference exist for this
  // request, so — today's behavior, preserved — both Content-Disposition forms fall back
  // to the blobKey's sha-based basename.
  assert.equal(
    response.headers['Content-Disposition'],
    `attachment; filename="${digest}.pdf"; filename*=UTF-8''${digest}.pdf`
  );
  assert.equal(Buffer.from(response.body, 'base64').toString(), bytes.toString());
});

test('get-public-pdf accepts legacy artifacts/pdf blobKey values', async () => {
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  const requestId = `public-pdf-legacy-${Date.now()}`;
  const bytes = Buffer.from('%PDF-1.4 public legacy pdf content');
  const blobKey = `pdf/${requestId}/${sha256(bytes)}.pdf`;
  await setArtifactBytes(blobKey, bytes);

  const response = await handler({
    httpMethod: 'GET',
    queryStringParameters: { blobKey: `artifacts/${blobKey}` },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(Buffer.from(response.body, 'base64').toString(), bytes.toString());
});

test('get-public-pdf rejects invalid blobKey shape', async () => {
  const response = await handler({
    httpMethod: 'GET',
    queryStringParameters: { blobKey: '../secret.pdf' },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.body, /valid PDF artifact blobKey/);
});

test('get-public-pdf sets an immutable Cache-Control and X-Content-Type-Options nosniff', async () => {
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  const requestId = `public-pdf-cache-headers-${Date.now()}`;
  const bytes = Buffer.from('%PDF-1.4 cache header pdf content');
  const blobKey = `pdf/${requestId}/${sha256(bytes)}.pdf`;
  await setArtifactBytes(blobKey, bytes);

  const response = await handler({
    httpMethod: 'GET',
    queryStringParameters: { blobKey },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Cache-Control'], 'public, max-age=31536000, immutable');
  assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
});

test('get-public-pdf HEAD requests return the same headers with an empty body', async () => {
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  const requestId = `public-pdf-head-${Date.now()}`;
  const bytes = Buffer.from('%PDF-1.4 head request pdf content');
  const blobKey = `pdf/${requestId}/${sha256(bytes)}.pdf`;
  await setArtifactBytes(blobKey, bytes);

  const getResponse = await handler({ httpMethod: 'GET', queryStringParameters: { blobKey } });
  const headResponse = await handler({ httpMethod: 'HEAD', queryStringParameters: { blobKey } });

  assert.equal(headResponse.statusCode, 200);
  assert.equal(headResponse.body, '');
  assert.equal((headResponse as { isBase64Encoded?: boolean }).isBase64Encoded, false);
  assert.deepEqual(headResponse.headers, getResponse.headers);
});

test('get-public-pdf uses metadata.originalFilename for Content-Disposition, sanitized and .pdf-suffixed', async () => {
  await withFakeBlobStores(async ({ artifacts }) => {
    const requestId = `public-pdf-original-filename-${Date.now()}`;
    const bytes = Buffer.from('%PDF-1.4 originalFilename metadata pdf content');
    const digest = sha256(bytes);
    const blobKey = buildBlobKey(requestId, digest);
    artifacts.seed(blobKey, bytes, { originalFilename: 'Product Catalog' });

    const response = await handler({ httpMethod: 'GET', queryStringParameters: { blobKey } });

    assert.equal(response.statusCode, 200);
    assert.equal(
      response.headers['Content-Disposition'],
      `attachment; filename="Product_Catalog.pdf"; filename*=UTF-8''Product%20Catalog.pdf`
    );
  });
});

test('get-public-pdf falls back to metadata.label when originalFilename is absent', async () => {
  await withFakeBlobStores(async ({ artifacts }) => {
    const requestId = `public-pdf-label-${Date.now()}`;
    const bytes = Buffer.from('%PDF-1.4 label metadata pdf content');
    const digest = sha256(bytes);
    const blobKey = buildBlobKey(requestId, digest);
    artifacts.seed(blobKey, bytes, { label: 'Quarterly Report' });

    const response = await handler({ httpMethod: 'GET', queryStringParameters: { blobKey } });

    assert.equal(response.statusCode, 200);
    assert.equal(
      response.headers['Content-Disposition'],
      `attachment; filename="Quarterly_Report.pdf"; filename*=UTF-8''Quarterly%20Report.pdf`
    );
  });
});

test('get-public-pdf falls back to the artifact-index reference name, reading the index store exactly once', async () => {
  await withFakeBlobStores(async ({ artifacts, index }) => {
    const requestId = uniqueRequestId('indexname');
    const bytes = Buffer.from('%PDF-1.4 index-name pdf content');
    const digest = sha256(bytes);
    const blobKey = buildBlobKey(requestId, digest);
    artifacts.seed(blobKey, bytes); // no name in blob metadata

    index.seedReference(requestId, digest, {
      blobKey,
      sizeBytes: bytes.byteLength,
      sha256: digest,
      contentType: 'application/pdf',
      createdAtISO: new Date().toISOString(),
      artifactKind: 'pdf',
      originalFilename: 'Index Sourced Name',
    });

    const response = await handler({ httpMethod: 'GET', queryStringParameters: { blobKey } });

    assert.equal(response.statusCode, 200);
    assert.equal(
      response.headers['Content-Disposition'],
      `attachment; filename="Index_Sourced_Name.pdf"; filename*=UTF-8''Index%20Sourced%20Name.pdf`
    );
    assert.equal(index.getCallCount(), 1);
  });
});

test('get-public-pdf never reads the artifact-index store when blob metadata already carries a name', async () => {
  await withFakeBlobStores(async ({ artifacts, index }) => {
    const requestId = `public-pdf-warm-path-${Date.now()}`;
    const bytes = Buffer.from('%PDF-1.4 warm metadata pdf content');
    const digest = sha256(bytes);
    const blobKey = buildBlobKey(requestId, digest);
    artifacts.seed(blobKey, bytes, { originalFilename: 'Warm Path Name' });

    const response = await handler({ httpMethod: 'GET', queryStringParameters: { blobKey } });

    assert.equal(response.statusCode, 200);
    assert.equal(index.getCallCount(), 0);
  });
});

test('get-public-pdf falls back to the sha-based filename when no name exists anywhere (metadata or index)', async () => {
  await withFakeBlobStores(async ({ artifacts, index }) => {
    const requestId = `public-pdf-no-name-${Date.now()}`;
    const bytes = Buffer.from('%PDF-1.4 no name anywhere pdf content');
    const digest = sha256(bytes);
    const blobKey = buildBlobKey(requestId, digest);
    artifacts.seed(blobKey, bytes);

    const response = await handler({ httpMethod: 'GET', queryStringParameters: { blobKey } });

    assert.equal(response.statusCode, 200);
    assert.equal(
      response.headers['Content-Disposition'],
      `attachment; filename="${digest}.pdf"; filename*=UTF-8''${digest}.pdf`
    );
    // The index lookup was attempted (metadata alone had nothing) but found nothing either.
    assert.equal(index.getCallCount(), 1);
  });
});

test('get-public-pdf produces a safe filename and a correct filename* for names with spaces, slashes, quotes, and non-ASCII characters', async () => {
  await withFakeBlobStores(async ({ artifacts }) => {
    const requestId = `public-pdf-unicode-name-${Date.now()}`;
    const bytes = Buffer.from('%PDF-1.4 unicode name pdf content');
    const digest = sha256(bytes);
    const blobKey = buildBlobKey(requestId, digest);
    const rawName = 'Café "Menu"/Q3 Report.pdf';
    artifacts.seed(blobKey, bytes, { originalFilename: rawName });

    const response = await handler({ httpMethod: 'GET', queryStringParameters: { blobKey } });

    assert.equal(response.statusCode, 200);
    const disposition = response.headers['Content-Disposition'] as string;
    assert.match(disposition, /^attachment; filename="[^"]*"; filename\*=UTF-8''.+$/);

    const asciiMatch = disposition.match(/filename="([^"]*)"/);
    assert.ok(asciiMatch);
    const asciiName = asciiMatch![1];
    assert.doesNotMatch(asciiName, /[^a-zA-Z0-9._-]/);
    assert.match(asciiName, /\.pdf$/);

    const starMatch = disposition.match(/filename\*=UTF-8''(.+)$/);
    assert.ok(starMatch);
    assert.equal(decodeURIComponent(starMatch![1]), rawName);
  });
});
