/**
 * perf/drop-verify-hop-cache-scope, Change 3 — the module-scope, 60s-TTL,
 * hashed-token memo in front of the per-agent bearer-token lookup
 * (mcp.ts's resolveVerifiedAgentNameForRequest / getAgentKeysDoc).
 *
 * Runs against the REAL handler + a real (isolated, scratch-rooted)
 * local-blob-backed governance store, exactly like
 * mcp-agent-keys-auth.test.ts, plus the exported `_mcpInternal` memo
 * internals so a test can inspect (and, for the TTL case, directly force
 * the expiry of) a cache entry without needing fake system-clock timers.
 *
 * The OAuth principal path is deliberately NOT covered here: it is
 * deliberately NOT memoized (see the Change-3 comment in mcp.ts) because
 * mcp-oauth.test.ts already has a hard "revocation must take effect on the
 * next request, with no cache to wait out" requirement a positive memo on
 * that path would break.
 */
import '../../sites/drlurie/config/policy-bindings.js';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { setLocalBlobsRootForTesting, createLocalBlobStore } from '../../packages/core/server/lib/local-blobs.js';

const LOCAL_BLOBS_ROOT = join(process.cwd(), '.netlify', 'local-blobs-test', 'mcp-auth-memo');
setLocalBlobsRootForTesting(LOCAL_BLOBS_ROOT);
for (const key of ['NETLIFY', 'NETLIFY_SITE_ID', 'NETLIFY_BLOBS_TOKEN', 'NETLIFY_AUTH_TOKEN', 'SITE_ID']) {
  delete process.env[key];
}
const { AGENT_KEYS_DOC_KEY, createAgentKey, emptyAgentKeysDoc, revokeAgentKey } = await import(
  '../../packages/core/server/lib/agent-keys.js'
);
const { handler, _mcpInternal } = await import('../../netlify/functions/mcp.js');

const NOW = '2026-08-06T00:00:00.000Z';

// A real shared secret must be configured so an invalid/unknown/revoked
// bearer token is actually REJECTED by the gate — with MCP_HTTP_AUTH_TOKEN
// unset this repo's dev-mode fallback opens the gate for everyone (see
// mcp-agent-keys-auth.test.ts's "does not touch a plain unauthenticated
// dev-mode request"), which would make every "rejected" assertion below
// pass for the wrong reason.
process.env.MCP_HTTP_AUTH_TOKEN = 'the-real-shared-secret';

test.beforeEach(() => {
  _mcpInternal.resetAuthMemoForTesting();
});
test.after(async () => {
  await rm(LOCAL_BLOBS_ROOT, { recursive: true, force: true });
});

const seedAgentKey = async (agentName: string) => {
  const store = createLocalBlobStore('governance');
  const empty = emptyAgentKeysDoc('test-setup', NOW);
  const { doc, token } = createAgentKey(empty, {
    agent_name: agentName,
    site: 'site_drlurie',
    created_by: 'test-setup',
    now: NOW,
  });
  await store.setJSON(AGENT_KEYS_DOC_KEY, doc);
  return { token, doc };
};

const revokeSeededKey = async (agentName: string, doc: Awaited<ReturnType<typeof seedAgentKey>>['doc']) => {
  const store = createLocalBlobStore('governance');
  const revoked = revokeAgentKey(doc, {
    agent_name: agentName,
    site: 'site_drlurie',
    revoked_by: 'test-setup',
    now: NOW,
  });
  await store.setJSON(AGENT_KEYS_DOC_KEY, revoked);
};

const initializeWithToken = async (token: string) =>
  handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
  });

test('an invalid/unknown token is rejected immediately and is never written to the memo', async () => {
  const first = await initializeWithToken('totally-made-up-token');
  const second = await initializeWithToken('totally-made-up-token');

  assert.equal(first.statusCode, 401);
  assert.equal(second.statusCode, 401);
  assert.equal(_mcpInternal.verifiedAgentNameMemo.size, 0, 'a negative resolution must never be memoized');
});

test('a revoked token is rejected immediately and is never written to the memo', async () => {
  const { token, doc } = await seedAgentKey('never-cached-agent');
  await revokeSeededKey('never-cached-agent', doc);

  const first = await initializeWithToken(token);
  const second = await initializeWithToken(token);

  assert.equal(first.statusCode, 401);
  assert.equal(second.statusCode, 401);
  assert.equal(
    _mcpInternal.verifiedAgentNameMemo.size,
    0,
    'a revoked token must never be served from (or added to) the memo'
  );
});

test('a valid token is memoized on success — a subsequent request within the TTL is served from the memo', async () => {
  const { token, doc } = await seedAgentKey('cached-agent');

  const first = await initializeWithToken(token);
  assert.equal(first.statusCode, 200);
  assert.equal(_mcpInternal.verifiedAgentNameMemo.size, 1, 'a successful resolution must be memoized');

  const tokenKey = _mcpInternal.hashAuthToken(token);
  const entry = _mcpInternal.verifiedAgentNameMemo.get(tokenKey);
  assert.equal(entry?.value, 'cached-agent');
  const remainingTtlMs = (entry?.expiresAtMs ?? 0) - Date.now();
  assert.ok(
    remainingTtlMs > 0 && remainingTtlMs <= _mcpInternal.AUTH_MEMO_TTL_MS,
    `expected a fresh ${_mcpInternal.AUTH_MEMO_TTL_MS}ms TTL, got ${remainingTtlMs}ms remaining`
  );

  // Revoke the key server-side — with no cache, the very next request would
  // see this immediately (mcp-agent-keys-auth.test.ts already proves the
  // fails-closed live path). Within the TTL, the memoized positive result is
  // reused instead: the deliberate perf/staleness trade-off the spec asked
  // for on this path (unlike OAuth's revoke-is-immediate contract).
  await revokeSeededKey('cached-agent', doc);
  const second = await initializeWithToken(token);
  assert.equal(second.statusCode, 200, 'a cache HIT within the TTL must not re-check the (now revoked) store');
});

test('the auth memo expires after 60s — an expired entry forces a live re-check', async () => {
  const { token, doc } = await seedAgentKey('expiring-agent');

  const first = await initializeWithToken(token);
  assert.equal(first.statusCode, 200);
  assert.equal(_mcpInternal.verifiedAgentNameMemo.size, 1);

  // Force the cached entry to have already expired, exactly as if 60s had
  // elapsed since it was written — this avoids a flaky real-time sleep while
  // still exercising the real expiry check (readAuthMemo compares
  // expiresAtMs against the current clock and deletes a stale entry).
  const tokenKey = _mcpInternal.hashAuthToken(token);
  const entry = _mcpInternal.verifiedAgentNameMemo.get(tokenKey);
  assert.ok(entry, 'the entry must exist before it can be force-expired');
  _mcpInternal.verifiedAgentNameMemo.set(tokenKey, { ...entry!, expiresAtMs: Date.now() - 1 });

  // Revoke so a LIVE re-check (forced by the now-expired entry) is
  // observable: only an expired memo would ever see this.
  await revokeSeededKey('expiring-agent', doc);
  const afterExpiry = await initializeWithToken(token);
  assert.equal(
    afterExpiry.statusCode,
    401,
    'an expired memo entry must trigger a live re-check, which must see the revocation'
  );
  assert.equal(
    _mcpInternal.verifiedAgentNameMemo.size,
    0,
    'the expired entry must be evicted, and the negative re-check must not be re-cached'
  );
});
