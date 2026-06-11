import assert from 'node:assert/strict';
import test from 'node:test';

import { handler } from '../../netlify/functions/mcp.js';
import { setNetlifyBlobsModuleForTesting } from '../../netlify/lib/blob-store.js';

type TestStore = {
  values: Map<string, string>;
  deleted: string[];
};

const makeStore = (store: TestStore) => ({
  async set(key: string, value: string | Buffer | Uint8Array) {
    store.values.set(key, Buffer.isBuffer(value) ? value.toString('utf8') : String(value));
  },
  async setJSON(key: string, value: unknown) {
    store.values.set(key, JSON.stringify(value));
  },
  async get(key: string) {
    return store.values.get(key) ?? null;
  },
  async del(key: string) {
    store.deleted.push(key);
    store.values.delete(key);
  },
  async list(options?: { prefix?: string }) {
    const prefix = options?.prefix ?? '';

    return {
      blobs: [...store.values.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key, etag: key })),
      directories: [],
    };
  },
});

const callWipeBlobStores = async (
  args: Record<string, unknown>,
  headers: Record<string, string> = { 'x-publish-key': 'wipe-secret' }
) => {
  const response = await handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'wipe_blob_stores', arguments: args },
    }),
  });

  assert.equal(response.statusCode, 200);

  return JSON.parse(response.body) as {
    result: {
      isError?: boolean;
      structuredContent: {
        dryRun?: boolean;
        deleted?: number;
        scanned?: number;
        skipped?: number;
        prefixes?: string[];
        sampleKeys?: string[];
        sampleDeletedKeys?: string[];
        skippedPrefixes?: string[];
        error?: string;
      };
    };
  };
};

const withMockBlobStores = async (fn: (stores: Record<string, TestStore>) => Promise<void>) => {
  const previousPublishSecret = process.env.NETLIFY_PUBLISH_SECRET;
  const previousNetlify = process.env.NETLIFY;
  const stores = {
    workflows: {
      values: new Map([
        ['workflows/by-id/request-1.json', '{}'],
        ['manual/outside-workflows.txt', 'keep'],
      ]),
      deleted: [] as string[],
    },
    artifacts: {
      values: new Map([
        ['image/request-1/image.png', 'image'],
        ['pdf/request-1/file.pdf', 'pdf'],
        ['artifact-chunks/request/upload/0', 'chunk'],
      ]),
      deleted: [] as string[],
    },
    'artifact-index': {
      values: new Map([
        ['request-artifacts/request-1/aaaaaaaa.json', '{}'],
        ['by-kind/image/aaaaaaaa.json', '{}'],
      ]),
      deleted: [] as string[],
    },
  };

  process.env.NETLIFY_PUBLISH_SECRET = 'wipe-secret';
  process.env.NETLIFY = 'true';
  setNetlifyBlobsModuleForTesting({
    connectLambda() {},
    getStore(input: string | { name: string }) {
      const name = typeof input === 'string' ? input : input.name;
      const store = stores[name as keyof typeof stores];
      assert.ok(store, `Unexpected store requested: ${name}`);

      return makeStore(store);
    },
  });

  try {
    await fn(stores);
  } finally {
    setNetlifyBlobsModuleForTesting(undefined);

    if (previousPublishSecret === undefined) delete process.env.NETLIFY_PUBLISH_SECRET;
    else process.env.NETLIFY_PUBLISH_SECRET = previousPublishSecret;

    if (previousNetlify === undefined) delete process.env.NETLIFY;
    else process.env.NETLIFY = previousNetlify;
  }
};

test('wipe_blob_stores dryRun returns counts and samples without deleting', async () => {
  await withMockBlobStores(async (stores) => {
    const body = await callWipeBlobStores({ prefixes: ['workflows/', 'image/', 'artifact-index/'] });

    assert.equal(body.result.isError, undefined);
    assert.equal(body.result.structuredContent.dryRun, true);
    assert.equal(body.result.structuredContent.scanned, 4);
    assert.equal(body.result.structuredContent.deleted, 0);
    assert.deepEqual(body.result.structuredContent.sampleDeletedKeys, []);
    assert.ok(body.result.structuredContent.sampleKeys?.includes('workflows/by-id/request-1.json'));
    assert.ok(body.result.structuredContent.sampleKeys?.includes('image/request-1/image.png'));
    assert.ok(
      body.result.structuredContent.sampleKeys?.includes('artifact-index/request-artifacts/request-1/aaaaaaaa.json')
    );
    assert.deepEqual(stores.workflows.deleted, []);
    assert.deepEqual(stores.artifacts.deleted, []);
    assert.deepEqual(stores['artifact-index'].deleted, []);
  });
});

test('wipe_blob_stores live mode requires confirmation guard', async () => {
  await withMockBlobStores(async (stores) => {
    const body = await callWipeBlobStores({ dryRun: false, prefixes: ['image/'], confirm: 'wrong' });

    assert.equal(body.result.isError, true);
    assert.match(String(body.result.structuredContent.error), /confirm/i);
    assert.equal(body.result.structuredContent.deleted, 0);
    assert.deepEqual(stores.artifacts.deleted, []);
    assert.ok(stores.artifacts.values.has('image/request-1/image.png'));
  });
});

test('wipe_blob_stores requires NETLIFY_PUBLISH_SECRET authorization', async () => {
  await withMockBlobStores(async (stores) => {
    const unauthorized = await callWipeBlobStores(
      { dryRun: true, prefixes: ['image/'] },
      { authorization: 'Bearer wrong-secret' }
    );

    assert.equal(unauthorized.result.isError, true);
    assert.match(String(unauthorized.result.structuredContent.error), /Unauthorized/i);

    const authorized = await callWipeBlobStores(
      { dryRun: true, prefixes: ['image/'] },
      { authorization: 'Bearer wipe-secret' }
    );

    assert.equal(authorized.result.isError, undefined);
    assert.equal(authorized.result.structuredContent.scanned, 1);
    assert.deepEqual(stores.artifacts.deleted, []);
  });
});

test('wipe_blob_stores live delete is constrained to allowlisted prefixes', async () => {
  await withMockBlobStores(async (stores) => {
    const body = await callWipeBlobStores({
      dryRun: false,
      confirm: 'WIPE_BLOBS',
      prefixes: ['image/', '../', 'artifact-chunks/', 'workflows/../../'],
    });

    assert.equal(body.result.isError, undefined);
    assert.equal(body.result.structuredContent.scanned, 1);
    assert.equal(body.result.structuredContent.deleted, 1);
    assert.equal(body.result.structuredContent.skipped, 3);
    assert.deepEqual(body.result.structuredContent.prefixes, ['image/']);
    assert.deepEqual(body.result.structuredContent.sampleDeletedKeys, ['image/request-1/image.png']);
    assert.deepEqual(stores.artifacts.deleted, ['image/request-1/image.png']);
    assert.ok(stores.artifacts.values.has('pdf/request-1/file.pdf'));
    assert.ok(stores.artifacts.values.has('artifact-chunks/request/upload/0'));
    assert.ok(stores.workflows.values.has('workflows/by-id/request-1.json'));
  });
});
