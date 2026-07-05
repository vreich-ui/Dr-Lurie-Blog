import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkinRequest,
  checkoutRequest,
  createRequest,
  type WorkflowRecord,
} from '../../netlify/functions/save-json-blob.js';

// Build a request_id that conforms to the req_<flow>_<topic>_<yyyymmdd>_<nn> naming
// contract now enforced by requireRequestId. Each test uses an isolated store, so a
// label-derived id is unique enough.
const reqId = (label: string): string =>
  `req_test_${label
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()}_20260702_01`;

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
  JSON.parse(response.body) as {
    locked?: boolean;
    lock?: Record<string, unknown>;
    error?: string;
    lock_expired?: boolean;
    record?: WorkflowRecord;
  };

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
  const requestId = reqId('checkin');

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
  const badCheckinBody = parseBody(badCheckin);
  assert.equal(badCheckinBody.locked, true);
  assert.ok(badCheckinBody.lock, 'checkin-with-wrong-token must still describe the active lock');
  assert.equal(badCheckinBody.lock?.token, undefined);
  assert.equal(badCheckinBody.lock?.owner_id, 'checkin-test-agent');

  const goodCheckin = await checkinRequest(store, {
    action: 'checkin_request',
    request_id: requestId,
    lock_token: token,
  });
  assert.equal(goodCheckin.statusCode, 200, goodCheckin.body);
  assert.equal(parseBody(goodCheckin).record?.lock, undefined);
});

test('checkin_request rejects a matching-but-expired lock token instead of silently releasing it', async () => {
  const store = createMemoryStore();
  const requestId = reqId('checkin-expired');

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
    lease_seconds: 1,
  });
  assert.equal(checkoutResponse.statusCode, 200, checkoutResponse.body);
  const record = parseBody(checkoutResponse).record;
  const token = record?.lock?.token;
  assert.ok(token);

  const expiredRecord = {
    ...record,
    lock: { ...record!.lock!, expires_at: new Date(Date.now() - 1000).toISOString() },
  };
  await store.setJSON(`workflows/by-id/${requestId}.json`, expiredRecord);

  const expiredCheckin = await checkinRequest(store, {
    action: 'checkin_request',
    request_id: requestId,
    lock_token: token,
  });
  assert.equal(expiredCheckin.statusCode, 423, expiredCheckin.body);
  const expiredCheckinBody = parseBody(expiredCheckin);
  assert.equal(expiredCheckinBody.error, 'lock_expired');
  assert.equal(expiredCheckinBody.lock_expired, true);

  const stillLockedRecordJson = await store.get(`workflows/by-id/${requestId}.json`);
  const stillLockedRecord = JSON.parse(stillLockedRecordJson as string) as WorkflowRecord;
  assert.ok(stillLockedRecord.lock, 'expired lock must not be silently released by checkin_request');
});
