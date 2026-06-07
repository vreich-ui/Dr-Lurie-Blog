import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import test from 'node:test';

import { handler } from '../../netlify/functions/mcp.js';

const localBlobRoot = new URL('../../.netlify/local-blobs/workflows/', import.meta.url);

type ToolDefinition = {
  name: string;
  inputSchema: {
    properties?: Record<string, unknown>;
    required?: string[];
  };
};

const contentSourceInput = (requestId: string) => ({
  record_type: 'content_source',
  schema_version: 'content_source.v1',
  content: {
    schema_version: 'content_blocks.v1',
    title: 'MCP deployment schema smoke test',
  },
  editorial: {
    schema_version: 'editorial.v1',
    draft_markdown: 'MCP deployment schema smoke test body.',
  },
  publication: {
    schema_version: 'publication.v1',
    publish_payload: {
      slug: 'mcp-deployment-schema-smoke-test',
      title: 'MCP deployment schema smoke test',
      author: 'Dr. Lurié',
    },
  },
  workflow: {
    schema_version: 'content_workflow.v1',
    workflow_id: requestId,
  },
  versioning: {
    schema_version: 'versioning.v1',
    record_version: 1,
  },
});

const rpc = async (method: string, params: Record<string, unknown> = {}) => {
  const response = await handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });

  assert.equal(response.statusCode, 200);

  return JSON.parse(response.body) as {
    result?: Record<string, unknown>;
    error?: Record<string, unknown>;
  };
};

const callTool = async (name: string, args: Record<string, unknown>) => {
  const body = await rpc('tools/call', { name, arguments: args });
  assert.ok(body.result, `${name} should return an MCP result`);
  return body.result as {
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
    content?: Array<{ text: string }>;
  };
};

const callToolOk = async (name: string, args: Record<string, unknown>) => {
  const result = await callTool(name, args);
  assert.equal(result.isError, undefined, result.content?.[0]?.text ?? `${name} returned an MCP error`);
  assert.ok(result.structuredContent, `${name} should return structuredContent`);
  return result.structuredContent;
};

test('Netlify deployment route keeps /mcp pointed at the site MCP function', async () => {
  const config = await readFile('netlify.toml', 'utf8');

  assert.match(config, /from\s*=\s*"\/mcp"/);
  assert.match(config, /to\s*=\s*"\/\.netlify\/functions\/mcp"/);
  assert.match(config, /force\s*=\s*true/);
});

test('MCP initialize and tools/list expose deployed connector schema requirements', async () => {
  const initialize = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'local-deployment-schema-smoke', version: '1.0.0' },
  });

  assert.equal((initialize.result?.serverInfo as { name?: string } | undefined)?.name, 'Dr_Lurie_MCP_Server');

  const toolsList = await rpc('tools/list');
  const tools = (toolsList.result?.tools as ToolDefinition[] | undefined) ?? [];
  const markPublished = tools.find((tool) => tool.name === 'save_json_blob_mark_published');

  assert.ok(markPublished, 'Expected save_json_blob_mark_published to be registered.');
  assert.ok(
    markPublished.inputSchema.properties?.expected_record_version,
    'Expected save_json_blob_mark_published.inputSchema.properties.expected_record_version to exist.'
  );
});

test('save_json_blob_mark_published forwards expected_record_version to the backend action', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = 'mcp-deployment-schema-smoke-secret';
  process.env.PUBLISH_SECRET = 'mcp-deployment-schema-smoke-secret';
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  await rm(localBlobRoot, { recursive: true, force: true });

  const requestId = `mcp-deployment-schema-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  await callToolOk('save_json_blob_create_request', {
    request_id: requestId,
    input: contentSourceInput(requestId),
    current_agent: 'final_article',
    next_agent: null,
  });

  const checkout = await callToolOk('save_json_blob_checkout_request', {
    request_id: requestId,
    owner_id: 'mcp-deployment-schema-smoke-agent',
    owner_label: 'MCP deployment schema smoke agent',
  });
  const checkoutRecord = checkout.record as { lock: { token: string } };

  const output = await callToolOk('final_article_update_output', {
    request_id: requestId,
    expected_agent_version: 0,
    lock_token: checkoutRecord.lock.token,
    output: { title: 'MCP deployment schema smoke', body: 'Ready for publication.' },
  });
  const outputRecord = output.record as { version: number };

  const complete = await callToolOk('final_article_mark_complete', {
    request_id: requestId,
    expected_record_version: outputRecord.version,
    lock_token: checkoutRecord.lock.token,
  });
  const completeRecord = complete.record as { version: number };

  const stalePublish = await callTool('save_json_blob_mark_published', {
    request_id: requestId,
    expected_record_version: completeRecord.version + 100,
    lock_token: checkoutRecord.lock.token,
    commit_metadata: { commit: 'schema-smoke' },
  });

  assert.equal(stalePublish.isError, true);
  assert.equal(stalePublish.structuredContent?.statusCode, 409);
  assert.equal(stalePublish.structuredContent?.conflict, true);

  const published = await callToolOk('save_json_blob_mark_published', {
    request_id: requestId,
    expected_record_version: completeRecord.version,
    lock_token: checkoutRecord.lock.token,
    commit_metadata: { commit: 'schema-smoke' },
  });
  const publishedRecord = published.record as { workflow_status: string };
  assert.equal(publishedRecord.workflow_status, 'published');
});
