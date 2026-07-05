import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkoutRequest,
  checkinRequest,
  createRequest,
  handler as saveJsonBlobHandler,
  patchAgentOutput,
  refreshLock,
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

type Store = ReturnType<typeof createMemoryStore>;
type RecordResponse = {
  error?: string;
  lock_expired?: boolean;
  locked?: boolean;
  lock?: Record<string, unknown>;
  record?: WorkflowRecord;
};

const parseBody = (response: { body: string }) => JSON.parse(response.body) as RecordResponse;

const contentSourceInput = (requestId: string) => ({
  record_type: 'content_source',
  schema_version: 'content_source.v1',
  content: {
    schema_version: 'content_blocks.v1',
    title: 'Lock coverage article',
    article_body: {
      schema_version: 'article_body.v1',
      nodes: [{ id: 'n_lock', kind: 'content', public: { body: 'Visible lock body.' } }],
    },
  },
  publication: { schema_version: 'publication.v2', published_time: null },
  workflow: { schema_version: 'content_workflow.v1', workflow_id: requestId },
  versioning: { schema_version: 'versioning.v1', record_version: 1 },
});

const createWorkflow = async (store: Store, requestId: string) => {
  const response = await createRequest(store, {
    action: 'create_request',
    request_id: requestId,
    input: contentSourceInput(requestId),
  });

  assert.equal(response.statusCode, 201, response.body);
};

const checkoutWorkflow = async (store: Store, requestId: string, leaseSeconds = 300) => {
  const response = await checkoutRequest(store, {
    action: 'checkout_request',
    request_id: requestId,
    owner_id: 'lock-test-agent',
    owner_label: 'Lock test agent',
    lease_seconds: leaseSeconds,
  });

  assert.equal(response.statusCode, 200, response.body);
  const body = parseBody(response);
  assert.ok(body.record?.lock?.token, 'checkout must create a lock token');
  return body.record;
};

test('checkout creates a workflow lock and valid lock_token permits mutation', async () => {
  const store = createMemoryStore();
  const requestId = reqId('lock-create');
  await createWorkflow(store, requestId);
  const record = await checkoutWorkflow(store, requestId);

  const response = await patchAgentOutput(store, {
    action: 'patch_agent_output',
    request_id: requestId,
    agent_name: 'reader_insight',
    expected_agent_version: 0,
    lock_token: record.lock!.token,
    output: { summary: 'Updated under lock.' },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(parseBody(response).record?.agent_outputs.reader_insight?.version, 1);
});

test('mutation rejects wrong and expired lock_token values', async () => {
  const store = createMemoryStore();
  const requestId = reqId('lock-reject');
  await createWorkflow(store, requestId);
  const record = await checkoutWorkflow(store, requestId, 1);

  const wrongTokenResponse = await patchAgentOutput(store, {
    action: 'patch_agent_output',
    request_id: requestId,
    agent_name: 'reader_insight',
    expected_agent_version: 0,
    lock_token: 'wrong-token',
    output: { summary: 'Should fail.' },
  });
  assert.equal(wrongTokenResponse.statusCode, 423, wrongTokenResponse.body);
  assert.match(parseBody(wrongTokenResponse).error ?? '', /lock/i);

  const expiredRecord = {
    ...record,
    lock: { ...record.lock!, expires_at: new Date(Date.now() - 1000).toISOString() },
  };
  await store.setJSON(`workflows/by-id/${requestId}.json`, expiredRecord);

  const expiredTokenResponse = await patchAgentOutput(store, {
    action: 'patch_agent_output',
    request_id: requestId,
    agent_name: 'reader_insight',
    expected_agent_version: 0,
    lock_token: record.lock!.token,
    output: { summary: 'Should fail expired.' },
  });
  assert.equal(expiredTokenResponse.statusCode, 423, expiredTokenResponse.body);
  assert.match(parseBody(expiredTokenResponse).error ?? '', /expired|lock/i);
});

test('refresh_lock extends the active lock and checkin_request releases it', async () => {
  const store = createMemoryStore();
  const requestId = reqId('lock-refresh-checkin');
  await createWorkflow(store, requestId);
  const record = await checkoutWorkflow(store, requestId, 60);

  const refreshResponse = await refreshLock(store, {
    action: 'refresh_lock',
    request_id: requestId,
    lock_token: record.lock!.token,
    lease_seconds: 600,
  });
  assert.equal(refreshResponse.statusCode, 200, refreshResponse.body);
  const refreshed = parseBody(refreshResponse).record;
  assert.ok(refreshed?.lock?.expires_at);
  assert.ok(Date.parse(refreshed.lock.expires_at) > Date.parse(record.lock!.expires_at));

  const checkinResponse = await checkinRequest(store, {
    action: 'checkin_request',
    request_id: requestId,
    lock_token: record.lock!.token,
  });
  assert.equal(checkinResponse.statusCode, 200, checkinResponse.body);
  assert.equal(parseBody(checkinResponse).record?.lock, undefined);
});

test('conflict and error lock responses never expose the raw lock token', async () => {
  const store = createMemoryStore();
  const requestId = reqId('lock-sanitize');
  await createWorkflow(store, requestId);
  await checkoutWorkflow(store, requestId, 300);

  const checkoutConflict = await checkoutRequest(store, {
    action: 'checkout_request',
    request_id: requestId,
    owner_id: 'other-agent',
    owner_label: 'Other agent',
  });
  assert.equal(checkoutConflict.statusCode, 423, checkoutConflict.body);
  const checkoutConflictBody = parseBody(checkoutConflict);
  assert.equal(checkoutConflictBody.locked, true);
  assert.ok(checkoutConflictBody.lock, 'checkout conflict must still describe the active lock');
  assert.equal(checkoutConflictBody.lock?.token, undefined);
  assert.equal(checkoutConflictBody.lock?.owner_id, 'lock-test-agent');

  const refreshWrongToken = await refreshLock(store, {
    action: 'refresh_lock',
    request_id: requestId,
    lock_token: 'wrong-token',
  });
  assert.equal(refreshWrongToken.statusCode, 423, refreshWrongToken.body);
  const refreshWrongTokenBody = parseBody(refreshWrongToken);
  assert.equal(refreshWrongTokenBody.locked, true);
  assert.ok(refreshWrongTokenBody.lock, 'refresh with wrong token must still describe the active lock');
  assert.equal(refreshWrongTokenBody.lock?.token, undefined);

  const checkinWrongToken = await checkinRequest(store, {
    action: 'checkin_request',
    request_id: requestId,
    lock_token: 'wrong-token',
  });
  assert.equal(checkinWrongToken.statusCode, 423, checkinWrongToken.body);
  const checkinWrongTokenBody = parseBody(checkinWrongToken);
  assert.equal(checkinWrongTokenBody.locked, true);
  assert.ok(checkinWrongTokenBody.lock, 'checkin with wrong token must still describe the active lock');
  assert.equal(checkinWrongTokenBody.lock?.token, undefined);
});

test('lease_seconds is capped at 3600 seconds by the request schema', async () => {
  const oversizedLease = (action: 'checkout_request' | 'refresh_lock', label: string) =>
    saveJsonBlobHandler({
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify({
        action,
        request_id: reqId(label),
        owner_id: 'lock-test-agent',
        owner_label: 'Lock test agent',
        lock_token: 'lock_x',
        lease_seconds: 3601,
      }),
    });

  const checkoutResponse = await oversizedLease('checkout_request', 'lease-cap-checkout');
  assert.equal(checkoutResponse.statusCode, 400, checkoutResponse.body);
  const checkoutIssues = (JSON.parse(checkoutResponse.body) as { issues?: Array<{ path: unknown[] }> }).issues;
  assert.ok(checkoutIssues?.some((issue) => issue.path.includes('lease_seconds')));

  const refreshResponse = await oversizedLease('refresh_lock', 'lease-cap-refresh');
  assert.equal(refreshResponse.statusCode, 400, refreshResponse.body);
  const refreshIssues = (JSON.parse(refreshResponse.body) as { issues?: Array<{ path: unknown[] }> }).issues;
  assert.ok(refreshIssues?.some((issue) => issue.path.includes('lease_seconds')));
});

test('refresh_lock returns the lock_expired shape (423) for a matching-but-expired token', async () => {
  const store = createMemoryStore();
  const requestId = reqId('lock-refresh-expired');
  await createWorkflow(store, requestId);
  const record = await checkoutWorkflow(store, requestId, 1);

  const expiredRecord = {
    ...record,
    lock: { ...record.lock!, expires_at: new Date(Date.now() - 1000).toISOString() },
  };
  await store.setJSON(`workflows/by-id/${requestId}.json`, expiredRecord);

  const refreshResponse = await refreshLock(store, {
    action: 'refresh_lock',
    request_id: requestId,
    lock_token: record.lock!.token,
    lease_seconds: 600,
  });
  assert.equal(refreshResponse.statusCode, 423, refreshResponse.body);
  const refreshBody = parseBody(refreshResponse);
  assert.equal(refreshBody.error, 'lock_expired');
  assert.equal(refreshBody.lock_expired, true);
  assert.equal(refreshBody.lock, undefined);
});
