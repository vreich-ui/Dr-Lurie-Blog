import assert from 'node:assert/strict';
import test from 'node:test';
import { checkoutRequest, createRequest } from '../../netlify/functions/save-json-blob.js';
const recordKey = (requestId) => `workflows/by-id/${requestId}.json`;
const createMemoryStore = () => {
    const blobs = new Map();
    return {
        blobs,
        async set(key, value) {
            blobs.set(key, value);
        },
        async get(key) {
            return blobs.get(key) ?? null;
        },
        async del(key) {
            blobs.delete(key);
        },
        async setJSON(key, value) {
            blobs.set(key, JSON.stringify(value));
        },
        async list(options) {
            const prefix = options?.prefix ?? '';
            return {
                blobs: [...blobs.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key, etag: '' })),
                directories: [],
            };
        },
    };
};
const parseBody = (response) => JSON.parse(response.body);
const contentSourceInput = (requestId) => ({
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
        async get(key, options) {
            if (options?.consistency === 'strong') {
                throw new Error('Strong consistency is not available for this blob store.');
            }
            if (key === recordKey(requestId)) {
                recordGetAttempts += 1;
                if (recordGetAttempts <= 6)
                    return null;
            }
            return store.get(key);
        },
    };
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args);
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
            record_key: recordKey(requestId),
            attempts: 7,
            eventual_read_exhausted: false,
            first_non_null_attempt: 7,
            max_attempts: 20,
            null_read_attempts: [1, 2, 3, 4, 5, 6],
            saw_transient_null_reads: true,
            stabilization_delay_ms: 100,
            strong_read_attempts: 6,
            strong_read_succeeded: false,
        });
        assert.equal(recordGetAttempts, 10);
        assert.equal(warnings.length, 6);
        assert.deepEqual(warnings.map((warning) => warning[1].attempts), [1, 2, 3, 4, 5, 6]);
    }
    finally {
        console.warn = originalWarn;
    }
});
test('checkout_request can recover immediately when a strong-consistency read sees the canonical record', async () => {
    const store = createMemoryStore();
    const requestId = `checkout-strong-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const createResponse = await createRequest(store, {
        action: 'create_request',
        request_id: requestId,
        input: contentSourceInput(requestId),
    });
    assert.equal(createResponse.statusCode, 201, createResponse.body);
    let eventualRecordGetAttempts = 0;
    let strongRecordGetAttempts = 0;
    const strongVisibleStore = {
        ...store,
        async get(key, options) {
            if (key === recordKey(requestId)) {
                if (options?.consistency === 'strong') {
                    strongRecordGetAttempts += 1;
                    return store.get(key);
                }
                eventualRecordGetAttempts += 1;
                return null;
            }
            return store.get(key);
        },
    };
    const checkoutResponse = await checkoutRequest(strongVisibleStore, {
        action: 'checkout_request',
        request_id: requestId,
        owner_id: 'checkout-strong-agent',
        owner_label: 'Checkout strong agent',
        lease_seconds: 900,
    });
    const body = parseBody(checkoutResponse);
    assert.equal(checkoutResponse.statusCode, 200, checkoutResponse.body);
    assert.notEqual(body.not_found, true);
    assert.equal(body.record?.request_id, requestId);
    assert.equal(body.record?.lock?.owner_id, 'checkout-strong-agent');
    assert.equal(typeof body.record?.lock?.token, 'string');
    assert.deepEqual(body.diagnostics, {
        request_id: requestId,
        record_key: recordKey(requestId),
        attempts: 1,
        eventual_read_exhausted: false,
        first_non_null_attempt: 1,
        max_attempts: 20,
        null_read_attempts: [1],
        saw_transient_null_reads: true,
        stabilization_delay_ms: 100,
        strong_read_attempts: 1,
        strong_read_succeeded: true,
    });
    assert.equal(strongRecordGetAttempts, 1);
    assert.ok(eventualRecordGetAttempts > 0);
});
test('checkout_request returns final not_found diagnostics only after retry attempts are exhausted', async () => {
    const store = createMemoryStore();
    const requestId = `checkout-missing-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args);
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
            record_key: recordKey(requestId),
            attempts: 20,
            eventual_read_exhausted: true,
            max_attempts: 20,
            null_read_attempts: Array.from({ length: 20 }, (_, index) => index + 1),
            saw_transient_null_reads: true,
            stabilization_delay_ms: 100,
            strong_read_attempts: 20,
            strong_read_succeeded: false,
        });
        assert.equal(warnings.length, 20);
        assert.deepEqual(warnings.slice(0, 19).map((warning) => warning[1].attempts), Array.from({ length: 19 }, (_, index) => index + 1));
        assert.deepEqual(warnings.at(-1)?.[1], body.diagnostics);
    }
    finally {
        console.warn = originalWarn;
    }
});
