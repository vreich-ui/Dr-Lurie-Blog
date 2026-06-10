import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ArtifactKind,
  createArtifactBlobKey,
  createArtifactReference,
  getArtifactReferenceIssue,
  isArtifactReference,
  type ReadableArtifactBlobStore,
} from '../../netlify/lib/artifacts.js';
import { sha256Hex } from '../../netlify/lib/crypto.js';

test('sha256Hex returns lowercase hexadecimal digests', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('artifact helpers produce stable blob keys and references', () => {
  const bytes = Buffer.from('artifact bytes');
  const reference = createArtifactReference({
    input: {
      requestId: 'Draft Request 123',
      artifactKind: ArtifactKind.Image,
      contentType: 'image/png',
      filename: 'Hero Preview.PNG',
      metadata: { source: 'test' },
    },
    bytes,
    createdAtISO: '2026-06-05T00:00:00.000Z',
  });

  assert.equal(reference.blobKey, `image/draft-request-123/${reference.sha256}.png`);
  assert.equal(reference.sizeBytes, bytes.byteLength);
  assert.equal(reference.contentType, 'image/png');
  assert.equal(reference.createdAtISO, '2026-06-05T00:00:00.000Z');
  assert.deepEqual(reference.metadata, { source: 'test' });
});

test('artifact blob keys fall back safely when request IDs are not path-safe', () => {
  assert.equal(
    createArtifactBlobKey({
      artifactKind: ArtifactKind.Markdown,
      requestId: '///',
      sha256: 'abc123',
      filename: 'notes.md',
    }),
    'markdown/request/abc123.md'
  );
});

test('ArtifactReference validation rejects invented media handles and incomplete references', () => {
  const bytes = Buffer.from('validated artifact');
  const reference = createArtifactReference({
    input: {
      requestId: 'validation-request',
      artifactKind: ArtifactKind.Image,
      contentType: 'image/png',
      filename: 'validated.png',
    },
    bytes,
    createdAtISO: '2026-06-05T00:00:00.000Z',
  });

  assert.equal(isArtifactReference(reference), true);
  assert.equal(
    getArtifactReferenceIssue({ ...reference, url: 'https://example.com/deterministic.png' }),
    'unexpected top-level keys: url'
  );
  assert.match(
    getArtifactReferenceIssue({ blobKey: reference.blobKey, sha256: reference.sha256 }) ?? '',
    /sizeBytes must be a non-negative number/
  );
});

type FakeArtifactStoreValue = Buffer | string;

const createFakeArtifactStore = (initialValues: Record<string, FakeArtifactStoreValue> = {}) => {
  const values = new Map<string, FakeArtifactStoreValue>(Object.entries(initialValues));

  const store: ReadableArtifactBlobStore = {
    async get(key: string, options?: { type?: 'buffer' | 'arrayBuffer' }) {
      const value = values.get(key);
      if (value === undefined) return null;
      const bytes = typeof value === 'string' ? Buffer.from(value) : value;
      if (options?.type === 'arrayBuffer')
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      return bytes;
    },
    async list(options?: { prefix?: string }) {
      const prefix = options?.prefix ?? '';
      return {
        blobs: [...values.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })),
        directories: [],
      };
    },
  };

  return { values, store };
};

const createFakeIndexStore = () => {
  const values = new Map<string, unknown>();

  return {
    values,
    store: {
      async setJSON(key: string, value: unknown) {
        values.set(key, value);
      },
    },
  };
};

const makeImageReference = (requestId: string, bytes = Buffer.from('image bytes'), filename = 'hero.jpg') =>
  createArtifactReference({
    input: { requestId, artifactKind: ArtifactKind.Image, contentType: 'image/jpeg', filename },
    bytes,
    createdAtISO: '2026-06-05T00:00:00.000Z',
  });

test('reconcileImageArtifactReference reads a valid reference with valid blob bytes', async () => {
  const reference = makeImageReference('valid-reference');
  const { store } = createFakeArtifactStore({ [reference.blobKey]: Buffer.from('image bytes') });
  const { reconcileImageArtifactReference } = await import('../../netlify/lib/artifacts.js');

  const result = await reconcileImageArtifactReference(reference, store);

  assert.equal(result.status, 'found');
  assert.equal(result.blobKey, reference.blobKey);
  assert.equal(result.status === 'found' ? result.bytes.toString() : '', 'image bytes');
});

test('reconcileImageArtifactReference reports valid JSON with missing blob bytes as missing', async () => {
  const reference = makeImageReference('missing-reference');
  const { store } = createFakeArtifactStore();
  const { reconcileImageArtifactReference } = await import('../../netlify/lib/artifacts.js');

  const result = await reconcileImageArtifactReference(reference, store);

  assert.equal(result.status, 'missing');
  assert.equal(result.blobKey, reference.blobKey);
});

test('reconcileImageArtifactReference recovers a blob stored under duplicated artifacts/image prefix', async () => {
  const reference = makeImageReference('duplicated-prefix');
  const correctedKey = `artifacts/${reference.blobKey}`;
  const { store } = createFakeArtifactStore({ [correctedKey]: Buffer.from('prefixed bytes') });
  const { values, store: indexStore } = createFakeIndexStore();
  const { reconcileImageArtifactReference } = await import('../../netlify/lib/artifacts.js');

  const result = await reconcileImageArtifactReference(reference, store, indexStore);

  assert.equal(result.status, 'found');
  assert.equal(result.blobKey, correctedKey);
  assert.equal(result.status === 'found' ? result.correctedBlobKey : '', correctedKey);
  assert.equal(
    values.has(`request-artifacts/duplicated-prefix/${reference.sha256}.json`),
    false,
    'legacy prefixed keys should not be written back as invalid ArtifactReference blobKeys'
  );
});

test('reconcileImageArtifactReference recovers a blob stored under a leading slash prefix', async () => {
  const reference = makeImageReference('leading-slash');
  const correctedKey = `/${reference.blobKey}`;
  const { store } = createFakeArtifactStore({ [correctedKey]: Buffer.from('slash bytes') });
  const { reconcileImageArtifactReference } = await import('../../netlify/lib/artifacts.js');

  const result = await reconcileImageArtifactReference(reference, store);

  assert.equal(result.status, 'found');
  assert.equal(result.blobKey, correctedKey);
});

test('reconcileImageArtifactReference recovers a same-filename blob stored under a different request prefix', async () => {
  const reference = makeImageReference('stale-request-prefix', Buffer.from('moved bytes'), 'hero.png');
  const correctedKey = reference.blobKey.replace('image/stale-request-prefix/', 'image/current-request-prefix/');
  const { store } = createFakeArtifactStore({ [correctedKey]: Buffer.from('moved bytes') });
  const { values, store: indexStore } = createFakeIndexStore();
  const { reconcileImageArtifactReference } = await import('../../netlify/lib/artifacts.js');

  const result = await reconcileImageArtifactReference(reference, store, indexStore);

  assert.equal(result.status, 'found');
  assert.equal(result.blobKey, correctedKey);
  assert.deepEqual(values.get(`request-artifacts/current-request-prefix/${reference.sha256}.json`), {
    ...reference,
    blobKey: correctedKey,
  });
});
test('reconcileImageArtifactReference falls back across jpg jpeg png webp extensions by sha basename', async () => {
  const reference = makeImageReference('extension-fallback', Buffer.from('extension bytes'), 'hero.jpg');
  const correctedKey = reference.blobKey.replace(/\.jpg$/, '.jpeg');
  const { store } = createFakeArtifactStore({ [correctedKey]: Buffer.from('extension bytes') });
  const { reconcileImageArtifactReference } = await import('../../netlify/lib/artifacts.js');

  const result = await reconcileImageArtifactReference(reference, store);

  assert.equal(result.status, 'found');
  assert.equal(result.blobKey, correctedKey);
});
