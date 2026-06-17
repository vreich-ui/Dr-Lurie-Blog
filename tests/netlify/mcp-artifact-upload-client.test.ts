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

test('MCP image artifact upload integrity verification passes when local and server metadata match using save_artifact_chunk', async () => {
  const bytes = Buffer.from('matching image bytes');
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
  assert.equal(artifacts[0].sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'save_artifact_chunk');
  assert.equal(calls[0].args.expectedSizeBytes, bytes.byteLength);
  assert.equal(calls[0].args.expectedSha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(calls[0].args.label, 'integrity.jpg');
  assert.deepEqual(calls[0].args.tags, ['publisher-agent', 'image']);
});

test('MCP image artifact upload uses save_artifact_chunk for larger images and does not call save_artifact or upload sessions', async () => {
  const bytes = Buffer.alloc(AGENT_ARTIFACT_CHUNK_RAW_BYTES * 2 + 100, 1);
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const logs: any[] = [];
  const originalLog = console.log;
  console.log = (msg) => logs.push(JSON.parse(msg));

  try {
    const artifacts = await uploadImagesWithIntegrity({
      images: [createImage(bytes)],
      requestId: 'req-integrity-test',
      mcpToolCall: async (name, args) => {
        calls.push({ name, args });

        return args.chunkIndex === 2
          ? { ok: true, complete: true, artifact: createArtifact({ bytes }) }
          : { ok: true, complete: false };
      },
    });

    assert.equal(artifacts.length, 1);
    assert.ok(calls.every((call) => call.name === 'save_artifact_chunk'));
    assert.equal(calls.length, 3);
    assert.ok(!calls.some((call) => call.name === 'save_artifact'));
    assert.ok(!calls.some((call) => call.name === 'create_upload_session'));
    assert.equal(logs.length, 1);
    assert.equal(logs[0].uploadPath, 'chunks');
  } finally {
    console.log = originalLog;
  }
});

test('MCP image artifact upload defaults to AGENT_ARTIFACT_CHUNK_RAW_BYTES', async () => {
  const bytes = Buffer.alloc(AGENT_ARTIFACT_CHUNK_RAW_BYTES + 1, 2);
  const calls: { name: string; args: Record<string, unknown> }[] = [];

  await uploadImagesWithIntegrity({
    images: [createImage(bytes)],
    requestId: 'req-integrity-test',
    mcpToolCall: async (name, args) => {
      calls.push({ name, args });
      return { ok: true, complete: args.chunkIndex === 1, artifact: createArtifact({ bytes }) };
    },
  });

  assert.equal(calls.length, 2);
  // First chunk should be exactly AGENT_ARTIFACT_CHUNK_RAW_BYTES
  const firstPayload = calls[0].args.payload as string;
  assert.equal(Buffer.from(firstPayload, 'base64').length, AGENT_ARTIFACT_CHUNK_RAW_BYTES);
});

test('MCP image artifact upload integrity verification fails on mismatched returned SHA', async () => {
  const bytes = Buffer.from('sha mismatch image bytes');
  const wrongArtifact = {
    ...createArtifact({ bytes }),
    sha256: '0'.repeat(64),
    blobKey: `image/req-integrity-test/${'0'.repeat(64)}.jpg`,
  };
  const workflowErrors: string[] = [];

  await assert.rejects(
    uploadImagesWithIntegrity({
      images: [createImage(bytes)],
      requestId: 'req-integrity-test',
      mcpToolCall: async () => ({ ok: true, complete: true, artifact: wrongArtifact }),
      onWorkflowError: (message) => workflowErrors.push(message),
    }),
    (error: unknown) =>
      error instanceof ArtifactIntegrityError &&
      /Artifact upload failed integrity verification/.test(error.message) &&
      /sha256/.test(error.message)
  );
  assert.equal(workflowErrors.length, 1);
  assert.match(workflowErrors[0], /sha256/);
});

test('MCP image artifact upload integrity verification fails on mismatched returned size', async () => {
  const bytes = Buffer.from('size mismatch image bytes');
  const wrongArtifact = { ...createArtifact({ bytes }), sizeBytes: bytes.byteLength + 1 };

  await assert.rejects(
    uploadImagesWithIntegrity({
      images: [createImage(bytes)],
      requestId: 'req-integrity-test',
      mcpToolCall: async () => ({ ok: true, complete: true, artifact: wrongArtifact }),
    }),
    (error: unknown) =>
      error instanceof ArtifactIntegrityError &&
      /Artifact upload failed integrity verification/.test(error.message) &&
      /sizeBytes/.test(error.message)
  );
});

test('MCP image artifact upload rejects binary encoded payloads before any MCP tool call', async () => {
  let callCount = 0;

  await assert.rejects(
    uploadImagesWithIntegrity({
      images: [
        {
          content: 'binary image bytes',
          encoding: 'binary',
          name: 'binary.jpg',
          type: 'image/jpeg',
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
      /Artifact upload failed integrity verification/.test(error.message) &&
      /encoding must be base64, not binary/.test(error.message)
  );

  assert.equal(callCount, 0);
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
      /Artifact upload failed integrity verification/.test(error.message) &&
      /SVG images are not supported/.test(error.message)
  );

  assert.equal(callCount, 0);
});

test('MCP image artifact upload rejects zero-byte images before upload', async () => {
  let callCount = 0;

  await assert.rejects(
    uploadImagesWithIntegrity({
      images: [{ base64: '', name: 'empty.jpg', type: 'image/jpeg' }],
      requestId: 'req-integrity-test',
      mcpToolCall: async () => {
        callCount += 1;
        return {};
      },
    }),
    (error: unknown) =>
      error instanceof ArtifactIntegrityError &&
      /Artifact upload failed integrity verification/.test(error.message) &&
      /payload is empty/.test(error.message)
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

test('verified image blobKeys are not partially attached when image 2 of N fails', async () => {
  const firstBytes = Buffer.from('first valid image bytes');
  const secondBytes = Buffer.from('second invalid image bytes');
  const finalArticle = { title: 'Final article', artifactReferences: [] };
  let callCount = 0;

  await assert.rejects(async () => {
    const verifiedArtifacts = await uploadImagesWithIntegrity({
      images: [createImage(firstBytes), createImage(secondBytes)],
      requestId: 'req-integrity-test',
      mcpToolCall: async () => {
        callCount += 1;
        if (callCount === 1) {
          return { ok: true, complete: true, artifact: createArtifact({ bytes: firstBytes }) };
        }

        return {
          ok: true,
          complete: true,
          artifact: { ...createArtifact({ bytes: secondBytes }), sha256: '0'.repeat(64) },
        };
      },
    });
    attachVerifiedArtifactsToFinalArticle(finalArticle, verifiedArtifacts);
  }, /Artifact upload failed integrity verification/);

  assert.equal(callCount, 2);
  assert.deepEqual(finalArticle.artifactReferences, []);
});

test('MCP image artifact chunk indexes are monotonic and deterministic with target-sized chunks', async () => {
  const bytes = Buffer.alloc(100_000, 1);
  const indexes: unknown[] = [];

  await uploadImagesWithIntegrity({
    images: [createImage(bytes)],
    requestId: 'req-integrity-test',
    chunkSizeBytes: 25_000,
    mcpToolCall: async (name, args) => {
      indexes.push(args.chunkIndex);

      return args.chunkIndex === 3
        ? { ok: true, complete: true, artifact: createArtifact({ bytes }) }
        : { ok: true, complete: false, receivedChunks: Number(args.chunkIndex) + 1, totalChunks: 4 };
    },
  });

  assert.deepEqual(indexes, [0, 1, 2, 3]);
});

test('MCP image artifact upload retries the final chunk when completion is delayed', async () => {
  const bytes = Buffer.alloc(100_000, 2);
  const indexes: unknown[] = [];
  let finalChunkCalls = 0;

  const artifacts = await uploadImagesWithIntegrity({
    images: [createImage(bytes)],
    requestId: 'req-integrity-test',
    chunkSizeBytes: 25_000,
    mcpToolCall: async (name, args) => {
      indexes.push(args.chunkIndex);

      if (args.chunkIndex === 3) {
        finalChunkCalls += 1;
      }

      return finalChunkCalls === 2
        ? { ok: true, complete: true, artifact: createArtifact({ bytes }) }
        : {
            ok: true,
            complete: false,
            receivedChunks: Math.min(Number(args.chunkIndex) + 1, 4),
            totalChunks: 4,
          };
    },
  });

  assert.equal(artifacts.length, 1);
  assert.deepEqual(indexes, [0, 1, 2, 3, 3]);
});

test('retrying the final chunk dedupes/idempotently returns the existing artifact', async () => {
  const bytes = Buffer.from('idempotent test bytes');
  let calls = 0;

  const artifacts = await uploadImagesWithIntegrity({
    images: [createImage(bytes)],
    requestId: 'req-integrity-test',
    mcpToolCall: async () => {
      calls += 1;
      return { ok: true, complete: true, artifact: createArtifact({ bytes }) };
    },
  });

  assert.equal(artifacts.length, 1);
  assert.equal(calls, 1);
});
