import '../../../../sites/drlurie/config/policy-bindings.js'; // registers site providers — handleObjectVerb needs them resolvable (migrate-site.test.ts's precedent)
import { describe, it } from 'node:test';
import assert from 'node:assert';

import { handleObjectVerb, type AgentLearningWriteStore, type ObjectVerbStore } from './object-verbs.js';
import { objectRecordKey } from './object-store-keys.js';
import type { ObjectRecord, Principal } from '../../schema/object-record-v1.js';
import { AGENT_LEARNING_TRAIL_OP, type TaggedProposal } from '../../lib/admin/agent-learning-trail.js';

// ─── injected-store pattern (migrate-site.test.ts's createMemoryStore) ───────

const makeStore = (seed: ObjectRecord) => {
  const blobs = new Map<string, string>();
  blobs.set(objectRecordKey(seed.object_type, seed.object_id), JSON.stringify(seed));
  return {
    blobs,
    async get(key: string) {
      return blobs.get(key) ?? null;
    },
    async setJSON(key: string, value: unknown) {
      blobs.set(key, JSON.stringify(value));
    },
    async list({ prefix }: { prefix: string }) {
      return { blobs: [...blobs.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) };
    },
  };
};

const makeLearningStore = () => {
  const writes: Array<{ key: string; value: unknown }> = [];
  return {
    writes,
    async setJSON(key: string, value: unknown) {
      writes.push({ key, value });
    },
  };
};

const NOW_MS = Date.parse('2026-08-04T00:00:00.000Z');
const LOCK_TOKEN = 'lock-test-token';
const HUMAN: Principal = { kind: 'human', id: 'u1', email: 'editor@example.com' };

// A proven-valid page body (migrate-site.test.ts's validPageBody — asserted 200
// through this exact handleObjectVerb harness for object_create + validateObject).
const pageBody = () => ({
  route: '/test-page',
  pageType: 'standard',
  title: 'Home',
  seo: { description: 'x' },
  sections: [{ id: 's_hero', type: 'hero', data: { heading: 'Hi', actions: [] } }],
});

const makeRecord = (): ObjectRecord => ({
  object_id: 'page_test1',
  object_type: 'page',
  schema_version: 'page.v1',
  site: 'site_drlurie',
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
  status: 'active',
  body: pageBody(),
  publication: { published_time: null },
  history: [],
  version: 5,
  content_revision: 3,
  lock: {
    token: LOCK_TOKEN,
    owner_id: 'u1',
    owner_label: 'editor@example.com',
    acquired_at: '2026-08-04T00:00:00.000Z',
    expires_at: '2026-08-04T00:30:00.000Z',
  },
});

const taggedProposal: TaggedProposal = {
  instruction: 'Make the hero heading punchier',
  suggestion: { heading: 'A calmer start today' },
  at: '2026-08-04T00:00:00.000Z',
  disposition: 'accepted_verbatim',
};

describe('handleObjectVerb patch — agent-learning trail capture (S4x 2/2)', () => {
  it('writes nothing when the ops array carries no trail marker — an ordinary save, or ask-alone with no save at all', async () => {
    const record = makeRecord();
    const store = makeStore(record);
    const learningStore = makeLearningStore();
    const result = await handleObjectVerb(
      store as unknown as ObjectVerbStore,
      {
        action: 'patch',
        object_type: 'page',
        object_id: record.object_id,
        lock_token: LOCK_TOKEN,
        expected_record_version: record.version,
        ops: [{ op: 'update_section_data', section_id: 's_hero', fields: { heading: 'New heading' } }],
      },
      HUMAN,
      { nowMs: NOW_MS, agentLearningStore: learningStore as unknown as AgentLearningWriteStore }
    );
    assert.strictEqual(result.status, 200, JSON.stringify(result.body));
    assert.strictEqual(learningStore.writes.length, 0, 'no marker in the ops array must mean no learning write at all');
  });

  it('writes the tagged trail only after the save it describes has actually persisted, and never lets the marker reach the object body or history', async () => {
    const record = makeRecord();
    const store = makeStore(record);
    const learningStore = makeLearningStore();
    const result = await handleObjectVerb(
      store as unknown as ObjectVerbStore,
      {
        action: 'patch',
        object_type: 'page',
        object_id: record.object_id,
        lock_token: LOCK_TOKEN,
        expected_record_version: record.version,
        ops: [
          { op: 'update_section_data', section_id: 's_hero', fields: { heading: 'A calmer start today' } },
          { op: AGENT_LEARNING_TRAIL_OP, proposals: [taggedProposal] },
        ],
      },
      HUMAN,
      { nowMs: NOW_MS, agentLearningStore: learningStore as unknown as AgentLearningWriteStore }
    );
    assert.strictEqual(result.status, 200, JSON.stringify(result.body));

    assert.strictEqual(learningStore.writes.length, 1);
    const write = learningStore.writes[0]!;
    assert.match(write.key, /^learning\/2026-08-04\/\d+-page-page_test1\.json$/);
    const written = write.value as Record<string, unknown>;
    assert.strictEqual(written.object_id, record.object_id);
    assert.strictEqual(written.object_type, 'page');
    assert.strictEqual(written.site, 'site_drlurie');
    assert.strictEqual(written.saved_at, new Date(NOW_MS).toISOString());
    assert.deepStrictEqual(written.editor, HUMAN);
    assert.deepStrictEqual(written.proposals, [taggedProposal]);

    // The marker never became a content op: the real op still applied, and
    // the marker itself appears nowhere in the persisted record.
    const stored = JSON.parse(store.blobs.get(objectRecordKey('page', record.object_id))!);
    assert.strictEqual(stored.body.sections[0].data.heading, 'A calmer start today');
    for (const entry of stored.history) {
      assert.notStrictEqual(entry.action, AGENT_LEARNING_TRAIL_OP);
      assert.notStrictEqual(entry.details?.op?.op, AGENT_LEARNING_TRAIL_OP);
    }
  });

  it('never writes the trail when the patch itself fails (a stale expected_record_version) — no orphaned learning record', async () => {
    const record = makeRecord();
    const store = makeStore(record);
    const learningStore = makeLearningStore();
    const result = await handleObjectVerb(
      store as unknown as ObjectVerbStore,
      {
        action: 'patch',
        object_type: 'page',
        object_id: record.object_id,
        lock_token: LOCK_TOKEN,
        expected_record_version: record.version + 1, // stale on purpose
        ops: [
          { op: 'update_section_data', section_id: 's_hero', fields: { heading: 'Whatever' } },
          { op: AGENT_LEARNING_TRAIL_OP, proposals: [taggedProposal] },
        ],
      },
      HUMAN,
      { nowMs: NOW_MS, agentLearningStore: learningStore as unknown as AgentLearningWriteStore }
    );
    assert.strictEqual(result.status, 409);
    assert.strictEqual(learningStore.writes.length, 0);
  });

  it('never writes the trail when validation refuses the patch — a failed save is still a failed save', async () => {
    const record = makeRecord();
    const store = makeStore(record);
    const learningStore = makeLearningStore();
    const result = await handleObjectVerb(
      store as unknown as ObjectVerbStore,
      {
        action: 'patch',
        object_type: 'page',
        object_id: record.object_id,
        lock_token: LOCK_TOKEN,
        expected_record_version: record.version,
        ops: [
          // A hero section's `heading` is required (min length 1); an empty
          // string fails schema validation and the patch is refused (422).
          { op: 'update_section_data', section_id: 's_hero', fields: { heading: '' } },
          { op: AGENT_LEARNING_TRAIL_OP, proposals: [taggedProposal] },
        ],
      },
      HUMAN,
      { nowMs: NOW_MS, agentLearningStore: learningStore as unknown as AgentLearningWriteStore }
    );
    assert.strictEqual(result.status, 422, JSON.stringify(result.body));
    assert.strictEqual(learningStore.writes.length, 0);
  });

  it('never throws and simply skips the write when no agentLearningStore is injected (the publish-key agent path)', async () => {
    const record = makeRecord();
    const store = makeStore(record);
    const result = await handleObjectVerb(
      store as unknown as ObjectVerbStore,
      {
        action: 'patch',
        object_type: 'page',
        object_id: record.object_id,
        lock_token: LOCK_TOKEN,
        expected_record_version: record.version,
        ops: [
          { op: 'update_section_data', section_id: 's_hero', fields: { heading: 'Whatever' } },
          { op: AGENT_LEARNING_TRAIL_OP, proposals: [taggedProposal] },
        ],
      },
      HUMAN,
      { nowMs: NOW_MS } // no agentLearningStore
    );
    assert.strictEqual(result.status, 200, JSON.stringify(result.body));
  });
});
