import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkoutRequest,
  createRequest,
  getRequest,
  markAgentComplete,
  markPublished,
  patchAgentOutput,
  refreshLock,
  type WorkflowRecord,
} from '../../netlify/functions/save-json-blob.js';

const recordKey = (requestId: string) => `workflows/by-id/${requestId}.json`;

type ResponseBody = {
  diagnostics?: { acquiredAtISO: string; deltaMs: number | null; expiresAtISO: string; nowISO: string };
  lock_expired?: boolean;
  record?: WorkflowRecord;
};

const createMemoryStore = () => {
  const blobs = new Map<string, string>();

  return {
    blobs,
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

const parseBody = (response: Awaited<ReturnType<typeof patchAgentOutput>>) => JSON.parse(response.body) as ResponseBody;

const contentSourceInput = (requestId: string) => ({
  record_type: 'content_source',
  schema_version: 'content_source.v1',
  content: {
    schema_version: 'content_blocks.v1',
    title: 'Fresh lock patch test',
  },
  workflow: {
    schema_version: 'content_workflow.v1',
    workflow_id: requestId,
  },
  versioning: {
    schema_version: 'versioning.v1',
    record_version: 1,
  },
});

const createAndCheckout = async (
  store: ReturnType<typeof createMemoryStore>,
  requestId: string,
  leaseSeconds = 300
) => {
  const createResponse = await createRequest(store, {
    action: 'create_request',
    request_id: requestId,
    input: contentSourceInput(requestId),
  });
  assert.equal(createResponse.statusCode, 201, createResponse.body);

  const checkoutResponse = await checkoutRequest(store, {
    action: 'checkout_request',
    request_id: requestId,
    owner_id: 'fresh-lock-agent',
    owner_label: 'Fresh lock agent',
    lease_seconds: leaseSeconds,
  });
  assert.equal(checkoutResponse.statusCode, 200, checkoutResponse.body);

  const checkoutBody = JSON.parse(checkoutResponse.body) as { record: WorkflowRecord };
  assert.ok(checkoutBody.record.lock?.token, 'checkout must return a lock token');

  return checkoutBody.record;
};

test('patch_agent_output accepts a fresh UTC lock whose expires_at is several minutes in the future without refresh', async () => {
  const store = createMemoryStore();
  const requestId = `fresh-lock-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const checkoutRecord = await createAndCheckout(store, requestId, 300);
  const lock = checkoutRecord.lock;

  assert.ok(lock, 'checkout record should have a lock');
  assert.ok(Date.parse(lock.expires_at) - Date.now() > 240_000, 'lock should expire several minutes in the future');

  const patchResponse = await patchAgentOutput(store, {
    action: 'patch_agent_output',
    request_id: requestId,
    agent_name: 'reader_insight',
    expected_agent_version: 0,
    lock_token: lock.token,
    output: { summary: 'Patched while the fresh lock is still active.' },
  });
  const body = parseBody(patchResponse);

  assert.equal(patchResponse.statusCode, 200, patchResponse.body);
  assert.equal(body.record?.agent_outputs.reader_insight?.version, 1);
  assert.equal(body.record?.lock?.token, lock.token);
});

test('mark_agent_complete retries when the first read after patch_agent_output is stale', async () => {
  const store = createMemoryStore();
  const requestId = `stale-mark-complete-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const checkoutRecord = await createAndCheckout(store, requestId, 300);
  const lock = checkoutRecord.lock;

  assert.ok(lock, 'checkout record should have a lock');

  const patchResponse = await patchAgentOutput(store, {
    action: 'patch_agent_output',
    request_id: requestId,
    agent_name: 'final_article',
    expected_agent_version: 0,
    lock_token: lock.token,
    output: { title: 'Retry-visible final article', body: 'Preserved final article output.' },
  });
  const patchBody = parseBody(patchResponse);

  assert.equal(patchResponse.statusCode, 200, patchResponse.body);
  assert.ok(patchBody.record, 'patch should return a workflow record');

  const staleCheckoutSnapshot = JSON.stringify(checkoutRecord);
  const originalGet = store.get.bind(store);
  let hidePatchedRecordOnce = true;
  store.get = async (key: string) => {
    if (hidePatchedRecordOnce && key === recordKey(requestId)) {
      hidePatchedRecordOnce = false;
      return staleCheckoutSnapshot;
    }

    return originalGet(key);
  };

  const completeResponse = await markAgentComplete(store, {
    action: 'mark_agent_complete',
    request_id: requestId,
    agent_name: 'final_article',
    expected_record_version: patchBody.record.version,
    lock_token: lock.token,
    current_stage: null,
    next_agent: null,
    workflow_status: 'completed',
    needs_review: false,
    last_error: null,
  });
  const completeBody = parseBody(completeResponse);
  const completedRecord = completeBody.record;

  assert.equal(completeResponse.statusCode, 200, completeResponse.body);
  assert.ok(completedRecord, 'mark complete should return a workflow record');
  assert.equal(completedRecord.workflow_status, 'completed');
  assert.equal(completedRecord.current_stage, null);
  assert.equal(completedRecord.next_agent, null);
  assert.equal(completedRecord.completed_agents.includes('final_article'), true);
  assert.deepEqual(completedRecord.agent_outputs.final_article?.output, {
    title: 'Retry-visible final article',
    body: 'Preserved final article output.',
  });
});

test('mark_published stabilizes stale pre-completion reads and preserves completed final article state', async () => {
  const store = createMemoryStore();
  const requestId = `stale-mark-published-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const checkoutRecord = await createAndCheckout(store, requestId, 300);
  const lock = checkoutRecord.lock;

  assert.ok(lock, 'checkout record should have a lock');

  const patchResponse = await patchAgentOutput(store, {
    action: 'patch_agent_output',
    request_id: requestId,
    agent_name: 'final_article',
    expected_agent_version: 0,
    lock_token: lock.token,
    output: { title: 'Published stale-read final article', body: 'Final article output to preserve.' },
  });
  const patchBody = parseBody(patchResponse);
  const preCompletionRecord = patchBody.record;

  assert.equal(patchResponse.statusCode, 200, patchResponse.body);
  assert.ok(preCompletionRecord, 'patch should return a workflow record');
  assert.notEqual(preCompletionRecord.workflow_status, 'completed');

  const completeResponse = await markAgentComplete(store, {
    action: 'mark_agent_complete',
    request_id: requestId,
    agent_name: 'final_article',
    expected_record_version: preCompletionRecord.version,
    lock_token: lock.token,
    current_stage: null,
    next_agent: null,
    workflow_status: 'completed',
    needs_review: false,
    last_error: null,
  });
  const completeBody = parseBody(completeResponse);
  const completedRecord = completeBody.record;

  assert.equal(completeResponse.statusCode, 200, completeResponse.body);
  assert.ok(completedRecord, 'completion should return a workflow record');
  assert.equal(completedRecord.workflow_status, 'completed');
  assert.equal(completedRecord.current_stage, null);
  assert.equal(completedRecord.next_agent, null);
  assert.equal(completedRecord.completed_agents.includes('final_article'), true);

  const originalGet = store.get.bind(store);
  let hideCompletedRecordOnce = true;
  store.get = async (key: string) => {
    if (hideCompletedRecordOnce && key === recordKey(requestId)) {
      hideCompletedRecordOnce = false;
      return JSON.stringify(preCompletionRecord);
    }

    return originalGet(key);
  };

  const publishResponse = await markPublished(store, {
    action: 'mark_published',
    request_id: requestId,
    expected_record_version: completedRecord.version,
    lock_token: lock.token,
    commit_metadata: { commit: 'stale-publish-commit', articlePath: 'src/data/post/stale-published.md' },
  });
  const publishBody = parseBody(publishResponse);
  const publishedRecord = publishBody.record;

  assert.equal(publishResponse.statusCode, 200, publishResponse.body);
  assert.ok(publishedRecord, 'publish should return a workflow record');
  assert.equal(publishedRecord.workflow_status, 'published');
  assert.deepEqual(publishedRecord.completed_agents, completedRecord.completed_agents);
  assert.equal(publishedRecord.current_stage, completedRecord.current_stage);
  assert.equal(publishedRecord.next_agent, completedRecord.next_agent);
  assert.deepEqual(publishedRecord.agent_outputs.final_article, completedRecord.agent_outputs.final_article);
});

test('get_request returns monotonic records when visible versions arrive out of order', async () => {
  const store = createMemoryStore();
  const requestId = `monotonic-get-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const checkoutRecord = await createAndCheckout(store, requestId, 300);
  const lock = checkoutRecord.lock;

  assert.ok(lock, 'checkout record should have a lock');

  const completedRecord: WorkflowRecord = {
    ...checkoutRecord,
    workflow_status: 'completed',
    current_stage: null,
    next_agent: null,
    completed_agents: [...checkoutRecord.completed_agents, 'final_article'],
    agent_outputs: {
      ...checkoutRecord.agent_outputs,
      final_article: {
        version: 1,
        updated_at: new Date().toISOString(),
        expected_agent_version: 0,
        output: { title: 'Monotonic get final article' },
      },
    },
    history: [
      ...checkoutRecord.history,
      { at: new Date().toISOString(), action: 'mark_agent_complete', agent_name: 'final_article' },
    ],
    version: checkoutRecord.version + 1,
  };
  const publishedRecord: WorkflowRecord = {
    ...completedRecord,
    workflow_status: 'published',
    lock: undefined,
    history: [...completedRecord.history, { at: new Date().toISOString(), action: 'mark_published' }],
    version: completedRecord.version + 1,
  };
  const visibleRecords = [
    publishedRecord,
    completedRecord,
    checkoutRecord,
    completedRecord,
    checkoutRecord,
    publishedRecord,
  ];
  const originalGet = store.get.bind(store);
  store.get = async (key: string) => {
    if (key === recordKey(requestId) && visibleRecords.length > 0) {
      return JSON.stringify(visibleRecords.shift());
    }

    return originalGet(key);
  };

  const firstResponse = await getRequest(store, { action: 'get_request', request_id: requestId });
  const firstBody = parseBody(firstResponse);
  const secondResponse = await getRequest(store, { action: 'get_request', request_id: requestId });
  const secondBody = parseBody(secondResponse);

  assert.equal(firstResponse.statusCode, 200, firstResponse.body);
  assert.equal(secondResponse.statusCode, 200, secondResponse.body);
  assert.equal(firstBody.record?.version, publishedRecord.version);
  assert.equal(secondBody.record?.version, publishedRecord.version);
  assert.equal(firstBody.record?.workflow_status, 'published');
  assert.equal(secondBody.record?.workflow_status, 'published');
  assert.deepEqual(secondBody.record?.agent_outputs.final_article, publishedRecord.agent_outputs.final_article);
});

test('patch_agent_output lock_expired diagnostics use UTC milliseconds and include deltaMs', async () => {
  const store = createMemoryStore();
  const requestId = `expired-lock-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const checkoutRecord = await createAndCheckout(store, requestId, 300);
  const lock = checkoutRecord.lock;

  assert.ok(lock, 'checkout record should have a lock');

  const expiredRecord: WorkflowRecord = {
    ...checkoutRecord,
    lock: {
      ...lock,
      acquired_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      expires_at: new Date(Date.now() - 60 * 1000).toISOString(),
    },
  };
  await store.setJSON(recordKey(requestId), expiredRecord);

  const patchResponse = await patchAgentOutput(store, {
    action: 'patch_agent_output',
    request_id: requestId,
    agent_name: 'reader_insight',
    expected_agent_version: 0,
    lock_token: lock.token,
    output: { summary: 'This should not patch because the lock is expired.' },
  });
  const body = parseBody(patchResponse);

  assert.equal(patchResponse.statusCode, 423, patchResponse.body);
  assert.equal(body.lock_expired, true);
  assert.equal(body.diagnostics?.expiresAtISO, expiredRecord.lock?.expires_at);
  assert.equal(body.diagnostics?.acquiredAtISO, expiredRecord.lock?.acquired_at);
  assert.ok(typeof body.diagnostics?.nowISO === 'string');
  assert.ok(typeof body.diagnostics?.deltaMs === 'number' && body.diagnostics.deltaMs < 0);
});

test('patch_agent_output recovers when a stale expired-lock snapshot is followed by an active matching lock', async () => {
  const store = createMemoryStore();
  const requestId = `stale-expired-patch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const checkoutRecord = await createAndCheckout(store, requestId, 300);
  const lock = checkoutRecord.lock;

  assert.ok(lock, 'checkout record should have a lock');

  const expiredSnapshot: WorkflowRecord = {
    ...checkoutRecord,
    lock: {
      ...lock,
      acquired_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      expires_at: new Date(Date.now() - 60 * 1000).toISOString(),
    },
  };
  const originalGet = store.get.bind(store);
  let returnedExpiredSnapshot = false;
  store.get = async (key: string) => {
    if (!returnedExpiredSnapshot && key === recordKey(requestId)) {
      returnedExpiredSnapshot = true;
      return JSON.stringify(expiredSnapshot);
    }

    return originalGet(key);
  };

  const patchResponse = await patchAgentOutput(store, {
    action: 'patch_agent_output',
    request_id: requestId,
    agent_name: 'reader_insight',
    expected_agent_version: 0,
    lock_token: lock.token,
    output: { summary: 'Recovered after a stale expired lock read.' },
  });
  const body = parseBody(patchResponse);

  assert.equal(patchResponse.statusCode, 200, patchResponse.body);
  assert.notEqual(body.lock_expired, true);
  assert.equal(body.record?.lock?.token, lock.token);
  assert.equal(body.record?.agent_outputs.reader_insight?.version, 1);
  assert.equal(returnedExpiredSnapshot, true);
});

test('refresh_lock recovers when a stale expired-lock snapshot is followed by an active matching lock', async () => {
  const store = createMemoryStore();
  const requestId = `stale-expired-refresh-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const checkoutRecord = await createAndCheckout(store, requestId, 300);
  const lock = checkoutRecord.lock;

  assert.ok(lock, 'checkout record should have a lock');

  const expiredSnapshot: WorkflowRecord = {
    ...checkoutRecord,
    lock: {
      ...lock,
      acquired_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      expires_at: new Date(Date.now() - 60 * 1000).toISOString(),
    },
  };
  const originalGet = store.get.bind(store);
  let returnedExpiredSnapshot = false;
  store.get = async (key: string) => {
    if (!returnedExpiredSnapshot && key === recordKey(requestId)) {
      returnedExpiredSnapshot = true;
      return JSON.stringify(expiredSnapshot);
    }

    return originalGet(key);
  };

  const refreshResponse = await refreshLock(store, {
    action: 'refresh_lock',
    request_id: requestId,
    lock_token: lock.token,
    lease_seconds: 300,
  });
  const body = parseBody(refreshResponse);

  assert.equal(refreshResponse.statusCode, 200, refreshResponse.body);
  assert.notEqual(body.lock_expired, true);
  assert.equal(body.record?.lock?.token, lock.token);
  assert.ok(
    Date.parse(body.record?.lock?.expires_at ?? '') > Date.parse(lock.expires_at),
    'refresh should extend the active matching lock rather than fail on the stale expired snapshot'
  );
  assert.equal(returnedExpiredSnapshot, true);
});

test('final_article completion preserves output when first completion read is stale without final_article output', async () => {
  const store = createMemoryStore();
  const requestId = `final-output-stale-complete-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const checkoutRecord = await createAndCheckout(store, requestId, 300);
  const lock = checkoutRecord.lock;

  assert.ok(lock, 'checkout record should have a lock');

  const patchResponse = await patchAgentOutput(store, {
    action: 'patch_agent_output',
    request_id: requestId,
    agent_name: 'final_article',
    expected_agent_version: 0,
    lock_token: lock.token,
    output: { title: 'Preserved final article', body: 'The final article output must survive completion.' },
  });
  const patchBody = parseBody(patchResponse);
  const patchedRecord = patchBody.record;

  assert.equal(patchResponse.statusCode, 200, patchResponse.body);
  assert.ok(patchedRecord?.agent_outputs.final_article, 'patch should write final_article output');

  const staleCompletionSnapshot: WorkflowRecord = {
    ...(patchedRecord as WorkflowRecord),
    agent_outputs: {},
  };
  const originalGet = store.get.bind(store);
  let returnedStaleCompletionSnapshot = false;
  store.get = async (key: string) => {
    if (!returnedStaleCompletionSnapshot && key === recordKey(requestId)) {
      returnedStaleCompletionSnapshot = true;
      return JSON.stringify(staleCompletionSnapshot);
    }

    return originalGet(key);
  };

  const completeResponse = await markAgentComplete(store, {
    action: 'mark_agent_complete',
    request_id: requestId,
    agent_name: 'final_article',
    expected_record_version: (patchedRecord as WorkflowRecord).version,
    lock_token: lock.token,
    current_stage: null,
    next_agent: null,
    workflow_status: 'completed',
    needs_review: false,
    last_error: null,
  });
  const completeBody = parseBody(completeResponse);

  assert.equal(completeResponse.statusCode, 200, completeResponse.body);
  assert.equal(returnedStaleCompletionSnapshot, true);
  assert.deepEqual(
    completeBody.record?.agent_outputs.final_article,
    patchedRecord?.agent_outputs.final_article,
    'completion response should preserve the previously written final_article output'
  );
  assert.equal(completeBody.record?.workflow_status, 'completed');
  assert.equal(completeBody.record?.completed_agents.includes('final_article'), true);

  const getResponse = await getRequest(store, { action: 'get_request', request_id: requestId });
  const getBody = parseBody(getResponse);

  assert.equal(getResponse.statusCode, 200, getResponse.body);
  assert.deepEqual(
    getBody.record?.agent_outputs.final_article,
    patchedRecord?.agent_outputs.final_article,
    'durable get_request should preserve the previously written final_article output'
  );
  assert.equal(getBody.record?.workflow_status, 'completed');
});
