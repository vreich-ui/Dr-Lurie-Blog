import assert from 'node:assert/strict';
import test from 'node:test';

import { saveAdminJsonDraft } from '../../netlify/functions/admin-save-json-draft.js';
import type { WorkflowRecord } from '../../src/schema/schema-v1.js';

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

const parseBody = (response: Awaited<ReturnType<typeof saveAdminJsonDraft>>) => JSON.parse(response.body);
const recordKey = (requestId: string) => `workflows/by-id/${requestId}.json`;

const validInput = (overrides: Record<string, unknown> = {}) => ({
  record_type: 'content_source',
  schema_version: 'content_source.v1',
  content: {
    schema_version: 'content_blocks.v1',
    title: 'Skin Barrier Draft',
  },
  publication: {
    schema_version: 'publication.v1',
    publication_status: 'draft',
    publish_payload: {
      slug: 'skin-barrier-draft',
      title: 'Skin Barrier Draft',
      author: 'Dr. Lurié',
      content: 'Draft body.',
      draft: true,
      ...(overrides.publish_payload && typeof overrides.publish_payload === 'object'
        ? (overrides.publish_payload as Record<string, unknown>)
        : {}),
    },
  },
  ...(overrides.input && typeof overrides.input === 'object' ? (overrides.input as Record<string, unknown>) : {}),
});

const checkedOutRecord = (input = validInput()): WorkflowRecord => ({
  request_id: 'req_checked_out',
  created_at: '2026-06-04T00:00:00.000Z',
  updated_at: '2026-06-04T00:00:00.000Z',
  workflow_status: 'in_progress',
  current_stage: 'draft',
  next_agent: 'final_article',
  completed_agents: [],
  failed_agents: [],
  last_error: null,
  needs_review: false,
  input: input as WorkflowRecord['input'],
  agent_outputs: {},
  lock: {
    token: 'lock_valid',
    owner_id: 'admin-user',
    owner_label: 'Admin UI',
    acquired_at: '2026-06-04T00:00:00.000Z',
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  },
  history: [{ at: '2026-06-04T00:00:00.000Z', action: 'checkout_request' }],
  version: 3,
});

test('admin JSON draft save rejects missing title', async () => {
  const store = createMemoryStore();
  const input = validInput({
    publish_payload: { title: '' },
    input: { content: { schema_version: 'content_blocks.v1' } },
  });

  const response = await saveAdminJsonDraft(store, { input });
  const body = parseBody(response);

  assert.equal(response.statusCode, 400);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'Title, slug, and author are required to save JSON draft.');
});

test('admin JSON draft save rejects missing slug when no slug can be computed from the title', async () => {
  const store = createMemoryStore();
  const input = validInput({ publish_payload: { slug: '', title: '!!!' }, input: { content: { title: '!!!' } } });

  const response = await saveAdminJsonDraft(store, { input });
  const body = parseBody(response);

  assert.equal(response.statusCode, 400);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'Title, slug, and author are required to save JSON draft.');
});

test('admin JSON draft save rejects missing author', async () => {
  const store = createMemoryStore();
  const input = validInput({ publish_payload: { author: '' } });

  const response = await saveAdminJsonDraft(store, { input });
  const body = parseBody(response);

  assert.equal(response.statusCode, 400);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'Title, slug, and author are required to save JSON draft.');
});

test('admin JSON draft save creates a new blob draft workflow record', async () => {
  const store = createMemoryStore();

  const response = await saveAdminJsonDraft(store, { input: validInput() });
  const body = parseBody(response);
  const record = body.record as WorkflowRecord;

  assert.equal(response.statusCode, 201);
  assert.equal(record.workflow_status, 'pending');
  assert.equal(record.input.publication?.publication_status, 'draft');
  assert.equal(record.input.publication?.publish_payload?.draft, true);
  assert.ok(record.request_id.startsWith('admin-draft-'));
  assert.equal(store.blobs.has(recordKey(record.request_id)), true);
});

test('admin JSON draft save updates a checked-out blob record with its active lock token', async () => {
  const store = createMemoryStore();
  const existing = checkedOutRecord();
  await store.setJSON(recordKey(existing.request_id), existing);

  const response = await saveAdminJsonDraft(store, {
    request_id: existing.request_id,
    lock_token: 'lock_valid',
    input: validInput({ publish_payload: { title: 'Updated Draft', slug: 'updated-draft', author: 'Dr. Lurié' } }),
  });
  const body = parseBody(response);
  const record = body.record as WorkflowRecord;

  assert.equal(response.statusCode, 200);
  assert.equal(record.request_id, existing.request_id);
  assert.equal(record.input.publication?.publish_payload?.title, 'Updated Draft');
  assert.equal(record.input.publication?.publish_payload?.slug, 'updated-draft');
  assert.equal(record.input.publication?.publish_payload?.draft, true);
  assert.equal(record.input.publication?.publication_status, 'draft');
});

test('admin JSON draft save rejects checked-out updates when the lock token mismatches', async () => {
  const store = createMemoryStore();
  const existing = checkedOutRecord();
  await store.setJSON(recordKey(existing.request_id), existing);

  const response = await saveAdminJsonDraft(store, {
    request_id: existing.request_id,
    lock_token: 'lock_wrong',
    input: validInput(),
  });
  const body = parseBody(response);

  assert.equal(response.statusCode, 423);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'lock_token_mismatch');
});

test('admin JSON draft save checkin clears the lock after a successful checked-out update', async () => {
  const store = createMemoryStore();
  const existing = checkedOutRecord();
  await store.setJSON(recordKey(existing.request_id), existing);

  const response = await saveAdminJsonDraft(store, {
    request_id: existing.request_id,
    lock_token: 'lock_valid',
    input: validInput(),
  });
  const body = parseBody(response);
  const record = body.record as WorkflowRecord;
  const persisted = JSON.parse((await store.get(recordKey(existing.request_id))) ?? '{}') as WorkflowRecord;

  assert.equal(response.statusCode, 200);
  assert.equal(record.lock, undefined);
  assert.equal(persisted.lock, undefined);
  assert.equal(body.checked_in, true);
});
