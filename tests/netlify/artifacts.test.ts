import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ArtifactKind,
  artifactKindValues,
  createArtifactBlobKey,
  createArtifactReference,
  getArtifactReferenceIssue,
  isArtifactReference,
  type ArtifactReference,
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
      label: 'Hero image',
      tags: ['hero', 'homepage'],
      metadata: { source: 'test' },
    },
    bytes,
    createdAtISO: '2026-06-05T00:00:00.000Z',
  });

  assert.equal(reference.blobKey, `image/draft-request-123/${reference.sha256}.png`);
  assert.equal(reference.sizeBytes, bytes.byteLength);
  assert.equal(reference.contentType, 'image/png');
  assert.equal(reference.createdAtISO, '2026-06-05T00:00:00.000Z');
  assert.equal(reference.originalFilename, 'Hero Preview.PNG');
  assert.equal(reference.label, 'Hero image');
  assert.deepEqual(reference.tags, ['hero', 'homepage']);
  assert.deepEqual(reference.metadata, { source: 'test' });
});

test('artifact blob keys fall back safely when request IDs are not path-safe', () => {
  const digest = 'a'.repeat(64);

  assert.equal(
    createArtifactBlobKey({
      artifactKind: ArtifactKind.Doc,
      requestId: '///',
      sha256: digest,
      filename: 'notes.md',
    }),
    `doc/request/${digest}.md`
  );
});

test('artifact blob keys enforce the server artifactKind whitelist and sha256 format', () => {
  assert.deepEqual(artifactKindValues, ['image', 'pdf', 'video', 'doc', 'audio', 'data', 'attachment', 'other']);
  assert.throws(
    () =>
      createArtifactBlobKey({
        artifactKind: 'markdown' as ArtifactKind,
        requestId: 'request',
        sha256: 'a'.repeat(64),
      }),
    /artifactKind must be one of/
  );
  assert.throws(
    () =>
      createArtifactBlobKey({
        artifactKind: ArtifactKind.Image,
        requestId: 'request',
        sha256: 'abc123',
      }),
    /sha256 must be a 64-character hex digest/
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
  assert.match(
    getArtifactReferenceIssue({ ...reference, blobKey: reference.blobKey.replace(/^image\//, 'markdown/') }) ?? '',
    /blobKey must match the server ArtifactReference path format/
  );
  assert.match(
    getArtifactReferenceIssue({ ...reference, originalFilename: '../unsafe.png' }) ?? '',
    /originalFilename must be a filename/
  );
  assert.match(getArtifactReferenceIssue({ ...reference, label: '<script>' }) ?? '', /label must not contain/);
  assert.match(
    getArtifactReferenceIssue({ ...reference, tags: ['x'.repeat(41)] }) ?? '',
    /tags\[0\] must be at most 40/
  );
  assert.equal(
    getArtifactReferenceIssue({
      ...reference,
      deletedAtISO: '2026-06-10T00:00:00.000Z',
      deletedBy: 'admin@example.com',
    }),
    undefined
  );
  assert.match(
    getArtifactReferenceIssue({ ...reference, deletedAtISO: 'not-a-date' }) ?? '',
    /deletedAtISO must be a valid ISO date string/
  );
  assert.match(getArtifactReferenceIssue({ ...reference, deletedBy: '<admin>' }) ?? '', /deletedBy must not contain/);
});

type FakeArtifactStoreValue = Buffer | string;

const createFakeArtifactStore = (initialValues: Record<string, FakeArtifactStoreValue> = {}) => {
  const values = new Map<string, FakeArtifactStoreValue>(Object.entries(initialValues));

  const store: ReadableArtifactBlobStore = {
    async get(key: string, options: { type: 'arrayBuffer' }) {
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

test('reconcileArtifactReference normalizes stale blobKeys and corrects artifact-index JSON', async () => {
  const reference = makeImageReference('normalized-stale-reference');
  const staleReference = { ...reference, blobKey: `artifacts/${reference.blobKey}` } as ArtifactReference;
  const { store } = createFakeArtifactStore({ [reference.blobKey]: Buffer.from('normalized bytes') });
  const { values, store: indexStore } = createFakeIndexStore();
  const loggedCorrections: unknown[] = [];
  const { reconcileArtifactReference } = await import('../../netlify/lib/artifacts.js');

  const result = await reconcileArtifactReference(staleReference, store, indexStore, {
    logger: { warn: (...args: unknown[]) => loggedCorrections.push(args) },
  });

  assert.equal(result.status, 'found');
  assert.equal(result.blobKey, reference.blobKey);
  assert.equal(result.status === 'found' ? result.correctedBlobKey : '', reference.blobKey);
  assert.deepEqual(values.get(`request-artifacts/normalized-stale-reference/${reference.sha256}.json`), {
    ...reference,
    blobKey: reference.blobKey,
  });
  assert.equal(loggedCorrections.length, 1);
});

test('reconcileImageArtifactReference reads from stores that only support arrayBuffer binary reads', async () => {
  const reference = makeImageReference('arraybuffer-only', Buffer.from('array buffer bytes'), 'arraybuffer.jpg');
  const values = new Map([[reference.blobKey, Buffer.from('array buffer bytes')]]);
  const { reconcileImageArtifactReference } = await import('../../netlify/lib/artifacts.js');
  const store: ReadableArtifactBlobStore = {
    async get(key: string, options: { type: 'arrayBuffer' }) {
      assert.equal(options.type, 'arrayBuffer');
      const value = values.get(key);
      if (!value) return null;
      return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
    },
  };

  const result = await reconcileImageArtifactReference(reference, store);

  assert.equal(result.status, 'found');
  assert.equal(result.status === 'found' ? result.bytes.toString() : '', 'array buffer bytes');
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
