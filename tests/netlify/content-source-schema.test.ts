import assert from 'node:assert/strict';
import test from 'node:test';

import { createRequest } from '../../netlify/functions/save-json-blob.js';
import { validateContentSourceV1 } from '../../src/schema/schema-v1.js';

const validContentSourceV1 = {
  record_type: 'content_source',
  schema_version: 'content_source.v1',
  content: {
    schema_version: 'content_blocks.v1',
    title: 'Skin barrier basics',
    blocks: [{ block_id: 'intro', block_type: 'markdown', payload: 'Hello' }],
  },
  publication: {
    schema_version: 'publication.v1',
    publish_payload: {
      slug: 'skin-barrier-basics',
      title: 'Skin Barrier Basics',
    },
  },
} as const;

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

const createWorkflow = (input: unknown) =>
  createRequest(createMemoryStore(), {
    action: 'create_request',
    request_id: 'req_schema_test',
    input,
  });

const parseResponseBody = (response: Awaited<ReturnType<typeof createWorkflow>>) => JSON.parse(response.body);

test('content_source.v1 payload validates and creates a workflow record', async () => {
  assert.equal(validateContentSourceV1(validContentSourceV1), true);

  const response = await createWorkflow(validContentSourceV1);
  const body = parseResponseBody(response);

  assert.equal(response.statusCode, 201);
  assert.equal(body.ok, true);
  assert.equal(body.record.input.record_type, 'content_source');
  assert.equal(body.record.input.schema_version, 'content_source.v1');
  assert.equal(body.record.input.publication.publish_payload.slug, 'skin-barrier-basics');
});

test('create_request returns HTTP 400 when required schema discriminator fields are missing', async () => {
  const response = await createWorkflow({ content: { title: 'Missing discriminators' } });
  const body = parseResponseBody(response);

  assert.equal(response.statusCode, 400);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'Invalid content_source.v1 input.');
  assert.ok(body.issues.some((issue: { path: string[] }) => issue.path.includes('record_type')));
  assert.ok(body.issues.some((issue: { path: string[] }) => issue.path.includes('schema_version')));
});

test('create_request returns HTTP 400 when content_source discriminators are invalid', async () => {
  const response = await createWorkflow({
    record_type: 'legacy_topic',
    schema_version: 'topic.v0',
    topic: 'Skin barrier',
  });
  const body = parseResponseBody(response);

  assert.equal(response.statusCode, 400);
  assert.equal(body.ok, false);
  assert.ok(body.issues.some((issue: { path: string[] }) => issue.path.join('.') === 'record_type'));
  assert.ok(body.issues.some((issue: { path: string[] }) => issue.path.join('.') === 'schema_version'));
});

test('create_request returns HTTP 400 for invalid nested publication payloads', async () => {
  const response = await createWorkflow({
    ...validContentSourceV1,
    publication: {
      schema_version: 'publication.v1',
      publish_payload: { slug: 'missing-title' },
    },
  });
  const body = parseResponseBody(response);

  assert.equal(response.statusCode, 400);
  assert.equal(body.ok, false);
  assert.ok(
    body.issues.some((issue: { path: string[] }) => issue.path.join('.') === 'publication.publish_payload.title')
  );
});
