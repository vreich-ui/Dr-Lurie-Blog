/**
 * W11 T11.10 — the verified per-agent bearer-token path through the MCP
 * HTTP auth gate (netlify/functions/mcp.ts's getAuthResult/callTool). Runs
 * against the REAL handler + a real (isolated, scratch-rooted) local-blob-
 * backed governance store — the commerce-s3.test.ts pattern — so this is a
 * genuine end-to-end proof, not a mock of the auth layer.
 *
 * The pure resolution logic (revoked-fails-closed, per-site scoping,
 * forged-token-never-verifies) already has its own exhaustive proof in
 * packages/core/server/lib/agent-keys.test.ts; this file proves the HTTP
 * WIRING around it: a verified token satisfies the auth gate on its own
 * (even against the WRONG shared secret), a revoked one does not, and the
 * verified identity overrides self-declared agent_name for a CMS
 * attribution tool but NEVER for a workflow-stage tool (the
 * save_json_blob_mark_agent_complete carve-out).
 */
import '../../sites/drlurie/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { setLocalBlobsRootForTesting, createLocalBlobStore } from '../../packages/core/server/lib/local-blobs.js';

const LOCAL_BLOBS_ROOT = join(process.cwd(), '.netlify', 'local-blobs-test', 'mcp-agent-keys-auth');
setLocalBlobsRootForTesting(LOCAL_BLOBS_ROOT);
for (const key of ['NETLIFY', 'NETLIFY_SITE_ID', 'NETLIFY_BLOBS_TOKEN', 'NETLIFY_AUTH_TOKEN', 'SITE_ID']) {
  delete process.env[key];
}
// object_create needs the object-store proxy's own internal shared secret
// (separate from MCP_HTTP_AUTH_TOKEN, the outer gate this file is about).
process.env.PUBLISH_SECRET = 'test-publish-secret';

const { AGENT_KEYS_DOC_KEY, createAgentKey, emptyAgentKeysDoc, revokeAgentKey } = await import(
  '../../packages/core/server/lib/agent-keys.js'
);
const { handler } = await import('../../netlify/functions/mcp.js');

type RpcBody = {
  result?: Record<string, unknown>;
  error?: { data?: { reason?: string } };
};

const NOW = '2026-07-24T00:00:00.000Z';
const previousMcpHttpAuthToken = process.env.MCP_HTTP_AUTH_TOKEN;

test.afterEach(() => {
  if (previousMcpHttpAuthToken === undefined) delete process.env.MCP_HTTP_AUTH_TOKEN;
  else process.env.MCP_HTTP_AUTH_TOKEN = previousMcpHttpAuthToken;
});

test.after(async () => {
  await rm(LOCAL_BLOBS_ROOT, { recursive: true, force: true });
});

const seedAgentKey = async (agentName: string, site: string) => {
  const store = createLocalBlobStore('governance');
  const empty = emptyAgentKeysDoc('test-setup', NOW);
  const { doc, token } = createAgentKey(empty, { agent_name: agentName, site, created_by: 'test-setup', now: NOW });
  await store.setJSON(AGENT_KEYS_DOC_KEY, doc);
  return { token, doc };
};

const mcpRequest = async (method: string, headers: Record<string, string> = {}, params?: Record<string, unknown>) => {
  const response = await handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }),
  });
  return { response, body: JSON.parse(response.body) as RpcBody };
};

test('a verified agent bearer token satisfies the auth gate even against the WRONG shared secret', async () => {
  process.env.MCP_HTTP_AUTH_TOKEN = 'the-real-shared-secret';
  const { token } = await seedAgentKey('draft-agent', 'site_drlurie');

  const { response, body } = await mcpRequest('initialize', { authorization: `Bearer ${token}` });
  assert.equal(response.statusCode, 200);
  assert.equal((body.result?.serverInfo as { name?: string } | undefined)?.name, 'Dr_Lurie_MCP_Server');
});

test('a revoked agent token fails closed (falls through to the shared-secret gate, which then also rejects it)', async () => {
  process.env.MCP_HTTP_AUTH_TOKEN = 'the-real-shared-secret';
  const store = createLocalBlobStore('governance');
  const empty = emptyAgentKeysDoc('test-setup', NOW);
  const minted = createAgentKey(empty, {
    agent_name: 'draft-agent',
    site: 'site_drlurie',
    created_by: 'test-setup',
    now: NOW,
  });
  const revokedDoc = revokeAgentKey(minted.doc, {
    agent_name: 'draft-agent',
    site: 'site_drlurie',
    revoked_by: 'test-setup',
    now: NOW,
  });
  await store.setJSON(AGENT_KEYS_DOC_KEY, revokedDoc);

  const { response, body } = await mcpRequest('initialize', { authorization: `Bearer ${minted.token}` });
  assert.equal(response.statusCode, 401);
  assert.equal(body.error?.data?.reason, 'mcp_auth_invalid_authorization');
});

test('a forged/unknown bearer token never verifies — falls through, still rejected without the real shared secret', async () => {
  process.env.MCP_HTTP_AUTH_TOKEN = 'the-real-shared-secret';
  await seedAgentKey('draft-agent', 'site_drlurie'); // a real key exists, but this token is not it

  const { response, body } = await mcpRequest('initialize', { authorization: 'Bearer totally-made-up' });
  assert.equal(response.statusCode, 401);
  assert.equal(body.error?.data?.reason, 'mcp_auth_invalid_authorization');
});

test('a key scoped to a different site never grants access here (no cross-binding leakage)', async () => {
  process.env.MCP_HTTP_AUTH_TOKEN = 'the-real-shared-secret';
  const { token } = await seedAgentKey('draft-agent', 'site_some_other_client');

  const { response, body } = await mcpRequest('initialize', { authorization: `Bearer ${token}` });
  assert.equal(response.statusCode, 401);
  assert.equal(body.error?.data?.reason, 'mcp_auth_invalid_authorization');
});

test('does not touch (and does not break) a plain unauthenticated dev-mode request when no key is seeded', async () => {
  delete process.env.MCP_HTTP_AUTH_TOKEN;
  const { response } = await mcpRequest('initialize');
  assert.equal(response.statusCode, 200);
});

const validPageBody = () => ({
  route: '/verified-agent-test',
  pageType: 'standard',
  title: 'Verified agent attribution test',
  seo: { description: 'x' },
  sections: [{ id: 's_hero', type: 'hero', data: { heading: 'Hi', actions: [] } }],
});

test('a verified token overrides a forged agent_name on a CMS attribution tool (object_create)', async () => {
  delete process.env.MCP_HTTP_AUTH_TOKEN; // isolate this test to the attribution behavior, not the outer gate
  const siteObjectsDir = join(LOCAL_BLOBS_ROOT, 'site-objects');
  await rm(siteObjectsDir, { recursive: true, force: true });
  const { token } = await seedAgentKey('verified-drafter', 'site_drlurie');

  const { response, body } = await mcpRequest(
    'tools/call',
    { authorization: `Bearer ${token}` },
    {
      name: 'object_create',
      arguments: {
        object_type: 'page',
        site: 'site_drlurie',
        body: validPageBody(),
        agent_name: 'someone-forged-this-name',
      },
    }
  );
  assert.equal(response.statusCode, 200);
  const structuredContent = (
    body.result as { structuredContent?: { record?: { history: { actor: { agent_name?: string } }[] } } }
  ).structuredContent;
  const actorName = structuredContent?.record?.history?.[0]?.actor?.agent_name;
  assert.equal(actorName, 'verified-drafter', 'the VERIFIED identity must win, not the forged self-declared one');
});

test('a verified token does NOT override agent_name on a workflow-stage tool (save_json_blob_mark_agent_complete stays enum-validated)', async () => {
  delete process.env.MCP_HTTP_AUTH_TOKEN;
  const { token } = await seedAgentKey('verified-drafter', 'site_drlurie');

  // 'verified-drafter' is not a member of the workflow-stage agent_name enum
  // (allowedAgentNames) — if the override wrongly applied here, this call
  // would 400 on an invalid agent_name instead of on its actually-missing
  // required fields, proving the carve-out held.
  const { response, body } = await mcpRequest(
    'tools/call',
    { authorization: `Bearer ${token}` },
    { name: 'save_json_blob_mark_agent_complete', arguments: { agent_name: 'research' } }
  );
  assert.equal(response.statusCode, 200);
  const result = body.result as { isError?: boolean; content?: { text?: string }[] };
  // Whatever this call's outcome (it will fail for lack of a real request_id
  // — unrelated to this test), the failure must NOT be an invalid-agent_name
  // rejection of 'research' (the legitimate self-declared stage name).
  const text = result.content?.[0]?.text ?? '';
  assert.doesNotMatch(text, /invalid.*agent_name|agent_name.*invalid/i);
});
