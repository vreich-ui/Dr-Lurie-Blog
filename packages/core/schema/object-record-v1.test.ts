import { describe, it } from 'node:test';
import assert from 'node:assert';
import { objectRecordSchema, type ObjectRecord } from './object-record-v1.js';

const validEnvelope: ObjectRecord<Record<string, unknown>> = {
  object_id: 'page_home',
  object_type: 'page',
  schema_version: 'page.v1',
  site: 'site_drlurie',
  created_at: '2026-07-03T00:00:00.000Z',
  updated_at: '2026-07-03T00:00:00.000Z',
  status: 'active',
  body: { title: 'Home' },
  publication: { published_time: null },
  history: [
    {
      at: '2026-07-03T00:00:00.000Z',
      action: 'object_create',
      actor: { kind: 'agent', agent_name: 'codex', auth: 'publish_key' },
    },
  ],
  version: 1,
  content_revision: 1,
};

describe('ObjectRecord envelope schema', () => {
  it('round-trips a valid envelope', () => {
    const parsed = objectRecordSchema.parse(validEnvelope);

    assert.deepStrictEqual(parsed, validEnvelope);
  });

  it('rejects an unknown object_type', () => {
    const result = objectRecordSchema.safeParse({
      ...validEnvelope,
      object_type: 'widget',
    });

    assert.strictEqual(result.success, false);
  });

  it('allows version and content_revision to move independently', () => {
    const lockOnlyWrite = objectRecordSchema.parse({
      ...validEnvelope,
      version: 2,
      content_revision: 1,
    });
    const bodyWrite = objectRecordSchema.parse({
      ...validEnvelope,
      version: 3,
      content_revision: 2,
    });

    assert.strictEqual(lockOnlyWrite.version, 2);
    assert.strictEqual(lockOnlyWrite.content_revision, 1);
    assert.strictEqual(bodyWrite.version, 3);
    assert.strictEqual(bodyWrite.content_revision, 2);
  });
});
