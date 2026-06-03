import assert from 'node:assert/strict';
import test from 'node:test';

import { handler } from '../../netlify/functions/mcp.js';

const listTools = async () => {
  const response = await handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });

  assert.equal(response.statusCode, 200);

  return JSON.parse(response.body) as {
    result: { tools: Array<{ name: string; inputSchema: Record<string, unknown> }> };
  };
};

const property = (schema: Record<string, unknown>, key: string) => {
  const properties = schema.properties as Record<string, unknown>;

  return properties[key] as Record<string, unknown>;
};

test('save_json_blob_create_request exposes structured content_source.v1 input schema', async () => {
  const body = await listTools();
  const createTool = body.result.tools.find((tool) => tool.name === 'save_json_blob_create_request');

  assert.ok(createTool);

  const inputSchema = property(createTool.inputSchema, 'input');
  const inputProperties = inputSchema.properties as Record<string, unknown>;

  assert.equal(inputSchema.type, 'object');
  assert.equal(inputSchema.additionalProperties, false);
  assert.deepEqual(inputSchema.required, ['record_type', 'schema_version']);
  assert.equal((inputProperties.record_type as Record<string, unknown>).const, 'content_source');
  assert.equal((inputProperties.schema_version as Record<string, unknown>).const, 'content_source.v1');

  for (const section of [
    'ids',
    'publication_context',
    'content',
    'taxonomy',
    'seo',
    'media',
    'editorial',
    'sources',
    'claims',
    'compliance',
    'commercial',
    'approvals',
    'publication',
    'workflow',
    'revision_control',
    'versioning',
  ]) {
    assert.ok(inputProperties[section], `Expected ${section} in content_source.v1 MCP schema.`);
  }
});

test('content_source.v1 MCP schema describes high-value agent fields and controlled extensions', async () => {
  const body = await listTools();
  const createTool = body.result.tools.find((tool) => tool.name === 'save_json_blob_create_request');

  assert.ok(createTool);

  const inputSchema = property(createTool.inputSchema, 'input');
  const content = property(inputSchema, 'content');
  const editorial = property(inputSchema, 'editorial');
  const publication = property(inputSchema, 'publication');
  const workflow = property(inputSchema, 'workflow');
  const versioning = property(inputSchema, 'versioning');
  const media = property(inputSchema, 'media');

  assert.match(String(property(content, 'title').description), /title/i);
  assert.match(String(property(editorial, 'draft_markdown').description), /Markdown draft body/i);
  assert.match(String(property(publication, 'publish_payload').description), /publishing step/i);
  assert.match(String(property(workflow, 'workflow_id').description), /preserve across handoffs/i);
  assert.match(String(property(versioning, 'record_version').description), /revision tracking/i);

  assert.equal(content.additionalProperties, false);
  assert.equal(publication.additionalProperties, false);
  assert.equal(media.additionalProperties, false);
  assert.equal(property(media, 'image_prompt_register').additionalProperties, true);
});
