import assert from 'node:assert/strict';
import test from 'node:test';

import { checkoutRequest, createRequest, type WorkflowRecord } from '../../netlify/functions/save-json-blob.js';

const recordKey = (requestId: string) => `workflows/by-id/${requestId}.json`;

type ResponseBody = {
  action: string;
  diagnostics?: {
    attempts: number;
    first_non_null_attempt?: number;
    max_attempts: number;
    null_read_attempts: number[];
    request_id: string;
    saw_transient_null_reads: boolean;
    stabilization_delay_ms: number;
  };
  not_found?: boolean;
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

const parseBody = (response: Awaited<ReturnType<typeof checkoutRequest>>) => JSON.parse(response.body) as ResponseBody;

const contentSourceInput = (requestId: string) => ({
  record_type: 'content_source',
  schema_version: 'content_source.v1',
  content: {
    schema_version: 'content_blocks.v1',
    title: 'Checkout eventual consistency test',
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

test('checkout_request stabilizes transient not-found reads after create before acquiring a lock', async () => {
  const store = createMemoryStore();
  const requestId = `checkout-retry-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const createResponse = await createRequest(store, {
    action: 'create_request',
    request_id: requestId,
    input: contentSourceInput(requestId),
  });
  assert.equal(createResponse.statusCode, 201, createResponse.body);
  let recordGetAttempts = 0;
  const flakyStore = {
    ...store,
    async get(key: string) {
      if (key === recordKey(requestId)) {
        recordGetAttempts += 1;
        if (recordGetAttempts <= 6) return null;
      }

      return store.get(key);
    },
  };

  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    const checkoutResponse = await checkoutRequest(flakyStore, {
      action: 'checkout_request',
      request_id: requestId,
      owner_id: 'checkout-retry-agent',
      owner_label: 'Checkout retry agent',
      lease_seconds: 900,
    });
    const body = parseBody(checkoutResponse);

    assert.equal(checkoutResponse.statusCode, 200, checkoutResponse.body);
    assert.equal(body.record?.request_id, requestId);
    assert.equal(body.record?.lock?.owner_id, 'checkout-retry-agent');
    assert.deepEqual(body.diagnostics, {
      request_id: requestId,
      attempts: 7,
      first_non_null_attempt: 7,
      max_attempts: 20,
      null_read_attempts: [1, 2, 3, 4, 5, 6],
      saw_transient_null_reads: true,
      stabilization_delay_ms: 100,
    });
    assert.equal(recordGetAttempts, 10);
    assert.equal(warnings.length, 6);
    assert.deepEqual(
      warnings.map((warning) => (warning[1] as { attempts: number }).attempts),
      [1, 2, 3, 4, 5, 6]
    );
  } finally {
    console.warn = originalWarn;
  }
});

test('checkout_request returns final not_found diagnostics only after retry attempts are exhausted', async () => {
  const store = createMemoryStore();
  const requestId = `checkout-missing-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    const checkoutResponse = await checkoutRequest(store, {
      action: 'checkout_request',
      request_id: requestId,
      owner_id: 'checkout-retry-agent',
      owner_label: 'Checkout retry agent',
      lease_seconds: 900,
    });
    const body = parseBody(checkoutResponse);

    assert.equal(checkoutResponse.statusCode, 404, checkoutResponse.body);
    assert.equal(body.not_found, true);
    assert.deepEqual(body.diagnostics, {
      request_id: requestId,
      attempts: 20,
      max_attempts: 20,
      null_read_attempts: Array.from({ length: 20 }, (_, index) => index + 1),
      saw_transient_null_reads: true,
      stabilization_delay_ms: 100,
    });
    assert.equal(warnings.length, 20);
    assert.deepEqual(
      warnings.slice(0, 19).map((warning) => (warning[1] as { attempts: number }).attempts),
      Array.from({ length: 19 }, (_, index) => index + 1)
    );
    assert.deepEqual(warnings.at(-1)?.[1], body.diagnostics);
  } finally {
    console.warn = originalWarn;
  }
});
