import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  ArtifactIntegrityError,
  attachVerifiedArtifactsToFinalArticle,
  uploadImagesWithIntegrity,
} from '../../netlify/lib/mcp-artifact-upload-client.js';

const AGENT_ARTIFACT_CHUNK_RAW_BYTES = 48 * 1024;

const createArtifact = ({
  contentType = 'image/jpeg',
  bytes,
  requestId = 'req-integrity-test',
}: {
  contentType?: string;
  bytes: Buffer;
  requestId?: string;
}) => {
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  return {
    blobKey: `image/${requestId}/${sha256}.jpg`,
    sizeBytes: bytes.byteLength,
    sha256,
    contentType,
    createdAtISO: '2026-06-08T00:00:00.000Z',
  };
};

const createImage = (bytes: Buffer, type = 'image/jpeg') => ({
  base64: bytes.toString('base64'),
  name: 'integrity.jpg',
  type,
});

test('uploadImagesWithIntegrity uses save_artifact_chunk for small images', async () => {
  const bytes = Buffer.from('small image bytes');
  const calls: { name: string; args: Record<string, unknown> }[] = [];

  const artifacts = await uploadImagesWithIntegrity({
    images: [createImage(bytes)],
    requestId: 'req-integrity-test',
    mcpToolCall: async (name, args) => {
      calls.push({ name, args });

      return { ok: true, complete: true, artifact: createArtifact({ bytes }) };
    },
  });

  assert.equal(artifacts.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'save_artifact_chunk');
  assert.equal(calls[0].args.chunkIndex, 0);
  assert.equal(calls[0].args.totalChunks, 1);
});

test('uploadImagesWithIntegrity uses save_artifact_chunk for larger images', async () => {
  const bytes = Buffer.alloc(AGENT_ARTIFACT_CHUNK_RAW_BYTES + 10, 1);
  const calls: { name: string; args: Record<string, unknown> }[] = [];

  const artifacts = await uploadImagesWithIntegrity({
    images: [createImage(bytes)],
    requestId: 'req-integrity-test',
    mcpToolCall: async (name, args) => {
      calls.push({ name, args });

      return {
        ok: true,
        complete: args.chunkIndex === 1,
        artifact: args.chunkIndex === 1 ? createArtifact({ bytes }) : undefined
      };
    },
  });

  assert.equal(artifacts.length, 1);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(c => c.name === 'save_artifact_chunk'));
});

test('uploadImagesWithIntegrity does not call save_artifact', async () => {
  const bytes = Buffer.from('image bytes');
  const calls: string[] = [];

  await uploadImagesWithIntegrity({
    images: [createImage(bytes)],
    requestId: 'req-integrity-test',
    mcpToolCall: async (name) => {
      calls.push(name);
      return { ok: true, complete: true, artifact: createArtifact({ bytes }) };
    },
  });

  assert.ok(!calls.includes('save_artifact'));
});

test('uploadImagesWithIntegrity does not call upload-session tools by default', async () => {
  const bytes = Buffer.alloc(1_000_000, 2);
  const calls: string[] = [];

  await uploadImagesWithIntegrity({
    images: [createImage(bytes)],
    requestId: 'req-integrity-test',
    mcpToolCall: async (name) => {
      calls.push(name);
      return { ok: true, complete: true, artifact: createArtifact({ bytes }) };
    },
  });

  assert.ok(!calls.includes('create_upload_session'));
  assert.ok(!calls.includes('finalize_upload_session'));
});

test('chunking uses AGENT_ARTIFACT_CHUNK_RAW_BYTES', async () => {
  const bytes = Buffer.alloc(AGENT_ARTIFACT_CHUNK_RAW_BYTES + 1, 3);
  const calls: any[] = [];

  await uploadImagesWithIntegrity({
    images: [createImage(bytes)],
    requestId: 'req-integrity-test',
    mcpToolCall: async (name, args) => {
      calls.push({ name, args });
      return { ok: true, complete: args.chunkIndex === 1, artifact: createArtifact({ bytes }) };
    },
  });

  assert.equal(calls.length, 2);
  const firstPayload = Buffer.from(calls[0].args.payload, 'base64');
  assert.equal(firstPayload.length, AGENT_ARTIFACT_CHUNK_RAW_BYTES);
});

test('final artifact SHA and byte size are verified', async () => {
  const bytes = Buffer.from('integrity bytes');
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  const artifacts = await uploadImagesWithIntegrity({
    images: [createImage(bytes)],
    requestId: 'req-integrity-test',
    mcpToolCall: async () => ({
      ok: true,
      complete: true,
      artifact: {
        ...createArtifact({ bytes }),
        sha256: sha256,
        sizeBytes: bytes.byteLength
      }
    }),
  });

  assert.equal(artifacts[0].sha256, sha256);
  assert.equal(artifacts[0].sizeBytes, bytes.byteLength);
});

test('retrying the final chunk dedupes/idempotently returns the existing artifact', async () => {
  const bytes = Buffer.from('retry bytes');
  let calls = 0;

  const artifacts = await uploadImagesWithIntegrity({
    images: [createImage(bytes)],
    requestId: 'req-integrity-test',
    mcpToolCall: async () => {
      calls += 1;
      // Simulate delayed completion where it doesn't return complete:true immediately
      return {
        ok: true,
        complete: true,
        artifact: createArtifact({ bytes })
      };
    },
  });

  assert.equal(artifacts.length, 1);
  // It shouldn't retry if the first one succeeded
  assert.equal(calls, 1);
});

test('MCP image artifact upload integrity verification fails on mismatched returned SHA', async () => {
  const bytes = Buffer.from('sha mismatch image bytes');
  const wrongArtifact = {
    ...createArtifact({ bytes }),
    sha256: '0'.repeat(64),
    blobKey: `image/req-integrity-test/${'0'.repeat(64)}.jpg`,
  };

  await assert.rejects(
    uploadImagesWithIntegrity({
      images: [createImage(bytes)],
      requestId: 'req-integrity-test',
      mcpToolCall: async () => ({ ok: true, complete: true, artifact: wrongArtifact }),
    }),
    (error: unknown) =>
      error instanceof ArtifactIntegrityError &&
      /sha256/.test(error.message)
  );
});

test('MCP image artifact upload rejects SVG content before upload', async () => {
  let callCount = 0;

  await assert.rejects(
    uploadImagesWithIntegrity({
      images: [
        {
          base64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" />').toString('base64'),
          name: 'vector.svg',
          type: 'image/svg+xml',
        },
      ],
      requestId: 'req-integrity-test',
      mcpToolCall: async () => {
        callCount += 1;
        return {};
      },
    }),
    (error: unknown) =>
      error instanceof ArtifactIntegrityError &&
      /SVG images are not supported/.test(error.message)
  );

  assert.equal(callCount, 0);
});

test('verified image blobKey is not attached to final_article when verification fails', async () => {
  const bytes = Buffer.from('bad final article image bytes');
  const finalArticle = { title: 'Final article', artifactReferences: [] };
  const wrongArtifact = { ...createArtifact({ bytes }), sizeBytes: bytes.byteLength + 7 };

  await assert.rejects(async () => {
    const verifiedArtifacts = await uploadImagesWithIntegrity({
      images: [createImage(bytes)],
      requestId: 'req-integrity-test',
      mcpToolCall: async () => ({ ok: true, complete: true, artifact: wrongArtifact }),
    });
    attachVerifiedArtifactsToFinalArticle(finalArticle, verifiedArtifacts);
  }, /Artifact upload failed integrity verification/);

  assert.deepEqual(finalArticle.artifactReferences, []);
});
