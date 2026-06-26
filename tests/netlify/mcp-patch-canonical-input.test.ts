import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { handler as mcpHandler, _mcpInternal } from '../../netlify/functions/mcp.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PUBLISH_SECRET = 'test-publish-secret-patch-ci';
const MCP_TOKEN = 'test-mcp-token-patch-ci';

const mcpPost = async (body: unknown) => {
  const resp = await mcpHandler({
    httpMethod: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-mcp-auth-token': MCP_TOKEN,
    },
    body: JSON.stringify(body),
  });
  return { resp, rpc: JSON.parse(resp.body) as Record<string, unknown> };
};

const toolsListCall = () =>
  mcpPost({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

const toolCallRpc = (name: string, args: Record<string, unknown>) =>
  mcpPost({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

describe('save_json_blob_patch_canonical_input MCP tool registration', () => {
  const originalPublishSecret = process.env.NETLIFY_PUBLISH_SECRET;
  const originalMcpToken = process.env.MCP_HTTP_AUTH_TOKEN;

  process.env.NETLIFY_PUBLISH_SECRET = PUBLISH_SECRET;
  process.env.MCP_HTTP_AUTH_TOKEN = MCP_TOKEN;

  it('is listed in tools/list', async () => {
    const { rpc } = await toolsListCall();
    const tools = (rpc.result as { tools?: { name: string }[] } | undefined)?.tools ?? [];
    const tool = tools.find((t) => t.name === 'save_json_blob_patch_canonical_input');
    assert.ok(tool, 'save_json_blob_patch_canonical_input must appear in tools/list');
  });

  it('input schema requires request_id, lock_token, expected_record_version', async () => {
    const { rpc } = await toolsListCall();
    const tools = (rpc.result as { tools?: { name: string; inputSchema: Record<string, unknown> }[] } | undefined)?.tools ?? [];
    const tool = tools.find((t) => t.name === 'save_json_blob_patch_canonical_input');
    assert.ok(tool, 'tool must be present');

    const required = (tool.inputSchema as { required?: string[] } | undefined)?.required ?? [];
    assert.ok(required.includes('request_id'), 'request_id must be required');
    assert.ok(required.includes('lock_token'), 'lock_token must be required');
    assert.ok(required.includes('expected_record_version'), 'expected_record_version must be required');
  });

  it('input schema includes optional repair fields', async () => {
    const { rpc } = await toolsListCall();
    const tools = (rpc.result as { tools?: { name: string; inputSchema: Record<string, unknown> }[] } | undefined)?.tools ?? [];
    const tool = tools.find((t) => t.name === 'save_json_blob_patch_canonical_input');
    assert.ok(tool, 'tool must be present');

    const props = Object.keys(
      (tool.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {}
    );
    for (const field of [
      'node_patches',
      'replace_image_asset_register',
      'promote_publish_payload',
      'repair_workflow_status',
      'clear_last_error',
      'clear_failed_agents',
      'reset_needs_review',
    ]) {
      assert.ok(props.includes(field), `${field} must be in input schema properties`);
    }

    // Confirm required only contains the three mandatory fields
    const required = (tool.inputSchema as { required?: string[] } | undefined)?.required ?? [];
    assert.equal(required.length, 3, 'exactly 3 required fields');

    // Restore env after this describe block
    process.env.NETLIFY_PUBLISH_SECRET = originalPublishSecret;
    process.env.MCP_HTTP_AUTH_TOKEN = originalMcpToken;
  });
});

// ---------------------------------------------------------------------------
// Tool forwarding
// ---------------------------------------------------------------------------

describe('save_json_blob_patch_canonical_input MCP tool forwarding', () => {
  it('forwards all repair arguments to the patch_canonical_input backend action', async () => {
    const savedEnvPublish = process.env.NETLIFY_PUBLISH_SECRET;
    const savedEnvToken = process.env.MCP_HTTP_AUTH_TOKEN;
    process.env.NETLIFY_PUBLISH_SECRET = PUBLISH_SECRET;
    process.env.MCP_HTTP_AUTH_TOKEN = MCP_TOKEN;

    let capturedPayload: Record<string, unknown> | undefined;

    mock.method(_mcpInternal, 'saveJsonBlobHandler', async (event: Record<string, unknown>) => {
      capturedPayload = JSON.parse(event.body as string) as Record<string, unknown>;
      return {
        statusCode: 200,
        body: JSON.stringify({ action: 'patch_canonical_input', record: { version: 2, workflow_status: 'pending' } }),
      };
    });

    try {
      const args = {
        request_id: 'req_test_patch_ci_fwd',
        lock_token: 'lock_fwd_token',
        expected_record_version: 3,
        repair_workflow_status: 'pending',
        clear_last_error: true,
        clear_failed_agents: true,
        reset_needs_review: true,
        node_patches: [{ node_id: 'n_r1a2b3', public_media_src: null }],
      };

      const { rpc } = await toolCallRpc('save_json_blob_patch_canonical_input', args);

      assert.ok(!rpc.error, `unexpected RPC error: ${JSON.stringify(rpc.error)}`);
      assert.ok(capturedPayload, 'saveJsonBlobHandler must have been called');
      assert.equal(capturedPayload.action, 'patch_canonical_input', 'action must be forwarded');
      assert.equal(capturedPayload.request_id, 'req_test_patch_ci_fwd');
      assert.equal(capturedPayload.lock_token, 'lock_fwd_token');
      assert.equal(capturedPayload.expected_record_version, 3);
      assert.equal(capturedPayload.repair_workflow_status, 'pending');
      assert.equal(capturedPayload.clear_last_error, true);
      assert.equal(capturedPayload.clear_failed_agents, true);
      assert.equal(capturedPayload.reset_needs_review, true);
      assert.ok(Array.isArray(capturedPayload.node_patches), 'node_patches must be forwarded');
    } finally {
      mock.restoreAll();
      process.env.NETLIFY_PUBLISH_SECRET = savedEnvPublish;
      process.env.MCP_HTTP_AUTH_TOKEN = savedEnvToken;
    }
  });

  it('returns toolError when backend responds with an error status', async () => {
    const savedEnvPublish = process.env.NETLIFY_PUBLISH_SECRET;
    const savedEnvToken = process.env.MCP_HTTP_AUTH_TOKEN;
    process.env.NETLIFY_PUBLISH_SECRET = PUBLISH_SECRET;
    process.env.MCP_HTTP_AUTH_TOKEN = MCP_TOKEN;

    mock.method(_mcpInternal, 'saveJsonBlobHandler', async () => ({
      statusCode: 423,
      body: JSON.stringify({ action: 'patch_canonical_input', error: 'lock required' }),
    }));

    try {
      const { rpc } = await toolCallRpc('save_json_blob_patch_canonical_input', {
        request_id: 'req_test_locked',
        lock_token: 'bad_token',
        expected_record_version: 0,
        repair_workflow_status: 'pending',
      });

      // MCP tools/call returns result even for errors; isError is in structuredContent
      const result = rpc.result as { content?: { text: string }[]; isError?: boolean } | undefined;
      assert.ok(result?.isError === true, 'isError must be true for backend error');
    } finally {
      mock.restoreAll();
      process.env.NETLIFY_PUBLISH_SECRET = savedEnvPublish;
      process.env.MCP_HTTP_AUTH_TOKEN = savedEnvToken;
    }
  });
});
