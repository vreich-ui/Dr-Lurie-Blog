import '../../../../sites/drlurie/config/policy-bindings.js';
// mcp.ts and mcp-tool-handlers.ts are a real (documented, normally-safe)
// circular import: it only stays safe with mcp.ts as the entry, since its
// own top-level `_mcpInternal` object reads an mcp-tool-handlers.ts export
// eagerly, whereas mcp-tool-handlers.ts only ever reads mcp.ts's exports
// lazily inside function bodies. Import mcp.ts FIRST, ahead of
// mcp-tool-handlers.js below, so this test file never becomes the one place
// that flips which module starts the cycle.
import { toolError } from '../functions/mcp.js';
import { describe, it } from 'node:test';
import assert from 'node:assert';

import { ARTIFACT_BRIDGE_SCOPE_CACHE_TTL_MS, resolveArtifactBridgeScopeForJobWithStore } from './mcp-tool-handlers.js';
import type { IdempotencyBlobStore } from './idempotency-store.js';

// ─── injected-store pattern (idempotency-store.test.ts's makeStore) ─────────
const makeStore = (): IdempotencyBlobStore & { blobs: Map<string, string> } => {
  const blobs = new Map<string, string>();
  return {
    blobs,
    async get(key: string) {
      return blobs.get(key) ?? null;
    },
    async setJSON(key: string, value: unknown) {
      blobs.set(key, JSON.stringify(value));
      return { modified: true };
    },
  };
};

const okScope = (siteId: string, requestId: string) => ({ ok: true as const, scope: { siteId, requestId } });
const errScope = () => ({ ok: false as const, result: toolError('nope') });

describe('resolveArtifactBridgeScopeForJobWithStore (perf/drop-verify-hop-cache-scope, Change 2)', () => {
  it('a cache MISS calls the live resolver and caches a successful result', async () => {
    const store = makeStore();
    let liveCalls = 0;
    const resolveLive = async () => {
      liveCalls += 1;
      return okScope('site_drlurie', 'req_1');
    };

    const result = await resolveArtifactBridgeScopeForJobWithStore(
      store,
      resolveLive,
      'site_drlurie',
      'req_1',
      'job-1'
    );

    assert.strictEqual(liveCalls, 1);
    assert.deepStrictEqual(result, okScope('site_drlurie', 'req_1'));
    assert.strictEqual(store.blobs.size, 1, 'a successful live resolve must be cached');
  });

  it('a second poll for the SAME jobId does not re-invoke the live resolver (no re-check against object-store)', async () => {
    const store = makeStore();
    let liveCalls = 0;
    const resolveLive = async () => {
      liveCalls += 1;
      return okScope('site_drlurie', 'req_1');
    };

    const first = await resolveArtifactBridgeScopeForJobWithStore(store, resolveLive, 'site_drlurie', 'req_1', 'job-1');
    const second = await resolveArtifactBridgeScopeForJobWithStore(
      store,
      resolveLive,
      'site_drlurie',
      'req_1',
      'job-1'
    );

    assert.strictEqual(liveCalls, 1, 'the second poll must be served from the cache, not a fresh object-store check');
    assert.deepStrictEqual(second, first);
  });

  it('a poll for a DIFFERENT jobId resolves scope freshly (no cross-job cache bleed)', async () => {
    const store = makeStore();
    let liveCalls = 0;
    const resolveLive = async () => {
      liveCalls += 1;
      return okScope('site_drlurie', 'req_1');
    };

    await resolveArtifactBridgeScopeForJobWithStore(store, resolveLive, 'site_drlurie', 'req_1', 'job-1');
    await resolveArtifactBridgeScopeForJobWithStore(store, resolveLive, 'site_drlurie', 'req_1', 'job-2');

    assert.strictEqual(liveCalls, 2, "a different jobId must never reuse another job's cached scope");
  });

  it('a cached entry that does not match the CALLER-supplied siteId/requestId is never trusted — falls through live', async () => {
    const store = makeStore();
    let liveCalls = 0;
    const resolveLive = async () => {
      liveCalls += 1;
      return okScope('site_drlurie', 'req_1');
    };

    await resolveArtifactBridgeScopeForJobWithStore(store, resolveLive, 'site_drlurie', 'req_1', 'job-1');
    // Same jobId, but a caller now presenting a DIFFERENT requestId — must not
    // silently inherit the previously cached scope.
    const mismatched = await resolveArtifactBridgeScopeForJobWithStore(
      store,
      resolveLive,
      'site_drlurie',
      'req_2',
      'job-1'
    );

    assert.strictEqual(liveCalls, 2, 'a scope mismatch against the cache must re-run the live resolver');
    assert.deepStrictEqual(mismatched, okScope('site_drlurie', 'req_1'));
  });

  it('a FAILED live resolve is never cached — the next poll retries live rather than replaying a stale error', async () => {
    const store = makeStore();
    let liveCalls = 0;
    const resolveLive = async () => {
      liveCalls += 1;
      return liveCalls === 1 ? errScope() : okScope('site_drlurie', 'req_1');
    };

    const first = await resolveArtifactBridgeScopeForJobWithStore(store, resolveLive, 'site_drlurie', 'req_1', 'job-1');
    const second = await resolveArtifactBridgeScopeForJobWithStore(
      store,
      resolveLive,
      'site_drlurie',
      'req_1',
      'job-1'
    );

    assert.strictEqual(first.ok, false);
    assert.strictEqual(liveCalls, 2, 'a failed resolve must not poison the cache');
    assert.strictEqual(second.ok, true);
  });

  it("the cache TTL mirrors pdf-tool's 12-minute JOB_RUNNING_TIMEOUT_MS", () => {
    assert.strictEqual(ARTIFACT_BRIDGE_SCOPE_CACHE_TTL_MS, 12 * 60_000);
  });

  it('an expired cache entry is treated as a miss and re-resolved live', async () => {
    const store = makeStore();
    let liveCalls = 0;
    const resolveLive = async () => {
      liveCalls += 1;
      return okScope('site_drlurie', 'req_1');
    };

    // Seed an already-expired entry directly (expiresAtMs in the past).
    store.blobs.set(
      'cache:artifact-bridge-scope:job-1',
      JSON.stringify({ value: { siteId: 'site_drlurie', requestId: 'req_1' }, expiresAtMs: Date.now() - 1 })
    );

    const result = await resolveArtifactBridgeScopeForJobWithStore(
      store,
      resolveLive,
      'site_drlurie',
      'req_1',
      'job-1'
    );

    assert.strictEqual(liveCalls, 1, 'an expired entry must not short-circuit the live resolve');
    assert.deepStrictEqual(result, okScope('site_drlurie', 'req_1'));
  });
});
