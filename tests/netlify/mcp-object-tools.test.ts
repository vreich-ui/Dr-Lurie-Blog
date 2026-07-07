import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { handler } from '../../netlify/functions/mcp.js';
import { setLocalBlobsRootForTesting } from '../../netlify/lib/local-blobs.js';

// Object-verb MCP tools (T0.9). The tools proxy to object-store.ts with the
// publish key injected; object-store falls back to the local file store when no
// NETLIFY runtime env is present, so these run end-to-end against that fallback.
for (const key of [
  'NETLIFY',
  'NETLIFY_SITE_ID',
  'NETLIFY_BLOBS_TOKEN',
  'NETLIFY_AUTH_TOKEN',
  'SITE_ID',
  'MCP_HTTP_AUTH_TOKEN',
]) {
  delete process.env[key];
}
process.env.PUBLISH_SECRET = 'test-publish-secret';

// Isolated from the default .netlify/local-blobs root: this suite and its siblings
// (object-lifecycle.e2e.test.ts, object-store-auth.test.ts) all exercise the site-objects
// local fallback store, and node:test runs separate test files concurrently, so sharing
// one on-disk directory raced resets against reads/writes across files.
const LOCAL_BLOBS_ROOT = join(process.cwd(), '.netlify', 'local-blobs-test', 'mcp-object-tools');
setLocalBlobsRootForTesting(LOCAL_BLOBS_ROOT);
const SITE_OBJECTS_DIR = join(LOCAL_BLOBS_ROOT, 'site-objects');
const reset = () => rm(SITE_OBJECTS_DIR, { recursive: true, force: true });

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: { required?: string[]; properties?: Record<string, unknown> };
};
type ToolCallResult = { isError?: boolean; structuredContent?: Record<string, unknown> };

const rpc = async (method: string, params?: Record<string, unknown>) => {
  const response = await handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }),
  });
  assert.equal(response.statusCode, 200);
  return JSON.parse(response.body) as { result: Record<string, unknown> };
};

const listTools = async (): Promise<ToolDefinition[]> => {
  const body = await rpc('tools/list');
  return (body.result as { tools: ToolDefinition[] }).tools;
};

const getTool = (tools: ToolDefinition[], name: string) => {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `expected tools/list to include ${name}`);
  return tool;
};

const callTool = async (name: string, args: Record<string, unknown>): Promise<ToolCallResult> => {
  const body = await rpc('tools/call', { name, arguments: args });
  return body.result as ToolCallResult;
};

const OBJECT_TOOLS = [
  'object_get',
  'object_list',
  'object_create',
  'object_checkout',
  'object_refresh_lock',
  'object_checkin',
  'object_patch',
  'object_validate',
  'object_inventory',
  'object_submit_review',
  'object_review_decide',
  'object_discard',
  'object_publish',
];

const validPageBody = () => ({
  route: '/',
  pageType: 'home',
  title: 'Dr. Lurié',
  seo: { description: 'Science-first skincare.' },
  sections: [{ id: 's_hero', type: 'hero', data: { heading: 'Hi', actions: [] } }],
});

// ═══ tools/list ══════════════════════════════════════════════════════════════

test('tools/list includes every object verb tool and registry_get', async () => {
  const tools = await listTools();
  for (const name of [...OBJECT_TOOLS, 'registry_get']) getTool(tools, name);
});

test('tools/list still includes the existing article tools (nothing removed)', async () => {
  const tools = await listTools();
  for (const name of ['save_json_blob_create_request', 'save_json_blob_publish_by_time', 'ping']) getTool(tools, name);
});

test('object tool input schemas declare the right required fields', async () => {
  const tools = await listTools();
  assert.deepEqual(getTool(tools, 'object_get').inputSchema.required, ['object_type', 'object_id']);
  assert.deepEqual(getTool(tools, 'object_create').inputSchema.required, ['object_type', 'site', 'body']);
  assert.deepEqual(getTool(tools, 'object_patch').inputSchema.required, [
    'object_type',
    'object_id',
    'lock_token',
    'expected_record_version',
    'ops',
  ]);
  // object_type is a closed enum of the seven object types.
  const enumValues = (getTool(tools, 'object_get').inputSchema.properties?.object_type as { enum?: string[] }).enum;
  assert.ok(enumValues?.includes('page') && enumValues?.includes('taxonomy'));
});

// ═══ registry_get stub ═══════════════════════════════════════════════════════

test('registry_get returns the not_yet_populated stub for the component registry', async () => {
  const res = await callTool('registry_get', { registry: 'component' });
  assert.ok(!res.isError);
  assert.equal(res.structuredContent?.status, 'not_yet_populated');
  assert.equal(res.structuredContent?.available, false);
  assert.deepEqual(res.structuredContent?.definitions, []);
});

test("registry_get('page_type') serves the T3.1 definitions with the JSON-schema rendering", async () => {
  const res = await callTool('registry_get', { registry: 'page_type' });
  assert.ok(!res.isError);
  assert.equal(res.structuredContent?.status, 'ok');
  assert.equal(res.structuredContent?.available, true);
  const definitions = res.structuredContent?.definitions as Array<{ id: string; reviewPolicy: { required: boolean } }>;
  assert.deepEqual(
    definitions.map((definition) => definition.id),
    ['home', 'standard', 'system']
  );
  assert.ok(definitions.every((definition) => definition.reviewPolicy.required === true));
  assert.deepEqual(res.structuredContent?.not_yet_implemented, ['listing', 'content_detail']);
  const schema = res.structuredContent?.definition_schema as { type?: string };
  assert.equal(schema.type, 'object');
});

// ═══ end-to-end proxy: create → get, and conflict surfacing ══════════════════

test('object_create then object_get round-trips through the proxy to object-store', async () => {
  await reset();
  const created = await callTool('object_create', {
    object_type: 'page',
    site: 'site_drlurie',
    body: validPageBody(),
    requested_id: 'page_home',
    agent_name: 'mcp-smoke',
  });
  assert.ok(!created.isError, JSON.stringify(created.structuredContent));
  const record = created.structuredContent?.record as {
    object_id: string;
    history: { actor: { agent_name?: string } }[];
  };
  assert.equal(record.object_id, 'page_home');
  assert.equal(record.history[0].actor.agent_name, 'mcp-smoke');

  const got = await callTool('object_get', { object_type: 'page', object_id: 'page_home' });
  assert.ok(!got.isError);
  assert.equal((got.structuredContent?.record as { object_id: string }).object_id, 'page_home');
});

test('object_inventory proxies both the sweep and the single-object detail view', async () => {
  await reset();
  await callTool('object_create', {
    object_type: 'page',
    site: 'site_drlurie',
    body: validPageBody(),
    requested_id: 'page_home',
  });

  const sweep = await callTool('object_inventory', {});
  assert.ok(!sweep.isError, JSON.stringify(sweep.structuredContent));
  const rows = sweep.structuredContent?.objects as Array<{
    object_id: string;
    requires_approval: boolean;
    unpublished_changes: boolean;
  }>;
  assert.deepEqual(
    rows.map((row) => [row.object_id, row.requires_approval, row.unpublished_changes]),
    [['page_home', false, true]]
  );

  const detail = await callTool('object_inventory', { object_type: 'page', object_id: 'page_home' });
  assert.ok(!detail.isError, JSON.stringify(detail.structuredContent));
  const object = detail.structuredContent?.object as { site: string; history_length: number };
  assert.equal(object.site, 'site_drlurie');
  assert.equal(object.history_length, 1);
});

test('a not-found get surfaces as a tool error carrying the 404 status', async () => {
  await reset();
  const res = await callTool('object_get', { object_type: 'page', object_id: 'page_ghost' });
  assert.equal(res.isError, true);
  assert.equal(res.structuredContent?.statusCode, 404);
});

test('object_patch without a held lock surfaces the 423 conflict code', async () => {
  await reset();
  await callTool('object_create', {
    object_type: 'page',
    site: 'site_drlurie',
    body: validPageBody(),
    requested_id: 'page_home',
  });
  const res = await callTool('object_patch', {
    object_type: 'page',
    object_id: 'page_home',
    lock_token: 'not-held',
    expected_record_version: 1,
    ops: [{ op: 'update_section_data', section_id: 's_hero', fields: { heading: 'x' } }],
  });
  assert.equal(res.isError, true);
  assert.equal(res.structuredContent?.statusCode, 423);
});

// ═══ P1 review + publish verbs ═══════════════════════════════════════════════

test('the P1 review + publish tools declare the right required fields', async () => {
  const tools = await listTools();
  assert.deepEqual(getTool(tools, 'object_submit_review').inputSchema.required, [
    'object_type',
    'object_id',
    'lock_token',
  ]);
  assert.deepEqual(getTool(tools, 'object_review_decide').inputSchema.required, [
    'object_type',
    'object_id',
    'decision',
  ]);
  assert.deepEqual(getTool(tools, 'object_discard').inputSchema.required, [
    'object_type',
    'object_id',
    'lock_token',
    'entries',
  ]);
  assert.deepEqual(getTool(tools, 'object_publish').inputSchema.required, ['object_type', 'object_id', 'lock_token']);
  // object_review_decide exposes the closed approve | request_changes enum.
  const decision = getTool(tools, 'object_review_decide').inputSchema.properties?.decision as { enum?: string[] };
  assert.deepEqual(decision.enum, ['approve', 'request_changes']);
});

test('object_publish documents the deferred-deploy model ([skip netlify], explicit release)', async () => {
  const tools = await listTools();
  const description = getTool(tools, 'object_publish').description;
  assert.match(description, /\[skip netlify\]/i);
  assert.match(description, /release_to_production/);
});

test('object_submit_review under a held lock opens a review through the proxy', async () => {
  await reset();
  await callTool('object_create', {
    object_type: 'page',
    site: 'site_drlurie',
    body: validPageBody(),
    requested_id: 'page_home',
  });
  const checkout = await callTool('object_checkout', { object_type: 'page', object_id: 'page_home' });
  assert.ok(!checkout.isError, JSON.stringify(checkout.structuredContent));
  const lockToken = checkout.structuredContent?.lockToken as string;

  const submitted = await callTool('object_submit_review', {
    object_type: 'page',
    object_id: 'page_home',
    lock_token: lockToken,
    note: 'ready for review',
    requested_publish_action: { published_time: 'immediate' },
  });
  assert.ok(!submitted.isError, JSON.stringify(submitted.structuredContent));
  assert.equal(submitted.structuredContent?.review_state, 'open');
});

test('object_review_decide is refused for the agent principal (human-only rule preserved)', async () => {
  await reset();
  await callTool('object_create', {
    object_type: 'page',
    site: 'site_drlurie',
    body: validPageBody(),
    requested_id: 'page_home',
  });
  const decided = await callTool('object_review_decide', {
    object_type: 'page',
    object_id: 'page_home',
    decision: 'approve',
  });
  assert.equal(decided.isError, true);
  assert.equal(decided.structuredContent?.statusCode, 403);
  assert.equal(decided.structuredContent?.code, 'human_only');
});

test('object_publish enforces the held lock through the publish operation (423 without one)', async () => {
  await reset();
  await callTool('object_create', {
    object_type: 'page',
    site: 'site_drlurie',
    body: validPageBody(),
    requested_id: 'page_home',
  });
  const res = await callTool('object_publish', {
    object_type: 'page',
    object_id: 'page_home',
    lock_token: 'not-held',
  });
  assert.equal(res.isError, true);
  assert.equal(res.structuredContent?.statusCode, 423);
  assert.equal(res.structuredContent?.code, 'lock_required');
});

// ═══ credential isolation: the proxy needs the publish key ═══════════════════

test('object tools report a clear error when the publish key is not configured', async () => {
  const saved = process.env.PUBLISH_SECRET;
  delete process.env.PUBLISH_SECRET;
  try {
    const res = await callTool('object_get', { object_type: 'page', object_id: 'page_home' });
    assert.equal(res.isError, true);
    assert.match(String(res.structuredContent?.error), /credentials are not configured/i);
  } finally {
    process.env.PUBLISH_SECRET = saved;
  }
});
