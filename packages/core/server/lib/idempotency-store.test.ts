import { describe, it } from 'node:test';
import assert from 'node:assert';

import { withIdempotencyStore, type IdempotencyBlobStore, type ToolCallResponse } from './idempotency-store.js';

// ─── injected-store pattern (marginalia-store.test.ts's makeStore) ──────────
const makeStore = (): IdempotencyBlobStore & { blobs: Map<string, string> } => {
  const blobs = new Map<string, string>();
  return {
    blobs,
    async get(key: string) {
      return blobs.get(key) ?? null;
    },
    async setJSON(key: string, value: unknown, options?: { onlyIfNew?: boolean }) {
      if (options?.onlyIfNew && blobs.has(key)) return { modified: false };
      blobs.set(key, JSON.stringify(value));
      return { modified: true };
    },
  };
};

const toolResult = (payload: Record<string, unknown>): ToolCallResponse => ({
  content: JSON.stringify(payload),
  structuredContent: payload,
});

const toolError = (message: string): ToolCallResponse => ({
  isError: true,
  content: message,
  structuredContent: { error: message },
});

describe('withIdempotencyStore', () => {
  it('runs the write every time when no idempotency key is supplied', async () => {
    const store = makeStore();
    let calls = 0;
    const run = async () => {
      calls += 1;
      return toolResult({ id: `obj_${calls}` });
    };

    const first = await withIdempotencyStore(store, 'object_create', undefined, run);
    const second = await withIdempotencyStore(store, 'object_create', undefined, run);

    assert.strictEqual(calls, 2);
    assert.strictEqual(first.structuredContent?.id, 'obj_1');
    assert.strictEqual(second.structuredContent?.id, 'obj_2');
    assert.strictEqual(store.blobs.size, 0);
  });

  it('replays the original successful result on a same-key retry instead of re-running the write', async () => {
    const store = makeStore();
    let calls = 0;
    const run = async () => {
      calls += 1;
      return toolResult({ id: `obj_${calls}` });
    };

    const first = await withIdempotencyStore(store, 'object_create', 'attempt-1', run);
    const second = await withIdempotencyStore(store, 'object_create', 'attempt-1', run);

    assert.strictEqual(calls, 1, 'the write must only ever run once for a repeated key');
    assert.strictEqual(first.structuredContent?.id, 'obj_1');
    assert.strictEqual(second.structuredContent?.id, 'obj_1', 'the retry must return the ORIGINAL result');
    assert.strictEqual(second.structuredContent?.replayed_from_idempotency_key, true);
  });

  it('does NOT store or replay a failed (toolError) attempt — a retry re-runs the write', async () => {
    const store = makeStore();
    let calls = 0;
    const run = async () => {
      calls += 1;
      return calls === 1 ? toolError('lock_required') : toolResult({ id: 'obj_ok' });
    };

    const first = await withIdempotencyStore(store, 'object_create', 'attempt-1', run);
    const second = await withIdempotencyStore(store, 'object_create', 'attempt-1', run);

    assert.strictEqual(first.isError, true);
    assert.strictEqual(calls, 2, 'a failed attempt must not poison the key — a retry runs the write again');
    assert.strictEqual(second.structuredContent?.id, 'obj_ok');
  });

  it('scopes keys per tool name — the same key for two different tools does not collide', async () => {
    const store = makeStore();
    const runCreate = async () => toolResult({ id: 'obj_1' });
    const runPublish = async () => toolResult({ published: true });

    const created = await withIdempotencyStore(store, 'object_create', 'shared-key', runCreate);
    const published = await withIdempotencyStore(store, 'object_publish', 'shared-key', runPublish);

    assert.strictEqual(created.structuredContent?.id, 'obj_1');
    assert.strictEqual(published.structuredContent?.published, true);
    assert.strictEqual(published.structuredContent?.replayed_from_idempotency_key, undefined);
  });

  it('a concurrent same-key race converges on ONE winner: the loser replays the winner\'s result', async () => {
    const store = makeStore();
    let calls = 0;
    const run = async () => {
      calls += 1;
      return toolResult({ id: `obj_${calls}` });
    };

    // Simulate the loser's setJSON({onlyIfNew:true}) losing the race: the
    // winner's record is already present by the time it tries to write.
    const winner = await withIdempotencyStore(store, 'object_create', 'race-key', run);
    const loser = await withIdempotencyStore(store, 'object_create', 'race-key', run);

    assert.strictEqual(winner.structuredContent?.id, 'obj_1');
    assert.strictEqual(loser.structuredContent?.id, 'obj_1', 'both callers must converge on the same body');
  });

  it('a corrupt stored record does not block the caller — falls through and re-runs the write', async () => {
    const store = makeStore();
    store.blobs.set('idem:object_create:attempt-1', 'not valid json{{{');
    let calls = 0;
    const run = async () => {
      calls += 1;
      return toolResult({ id: `obj_${calls}` });
    };

    const result = await withIdempotencyStore(store, 'object_create', 'attempt-1', run);

    assert.strictEqual(calls, 1);
    assert.strictEqual(result.structuredContent?.id, 'obj_1');
  });
});
