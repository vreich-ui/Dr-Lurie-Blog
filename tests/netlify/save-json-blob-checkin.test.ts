import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkinRequest,
  checkoutRequest,
  createRequest,
  type WorkflowRecord,
} from '../../netlify/functions/save-json-blob.js';

const createMemoryStore = () => {
  const blobs = new Map<string, string>();

  return {
    async set(key: string, value: string) {
      blobs.set(key, value);
    },
    async get(key: string) {
      return blobs.get(key) ?? null;
    },
    async del(key: string) {
      blobs.delete(key);
    },
    async setJSON(key: string, value: unknown) {
      blobs.set(key, JSON.stringify(value));
    },
    async list(options?: { prefix?: string }) {
      const prefix = options?.prefix ?? '';
      return {
        blobs: [...blobs.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key, etag: '' })),
        directories: [],
      };
    },
  };
};

const parseBody = (response: { body: string }) =>
  JSON.parse(response.body) as { locked?: boolean; record?: WorkflowRecord };

const contentSourceInput = (requestId: string) => ({
  record_type: 'content_source',
  schema_version: 'content_source.v1',
  content: {
    schema_version: 'content_blocks.v1',
    title: 'Checkin coverage article',
    article_body: {
      schema_version: 'article_body.v1',
      nodes: [{ id: 'n_checkin', kind: 'content', public: { body: 'Visible checkin body.' } }],
    },
  },
  publication: { schema_version: 'publication.v2', published_time: null },
  workflow: { schema_version: 'content_workflow.v1', workflow_id: requestId },
  versioning: { schema_version: 'versioning.v1', record_version: 1 },
});

test('checkin_request requires the active lock token and releases ownership', async () => {
  const store = createMemoryStore();
  const requestId = `checkin-${Date.now()}`;

  const createResponse = await createRequest(store, {
    action: 'create_request',
    request_id: requestId,
    input: contentSourceInput(requestId),
  });
  assert.equal(createResponse.statusCode, 201, createResponse.body);

  const checkoutResponse = await checkoutRequest(store, {
    action: 'checkout_request',
    request_id: requestId,
    owner_id: 'checkin-test-agent',
    owner_label: 'Checkin test agent',
  });
  assert.equal(checkoutResponse.statusCode, 200, checkoutResponse.body);
  const token = parseBody(checkoutResponse).record?.lock?.token;
  assert.ok(token);

  const badCheckin = await checkinRequest(store, {
    action: 'checkin_request',
    request_id: requestId,
    lock_token: 'wrong-token',
  });
  assert.equal(badCheckin.statusCode, 423, badCheckin.body);
  assert.equal(parseBody(badCheckin).locked, true);

  const goodCheckin = await checkinRequest(store, {
    action: 'checkin_request',
    request_id: requestId,
    lock_token: token,
  });
  assert.equal(goodCheckin.statusCode, 200, goodCheckin.body);
  assert.equal(parseBody(goodCheckin).record?.lock, undefined);
});
