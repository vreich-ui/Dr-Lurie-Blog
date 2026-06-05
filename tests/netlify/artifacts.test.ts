import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ArtifactKind,
  createArtifactBlobKey,
  createArtifactReference,
  getArtifactReferenceIssue,
  isArtifactReference,
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
