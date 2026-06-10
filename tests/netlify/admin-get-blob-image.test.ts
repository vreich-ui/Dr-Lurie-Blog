import assert from 'node:assert/strict';
import test from 'node:test';

import { handler as adminGetBlobImageHandler } from '../../netlify/functions/admin-get-blob-image.js';
import { setAdminAuthStateForTesting } from '../../netlify/lib/admin-auth.js';
import { setNetlifyBlobsModuleForTesting } from '../../netlify/lib/blob-store.js';

const toArrayBuffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

const bufferFromStoreValue = (value: string | Buffer | Uint8Array | ArrayBuffer) => {
  if (typeof value === 'string') return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);

  return Buffer.from(value);
};

const createArrayBufferOnlyStore = (initialValues: Record<string, Uint8Array | string> = {}) => {
  const values = new Map(
    Object.entries(initialValues).map(([key, value]) => [key, typeof value === 'string' ? Buffer.from(value) : value])
  );

  return {
    async set(key: string, value: string | Buffer | Uint8Array | ArrayBuffer) {
      values.set(key, bufferFromStoreValue(value));
    },
    async setJSON(key: string, value: unknown) {
      values.set(key, Buffer.from(JSON.stringify(value, null, 2)));
    },
    async get(key: string, options?: { type?: 'arrayBuffer' | 'buffer' | 'text' }) {
      if (options?.type === 'buffer') throw new Error('Netlify-like test store does not support buffer reads.');

      const value = values.get(key);
      if (!value) return null;
      if (options?.type === 'arrayBuffer') return toArrayBuffer(value);

      return Buffer.from(value).toString('utf8');
    },
    async del(key: string) {
      values.delete(key);
    },
    async list(options?: { prefix?: string }) {
      const prefix = options?.prefix ?? '';

      return {
        blobs: [...values.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key, etag: '' })),
        directories: [],
      };
    },
  };
};

test('admin-get-blob-image serves image bytes from an arrayBuffer-only backing store', async () => {
  const blobKey = `image/admin-array-buffer-request/${'a'.repeat(64)}.png`;
  const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  const stores = {
    artifacts: createArrayBufferOnlyStore({ [blobKey]: imageBytes }),
    'artifact-index': createArrayBufferOnlyStore(),
  };
  const previousNetlify = process.env.NETLIFY;
  const previousSiteId = process.env.NETLIFY_SITE_ID;

  process.env.NETLIFY = 'true';
  process.env.NETLIFY_SITE_ID = 'admin-get-blob-image-test-site';
  setAdminAuthStateForTesting({ authenticated: true, isAdmin: true, email: 'admin@example.com', userId: 'admin-user' });
  setNetlifyBlobsModuleForTesting({
    connectLambda() {},
    getStore(input) {
      const name = typeof input === 'string' ? input : input.name;
      const store = stores[name as keyof typeof stores];

      assert.ok(store, `Unexpected blob store: ${name}`);

      return store as never;
    },
  });

  try {
    const response = await adminGetBlobImageHandler({
      httpMethod: 'GET',
      headers: { authorization: 'Bearer test-token' },
      queryStringParameters: { blobKey, contentType: 'image/png' },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.equal('isBase64Encoded' in response && response.isBase64Encoded, true);
    assert.equal(response.headers['Content-Type'], 'image/png');
    assert.equal(Buffer.from(response.body, 'base64').toString('hex'), imageBytes.toString('hex'));
  } finally {
    setAdminAuthStateForTesting(undefined);
    setNetlifyBlobsModuleForTesting(undefined);
    if (previousNetlify === undefined) delete process.env.NETLIFY;
    else process.env.NETLIFY = previousNetlify;
    if (previousSiteId === undefined) delete process.env.NETLIFY_SITE_ID;
    else process.env.NETLIFY_SITE_ID = previousSiteId;
  }
});
