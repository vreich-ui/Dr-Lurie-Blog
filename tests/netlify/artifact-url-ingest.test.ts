import assert from 'node:assert/strict';
import test from 'node:test';

import sharp from 'sharp';

import { handler as mcpHandler } from '../../netlify/functions/mcp.js';
import { ArtifactKind } from '../../netlify/lib/artifacts.js';
import {
  getArtifactBlobStore,
  getArtifactIndexBlobStore,
  setNetlifyBlobsModuleForTesting,
} from '../../netlify/lib/blob-store.js';
import { sha256Hex } from '../../netlify/lib/crypto.js';
import { saveArtifactFromUrl, _ingestInternal } from '../../netlify/lib/artifact-url-ingest.js';

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
    async list() {
      return { blobs: Array.from(values.keys()).map((key) => ({ key, etag: '' })), directories: [] };
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
  const { values: artifactValues, store: artifactStore } = createFakeStore();
  const { values: indexValues, store: indexStore } = createFakeStore();

  process.env.NETLIFY = 'true';
  process.env.NETLIFY_SITE_ID = '';
  setNetlifyBlobsModuleForTesting({
    connectLambda() {},
    getStore(input: string | { name: string }) {
      const storeName = typeof input === 'string' ? input : input.name;
      if (storeName === 'artifacts') {
        return artifactStore as unknown as Awaited<ReturnType<typeof getArtifactBlobStore>>;
      }
      if (storeName === 'artifact-index') {
        return indexStore as unknown as Awaited<ReturnType<typeof getArtifactIndexBlobStore>>;
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
  }
};

const createTinyPng = () =>
  sharp({
    create: {
      width: 2,
      height: 2,
      channels: 4,
      background: { r: 20, g: 40, b: 60, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

// Mocking global fetch and dns.lookup

test('saveArtifactFromUrl successfully ingests a PDF from a valid URL', async (t) => {
  await withBlobStores(async ({ artifactValues, indexValues }) => {
    const bytes = Buffer.from('%PDF-1.7\nminimal pdf bytes');
    const expectedSha256 = sha256Hex(bytes);
    const sourceUrl = 'https://example.com/test.pdf';

    t.mock.method(_ingestInternal, 'dnsLookup', async (hostname: string) => {
      if (hostname === 'example.com') return [{ address: '93.184.216.34', family: 4 }];
      return [];
    });

    t.mock.method(_ingestInternal, 'fetch', async (url: string) => {
      if (url === sourceUrl) {
        return new Response(bytes, {
          status: 200,
          headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(bytes.length) },
        });
      }
      return new Response(null, { status: 404 });
    });

    const result = await saveArtifactFromUrl({
      requestId: 'ingest-request',
      artifactKind: ArtifactKind.Pdf,
      contentType: 'application/pdf',
      sourceUrl,
      expectedSizeBytes: bytes.length,
      expectedSha256,
      filename: 'test.pdf',
    });

    assert.equal(result.ok, true);
    assert.equal(result.sourceUrl, sourceUrl);
    assert.equal(result.fetchedBytes, bytes.length);

    if (result.ok) {
        assert.equal(artifactValues.has(result.artifact.blobKey), true);
        assert.equal(indexValues.has(`request-artifacts/ingest-request/${expectedSha256}.json`), true);
    }
  });
});

test('saveArtifactFromUrl successfully ingests an image from a valid URL', async (t) => {
  await withBlobStores(async ({ artifactValues, indexValues }) => {
    void indexValues;
    const bytes = await createTinyPng();
    const expectedSha256 = sha256Hex(bytes);
    const sourceUrl = 'https://example.com/hero.png';

    t.mock.method(_ingestInternal, 'dnsLookup', async (hostname: string) => {
      if (hostname === 'example.com') return [{ address: '93.184.216.34', family: 4 }];
      return [];
    });

    t.mock.method(_ingestInternal, 'fetch', async (url: string) => {
      if (url === sourceUrl) {
        return new Response(bytes, {
          status: 200,
          headers: { 'Content-Type': 'image/png', 'Content-Length': String(bytes.length) },
        });
      }
      return new Response(null, { status: 404 });
    });

    const result = await saveArtifactFromUrl({
      requestId: 'ingest-image-request',
      artifactKind: ArtifactKind.Image,
      contentType: 'image/png',
      sourceUrl,
      expectedSizeBytes: bytes.length,
      expectedSha256,
      filename: 'hero.png',
    });

    assert.equal(result.ok, true);
    if (result.ok) {
        assert.equal(artifactValues.has(result.artifact.blobKey), true);
    }
  });
});

test('saveArtifactFromUrl rejects non-HTTPS URLs', async () => {
  const result = await saveArtifactFromUrl({
    requestId: 'test',
    artifactKind: ArtifactKind.Data,
    contentType: 'application/octet-stream',
    sourceUrl: 'http://example.com/test.bin',
    expectedSizeBytes: 10,
    expectedSha256: 'a'.repeat(64),
  });

  assert.equal(result.ok, false);
  assert.match(result.error || '', /Only https: URLs are allowed/);
});

test('saveArtifactFromUrl rejects private IP addresses', async (t) => {
  t.mock.method(_ingestInternal, 'dnsLookup', async (hostname: string) => {
    if (hostname === 'internal.local') return [{ address: '192.168.1.1', family: 4 }];
    return [];
  });

  const result = await saveArtifactFromUrl({
    requestId: 'test',
    artifactKind: ArtifactKind.Data,
    contentType: 'application/octet-stream',
    sourceUrl: 'https://internal.local/test.bin',
    expectedSizeBytes: 10,
    expectedSha256: 'a'.repeat(64),
  });

  assert.equal(result.ok, false);
  assert.match(result.error || '', /Forbidden source IP address/);
});

test('saveArtifactFromUrl rejects SHA-256 mismatch', async (t) => {
  const bytes = Buffer.from('some content');
  const sourceUrl = 'https://example.com/test.bin';

  t.mock.method(_ingestInternal, 'dnsLookup', async () => [{ address: '93.184.216.34', family: 4 }]);
  t.mock.method(_ingestInternal, 'fetch', async () => new Response(bytes, { status: 200 }));

  const result = await saveArtifactFromUrl({
    requestId: 'test',
    artifactKind: ArtifactKind.Data,
    contentType: 'application/octet-stream',
    sourceUrl,
    expectedSizeBytes: bytes.length,
    expectedSha256: 'f'.repeat(64),
  });

  assert.equal(result.ok, false);
  assert.match(result.error || '', /Artifact sha256 mismatch/);
});

test('saveArtifactFromUrl rejects size mismatch', async (t) => {
  const bytes = Buffer.from('some content');
  const sourceUrl = 'https://example.com/test.bin';

  t.mock.method(_ingestInternal, 'dnsLookup', async () => [{ address: '93.184.216.34', family: 4 }]);
  t.mock.method(_ingestInternal, 'fetch', async () => new Response(bytes, { status: 200 }));

  const result = await saveArtifactFromUrl({
    requestId: 'test',
    artifactKind: ArtifactKind.Data,
    contentType: 'application/octet-stream',
    sourceUrl,
    expectedSizeBytes: bytes.length + 1,
    expectedSha256: sha256Hex(bytes),
  });

  assert.equal(result.ok, false);
  assert.match(result.error || '', /Artifact size mismatch/);
});

test('saveArtifactFromUrl follows redirects and re-validates URL safety', async (t) => {
  const bytes = Buffer.from('content');
  const initialUrl = 'https://example.com/start';
  const redirectUrl = 'https://example.com/end';

  t.mock.method(_ingestInternal, 'dnsLookup', async () => [{ address: '93.184.216.34', family: 4 }]);

  let fetchCount = 0;
  t.mock.method(_ingestInternal, 'fetch', async (url: string) => {
    fetchCount++;
    if (url === initialUrl) {
      return new Response(null, { status: 302, headers: { 'Location': redirectUrl } });
    }
    if (url === redirectUrl) {
      return new Response(bytes, { status: 200 });
    }
    return new Response(null, { status: 404 });
  });

  const result = await saveArtifactFromUrl({
    requestId: 'test',
    artifactKind: ArtifactKind.Data,
    contentType: 'application/octet-stream',
    sourceUrl: initialUrl,
    expectedSizeBytes: bytes.length,
    expectedSha256: sha256Hex(bytes),
  });

  assert.equal(result.ok, true);
  assert.equal(fetchCount, 2);
});

test('saveArtifactFromUrl rejects more than MAX_REDIRECTS', async (t) => {
  t.mock.method(_ingestInternal, 'dnsLookup', async () => [{ address: '93.184.216.34', family: 4 }]);
  t.mock.method(_ingestInternal, 'fetch', async (url: string) => {
    const parts = url.split('/');
    const last = parts.pop() || '0';
    const nextNum = parseInt(last, 10) + 1;
    return new Response(null, { status: 302, headers: { 'Location': `https://example.com/${nextNum}` } });
  });

  const result = await saveArtifactFromUrl({
    requestId: 'test',
    artifactKind: ArtifactKind.Data,
    contentType: 'application/octet-stream',
    sourceUrl: 'https://example.com/0',
    expectedSizeBytes: 10,
    expectedSha256: 'a'.repeat(64),
  });

  assert.equal(result.ok, false);
  assert.match(result.error || '', /Maximum redirect limit/);
});

test('MCP tool create_artifact_from_url handles valid input and returns success', async (t) => {
    await withBlobStores(async ({ artifactValues, indexValues }) => {
        void artifactValues;
        void indexValues;
        const bytes = Buffer.from('%PDF-1.7\nmcp ingest pdf');
        const expectedSha256 = sha256Hex(bytes);
        const sourceUrl = 'https://example.com/mcp.pdf';
        process.env.NETLIFY_PUBLISH_SECRET = 'mcp-secret';

        t.mock.method(_ingestInternal, 'dnsLookup', async () => [{ address: '93.184.216.34', family: 4 }]);
        t.mock.method(_ingestInternal, 'fetch', async () => new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/pdf' } }));

        const response = await mcpHandler({
            httpMethod: 'POST',
            headers: { 'content-type': 'application/json', 'x-publish-key': 'mcp-secret' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/call',
                params: {
                    name: 'create_artifact_from_url',
                    arguments: {
                        requestId: 'mcp-ingest-request',
                        artifactKind: 'pdf',
                        contentType: 'application/pdf',
                        sourceUrl,
                        expectedSizeBytes: bytes.length,
                        expectedSha256,
                        filename: 'mcp.pdf'
                    }
                }
            })
        });

        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        assert.equal(body.result.structuredContent.ok, true);
        assert.equal(body.result.structuredContent.sourceUrl, sourceUrl);
        assert.ok(body.result.structuredContent.artifact);

        delete process.env.NETLIFY_PUBLISH_SECRET;
    });
});
