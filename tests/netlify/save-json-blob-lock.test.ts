import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkoutRequest,
  checkinRequest,
  createRequest,
  patchAgentOutput,
  refreshLock,
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

type Store = ReturnType<typeof createMemoryStore>;
type RecordResponse = { error?: string; lock_expired?: boolean; locked?: boolean; record?: WorkflowRecord };

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
  const requestId = `lock-create-${Date.now()}`;
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
  const requestId = `lock-reject-${Date.now()}`;
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
  const requestId = `lock-refresh-checkin-${Date.now()}`;
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
