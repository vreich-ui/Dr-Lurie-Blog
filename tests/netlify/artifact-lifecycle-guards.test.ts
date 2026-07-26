import '../../sites/drlurie/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { handler as saveArtifactLegacyHandler } from '../../netlify/functions/save-artifact.js';
import { saveArtifactBytes } from '../../packages/core/server/lib/artifact-upload.js';
import { listArtifactReferencesForRequest, type ArtifactIndexStore } from '../../packages/core/server/lib/artifact-index.js';
import { getArtifactIndexBlobStore, setNetlifyBlobsModuleForTesting } from '../../packages/core/server/lib/blob-store.js';
import { ArtifactKind, type ArtifactReference } from '../../packages/core/server/lib/artifacts.js';

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

// 1x1 transparent PNG — decodes with sharp.
const validPngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

type FakeStoreValue = Buffer | string;

const createFakeStore = (values = new Map<string, FakeStoreValue>()) => ({
  values,
  store: {
    async set(key: string, value: string | Buffer | Uint8Array, options?: { onlyIfNew?: boolean }) {
      if (options?.onlyIfNew && values.has(key)) return { modified: false };
      values.set(key, typeof value === 'string' ? value : Buffer.from(value));
      return { modified: true };
    },
    async setJSON(key: string, value: unknown) {
      values.set(key, JSON.stringify(value));
      return { modified: true };
    },
    async get(key: string, options?: { type?: 'arrayBuffer' }) {
      const value = values.get(key);
      if (value === undefined) return null;
      if (options?.type === 'arrayBuffer') {
        const bytes = typeof value === 'string' ? Buffer.from(value) : value;
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      }
      return typeof value === 'string' ? value : value.toString('utf8');
    },
    async del(key: string) {
      values.delete(key);
    },
    async list(options?: { prefix?: string }) {
      const prefix = options?.prefix ?? '';
      const blobs = Array.from(values.keys())
        .filter((key) => key.startsWith(prefix))
        .map((key) => ({ key, etag: '' }));
      return { blobs, directories: [] };
    },
  },
});

const withBlobStores = async (
  fn: (stores: {
    artifactValues: Map<string, FakeStoreValue>;
    indexValues: Map<string, FakeStoreValue>;
  }) => Promise<void>
) => {
  const previousNetlify = process.env.NETLIFY;
  const previousSiteId = process.env.NETLIFY_SITE_ID;
  const previousPublishSecret = process.env.NETLIFY_PUBLISH_SECRET;

  const { values: artifactValues, store: artifactStore } = createFakeStore();
  const { values: indexValues, store: indexStore } = createFakeStore();

  process.env.NETLIFY = 'true';
  process.env.NETLIFY_SITE_ID = '';
  process.env.NETLIFY_PUBLISH_SECRET = 'test-secret';

  setNetlifyBlobsModuleForTesting({
    connectLambda() {},
    getStore(input: string | { name: string }) {
      const storeName = typeof input === 'string' ? input : input.name;
      if (storeName === 'artifacts') return artifactStore as never;
      if (storeName === 'artifact-index') return indexStore as never;
      throw new Error(`Unexpected blob store: ${storeName}`);
    },
  });

  try {
    await fn({ artifactValues, indexValues });
  } finally {
    setNetlifyBlobsModuleForTesting(undefined);
    if (previousNetlify === undefined) delete process.env.NETLIFY;
    else process.env.NETLIFY = previousNetlify;
    if (previousSiteId === undefined) delete process.env.NETLIFY_SITE_ID;
    else process.env.NETLIFY_SITE_ID = previousSiteId;
    if (previousPublishSecret === undefined) delete process.env.NETLIFY_PUBLISH_SECRET;
    else process.env.NETLIFY_PUBLISH_SECRET = previousPublishSecret;
  }
};

const callLegacySaveArtifact = async (payload: Record<string, unknown>) => {
  const response = await saveArtifactLegacyHandler({
    httpMethod: 'POST',
    headers: { 'x-publish-key': 'test-secret' },
    body: JSON.stringify(payload),
  });

  return { statusCode: response.statusCode, body: JSON.parse(response.body) as Record<string, unknown> };
};

test('legacy save_artifact validates image/* content types regardless of the declared artifactKind', async () => {
  await withBlobStores(async () => {
    const bytes = Buffer.from('this is not a decodable image');
    const result = await callLegacySaveArtifact({
      requestId: 'req_publish_lifecycle_20260703_01',
      artifactKind: 'attachment',
      contentType: 'image/png',
      payload: bytes.toString('base64'),
    });

    assert.equal(result.statusCode, 400, JSON.stringify(result.body));
    assert.match(String(result.body.error), /Invalid image artifact/i);
  });
});

test('legacy save_artifact validates PDF bytes like the direct upload path', async () => {
  await withBlobStores(async () => {
    const bytes = Buffer.from('not a pdf at all');
    const result = await callLegacySaveArtifact({
      requestId: 'req_publish_lifecycle_20260703_02',
      artifactKind: 'pdf',
      contentType: 'application/pdf',
      payload: bytes.toString('base64'),
    });

    assert.equal(result.statusCode, 400, JSON.stringify(result.body));
    assert.match(String(result.body.error), /%PDF-/);
  });
});

test('re-uploading identical bytes restores a soft-deleted reference on the direct upload path', async () => {
  await withBlobStores(async ({ indexValues }) => {
    const requestId = 'req_publish_lifecycle_20260703_03';
    const digest = sha256(validPngBytes);
    const upload = () =>
      saveArtifactBytes({
        requestId,
        artifactKind: ArtifactKind.Image,
        contentType: 'image/png',
        expectedSizeBytes: validPngBytes.byteLength,
        expectedSha256: digest,
        bytes: validPngBytes,
        filename: 'pixel.png',
      });

    const first = await upload();
    assert.equal(first.ok, true, JSON.stringify(first));

    // Simulate an admin soft delete of the reference JSON.
    const referenceKey = `request-artifacts/${requestId}/${digest}.json`;
    const stored = JSON.parse(String(indexValues.get(referenceKey))) as ArtifactReference;
    indexValues.set(
      referenceKey,
      JSON.stringify({ ...stored, deletedAtISO: '2026-07-01T00:00:00.000Z', deletedBy: 'admin@example.com' })
    );

    const indexStore = (await getArtifactIndexBlobStore({})) as unknown as ArtifactIndexStore;
    assert.equal((await listArtifactReferencesForRequest(indexStore, requestId)).length, 0);

    const reupload = await upload();
    assert.equal(reupload.ok, true, JSON.stringify(reupload));
    if (!reupload.ok) return;
    assert.equal(reupload.deduped, true);
    assert.equal(reupload.restored, true, 'a deduped re-upload of a soft-deleted artifact must report restored');
    assert.equal(reupload.artifact.deletedAtISO, undefined, 'the returned reference must not carry deletedAtISO');
    assert.equal(reupload.artifact.deletedBy, undefined);

    const listed = await listArtifactReferencesForRequest(indexStore, requestId);
    assert.equal(listed.length, 1, 'the restored artifact must be visible to list/trust/publish again');
    assert.equal(listed[0].sha256, digest);
  });
});

test('re-uploading identical bytes restores a soft-deleted reference on the legacy save_artifact path', async () => {
  await withBlobStores(async ({ indexValues }) => {
    const requestId = 'req_publish_lifecycle_20260703_04';
    const digest = sha256(validPngBytes);
    const upload = () =>
      callLegacySaveArtifact({
        requestId,
        artifactKind: 'image',
        contentType: 'image/png',
        filename: 'pixel.png',
        payload: validPngBytes.toString('base64'),
      });

    const first = await upload();
    assert.equal(first.statusCode, 201, JSON.stringify(first.body));

    const referenceKey = `request-artifacts/${requestId}/${digest}.json`;
    const stored = JSON.parse(String(indexValues.get(referenceKey))) as ArtifactReference;
    indexValues.set(
      referenceKey,
      JSON.stringify({ ...stored, deletedAtISO: '2026-07-01T00:00:00.000Z', deletedBy: 'admin@example.com' })
    );

    const reupload = await upload();
    assert.equal(reupload.statusCode, 200, JSON.stringify(reupload.body));
    const artifact = reupload.body.artifact as ArtifactReference;
    assert.equal(reupload.body.restored, true);
    assert.equal(artifact.deletedAtISO, undefined, 'the returned reference must not carry deletedAtISO');

    const indexStore = (await getArtifactIndexBlobStore({})) as unknown as ArtifactIndexStore;
    const listed = await listArtifactReferencesForRequest(indexStore, requestId);
    assert.equal(listed.length, 1);
  });
});

test('listArtifactReferencesForRequest merges pointer-backed and reference-only artifacts', async () => {
  const requestId = 'req_publish_lifecycle_20260703_05';
  const { values, store } = createFakeStore();

  const makeReference = (seed: string, extension: string): ArtifactReference => {
    const digest = sha256(Buffer.from(seed));
    return {
      blobKey: `image/${requestId}/${digest}${extension}`,
      sizeBytes: seed.length,
      sha256: digest,
      contentType: 'image/png',
      createdAtISO: '2026-07-01T00:00:00.000Z',
      artifactKind: 'image',
    };
  };

  const pointerBacked = makeReference('pointer-backed', '.png');
  const referenceOnly = makeReference('reference-only', '.png');

  // Pointer-backed artifact: reference JSON + by-request pointer (the normal full write).
  values.set(`request-artifacts/${requestId}/${pointerBacked.sha256}.json`, JSON.stringify(pointerBacked));
  values.set(
    `by-request/${encodeURIComponent(requestId)}/image/${pointerBacked.sha256}.json`,
    JSON.stringify({ requestId, sha256: pointerBacked.sha256, artifactKind: 'image' })
  );

  // Reference-only artifact: its pointer write failed — only the reference JSON exists.
  values.set(`request-artifacts/${requestId}/${referenceOnly.sha256}.json`, JSON.stringify(referenceOnly));

  const listed = await listArtifactReferencesForRequest(store as unknown as ArtifactIndexStore, requestId);
  const listedShas = listed.map((reference) => reference.sha256).sort();

  assert.deepEqual(
    listedShas,
    [pointerBacked.sha256, referenceOnly.sha256].sort(),
    'artifacts must be returned from BOTH the by-request pointers and the request-artifacts references'
  );
});
