import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { handler as mcpHandler } from '../../netlify/functions/mcp.js';
import { saveArtifactBytes } from '../../netlify/lib/artifact-upload.js';
import { handler as saveArtifactLegacyHandler } from '../../netlify/functions/save-artifact.js';
import {
  getArtifactBlobStore,
  getArtifactIndexBlobStore,
  setNetlifyBlobsModuleForTesting,
} from '../../netlify/lib/blob-store.js';
import { ArtifactKind } from '../../netlify/lib/artifacts.js';

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

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
  const previousMcpAdmin = process.env.MCP_ENABLE_ADMIN_TOOLS;

  const { values: artifactValues, store: artifactStore } = createFakeStore();
  const { values: indexValues, store: indexStore } = createFakeStore();

  process.env.NETLIFY = 'true';
  process.env.NETLIFY_SITE_ID = '';
  process.env.NETLIFY_PUBLISH_SECRET = 'test-secret';
  process.env.MCP_ENABLE_ADMIN_TOOLS = 'true';

  setNetlifyBlobsModuleForTesting({
    connectLambda() {},
    getStore(input) {
      const storeName = typeof input === 'string' ? input : input.name;
      if (storeName === 'artifacts') {
        return artifactStore as any;
      }
      if (storeName === 'artifact-index') {
        return indexStore as any;
      }
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
    if (previousMcpAdmin === undefined) delete process.env.MCP_ENABLE_ADMIN_TOOLS;
    else process.env.MCP_ENABLE_ADMIN_TOOLS = previousMcpAdmin;
  }
};

const callMcp = async (method: string, args: Record<string, any>) => {
  const response = await mcpHandler({
    httpMethod: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-publish-key': 'test-secret',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: method, arguments: args },
    }),
  });
  const body = JSON.parse(response.body);
  if (body.error) {
    console.error('MCP Error:', body.error);
    throw new Error(body.error.message);
  }
  if (body.result && body.result.isError) {
    console.error('Tool Error Result:', body.result);
  }
  return body.result;
};

test('Artifact listing and metadata retrieval', async () => {
  await withBlobStores(async () => {
    // 1. Save an artifact via saveArtifactBytes (direct)
    const bytes1 = Buffer.from('%PDF-1.7\ndirect artifact');
    const sha1 = sha256(bytes1);
    const requestId1 = 'req-direct';
    await saveArtifactBytes({
      requestId: requestId1,
      artifactKind: ArtifactKind.Pdf,
      contentType: 'application/pdf',
      expectedSizeBytes: bytes1.byteLength,
      expectedSha256: sha1,
      bytes: bytes1,
      tags: ['test-tag'],
      label: 'Direct PDF',
    });

    // 2. Save an artifact via save-artifact (legacy)
    const bytes2 = Buffer.from('%PDF-1.7\nlegacy artifact');
    const sha2 = sha256(bytes2);
    const requestId2 = 'req-legacy';
    await saveArtifactLegacyHandler({
      httpMethod: 'POST',
      headers: { 'x-publish-key': 'test-secret' },
      body: JSON.stringify({
        requestId: requestId2,
        artifactKind: 'pdf',
        contentType: 'application/pdf',
        payload: bytes2.toString('base64'),
        label: 'Legacy PDF',
      }),
    });

    // 3. Test list_artifacts_for_request
    const list1 = await callMcp('list_artifacts_for_request', { requestId: requestId1 });
    assert.equal(list1.structuredContent.artifacts.length, 1);
    assert.equal(list1.structuredContent.artifacts[0].sha256, sha1);

    const list2 = await callMcp('list_artifacts_for_request', { requestId: requestId2 });
    assert.equal(list2.structuredContent.artifacts.length, 1);
    assert.equal(list2.structuredContent.artifacts[0].sha256, sha2);

    // 4. Test list_artifacts_by_kind
    const listKind = await callMcp('list_artifacts_by_kind', { artifactKind: 'pdf' });
    assert.equal(listKind.structuredContent.artifacts.length, 2);
    const shas = listKind.structuredContent.artifacts.map((a: any) => a.sha256);
    assert.ok(shas.includes(sha1));
    assert.ok(shas.includes(sha2));

    // 5. Test list_artifacts_by_request
    const listByReq1 = await callMcp('list_artifacts_by_request', { requestId: requestId1 });
    assert.equal(listByReq1.structuredContent.artifacts.length, 1);
    assert.equal(listByReq1.structuredContent.artifacts[0].sha256, sha1);

    // 6. Test search_artifacts by tag
    const searchTag = await callMcp('search_artifacts', { tag: 'test-tag' });
    assert.equal(searchTag.structuredContent.artifacts.length, 1);
    assert.equal(searchTag.structuredContent.artifacts[0].sha256, sha1);

    // 7. Test get_artifact_metadata (the new tool)
    const meta = await callMcp('get_artifact_metadata', { requestId: requestId1, sha256: sha1 });
    assert.equal(meta.structuredContent.sha256, sha1);
    assert.equal(meta.structuredContent.label, 'Direct PDF');
    assert.ok(meta.structuredContent.blobKey);

    // 8. Test soft delete and filtering
    await callMcp('soft_delete_artifact', { requestId: requestId1, sha256: sha1 });

    // Should be hidden by default
    const listAfterDelete = await callMcp('list_artifacts_for_request', { requestId: requestId1 });
    assert.equal(listAfterDelete.structuredContent.artifacts.length, 0);

    const listByKindAfterDelete = await callMcp('list_artifacts_by_kind', { artifactKind: 'pdf' });
    assert.equal(listByKindAfterDelete.structuredContent.artifacts.length, 1); // Only legacy one left

    // Should be visible with includeDeleted
    const listWithDeleted = await callMcp('list_artifacts_by_kind', { artifactKind: 'pdf', includeDeleted: true });
    assert.equal(listWithDeleted.structuredContent.artifacts.length, 2);

    // Restore and check
    await callMcp('restore_artifact', { requestId: requestId1, sha256: sha1 });
    const listAfterRestore = await callMcp('list_artifacts_for_request', { requestId: requestId1 });
    assert.equal(listAfterRestore.structuredContent.artifacts.length, 1);
  });
});
