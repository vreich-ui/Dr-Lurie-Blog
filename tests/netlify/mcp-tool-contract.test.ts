/**
 * Descriptive contract of the MCP tool surface — the parts of a tool's
 * description and input schema that agents actually plan against.
 *
 * The `save_json_blob_*` half of this file was deleted on 2026-07-29 with the
 * legacy article pipeline (ruling OQ-W11-6). That surface's absence is pinned
 * in `mcp-legacy-tool-surface.test.ts`; what remains here are the artifact
 * tools, which are live on the object path.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { handler } from '../../netlify/functions/mcp.js';

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: {
    required?: string[];
    properties?: Record<string, unknown>;
  };
};

const listTools = async (): Promise<ToolDefinition[]> => {
  const response = await handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  const body = JSON.parse(response.body) as { result: { tools: ToolDefinition[] } };

  assert.equal(response.statusCode, 200);
  return body.result.tools;
};

const getTool = (tools: ToolDefinition[], name: string) => {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `expected tools/list to include ${name}`);
  return tool;
};

test('artifact upload tool descriptions state the accepted image formats', async () => {
  const tools = await listTools();

  for (const name of ['create_artifact_upload_intent', 'create_artifact_from_url', 'save_artifact']) {
    const tool = getTool(tools, name);
    assert.match(tool.description, /JPEG, PNG, WebP/i, `${name} must document the accepted image formats`);
  }
});

test('artifact metadata tool descriptions document soft-delete visibility', async () => {
  const tools = await listTools();

  assert.match(getTool(tools, 'list_artifacts_for_request').description, /soft-deleted artifacts are excluded/i);
  assert.match(getTool(tools, 'get_artifact_metadata').description, /deletedAtISO/);
});
