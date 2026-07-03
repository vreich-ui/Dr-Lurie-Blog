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

const callTool = async (name: string, args: Record<string, unknown>) => {
  const response = await handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = JSON.parse(response.body) as {
    result: { isError?: boolean; structuredContent?: Record<string, unknown> };
  };

  assert.equal(response.statusCode, 200);
  return body.result;
};

test('create_request and create_article_draft input schemas require request_id', async () => {
  const tools = await listTools();

  for (const name of ['save_json_blob_create_request', 'save_json_blob_create_article_draft']) {
    const tool = getTool(tools, name);
    assert.ok(
      tool.inputSchema.required?.includes('request_id'),
      `${name} must declare request_id as required; got ${JSON.stringify(tool.inputSchema.required)}`
    );
  }
});

test('article body media schema matches the zod contract: document type plus title/contentType fields', async () => {
  const tools = await listTools();
  const tool = getTool(tools, 'save_json_blob_create_article_draft');

  const inputProps = tool.inputSchema.properties as Record<string, { properties?: Record<string, unknown> }>;
  const contentProps = (inputProps.input?.properties?.content ?? {}) as { properties?: Record<string, unknown> };
  const articleBody = (contentProps.properties?.article_body ?? {}) as { properties?: Record<string, unknown> };
  const nodes = (articleBody.properties?.nodes ?? {}) as { items?: { properties?: Record<string, unknown> } };
  const nodePublic = (nodes.items?.properties?.public ?? {}) as { properties?: Record<string, unknown> };
  const media = (nodePublic.properties?.media ?? {}) as { properties?: Record<string, unknown> };
  const mediaType = (media.properties?.type ?? {}) as { enum?: string[] };

  assert.ok(
    mediaType.enum?.includes('document'),
    `media.type enum must include "document" (zod allows it); got ${JSON.stringify(mediaType.enum)}`
  );
  assert.ok(media.properties?.title, 'media schema must expose the title field the zod schema accepts');
  assert.ok(media.properties?.contentType, 'media schema must expose the contentType field the zod schema accepts');
});

test('create_request without request_id returns a specific error instead of auto-generating an invalid id', async () => {
  for (const name of ['save_json_blob_create_request', 'save_json_blob_create_article_draft']) {
    const result = await callTool(name, {
      input: { record_type: 'content_source', schema_version: 'content_source.v1' },
      validation_mode: 'admin_publish_draft',
    });

    assert.equal(result.isError, true, `${name} without request_id must be a tool error`);
    assert.equal(
      result.structuredContent?.error_code,
      'missing_request_id',
      `${name} must fail with missing_request_id, not a generated req_<uuid> rejection: ${JSON.stringify(result.structuredContent)}`
    );
    assert.match(String(result.structuredContent?.error), /not auto-generated/i);
    assert.match(String(result.structuredContent?.error), /req_<flow>_<topic>_<yyyymmdd>_<nn>/);
  }
});

test('publish_by_time description states that future timestamps also commit the article file', async () => {
  const tools = await listTools();
  const tool = getTool(tools, 'save_json_blob_publish_by_time');

  assert.doesNotMatch(
    tool.description,
    /future timestamps save only/i,
    'the "future timestamps save only" wording is wrong — future publishes also run the publisher and commit'
  );
  assert.match(tool.description, /FUTURE timestamp.*commits the article file/is);
  assert.match(tool.description, /null unpublishes/i);
});

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

test('node media src and patch_canonical_input descriptions name the unified trust sources', async () => {
  const tools = await listTools();
  const patchTool = getTool(tools, 'save_json_blob_patch_canonical_input');

  assert.match(
    patchTool.description,
    /uploaded for THIS request \(visible via list_artifacts_for_request\) or already saved in agent_outputs/,
    'patch_canonical_input must describe the post-PR-#327 unified trust set, not agent_outputs alone'
  );
});
