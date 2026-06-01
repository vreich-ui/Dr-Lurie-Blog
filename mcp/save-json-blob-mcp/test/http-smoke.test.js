import assert from 'node:assert/strict';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { createHttpServer } from '../src/http.js';

const EXPECTED_TOOL_NAMES = [
  'save_json_blob_create_request',
  'save_json_blob_get_request',
  'save_json_blob_list_pending_requests',
  'save_json_blob_patch_agent_output',
  'save_json_blob_mark_agent_complete',
  'ping',
  'reader_insight_update_output',
  'reader_insight_mark_complete',
  'research_update_output',
  'research_mark_complete',
  'angle_update_output',
  'angle_mark_complete',
  'draft_update_output',
  'draft_mark_complete',
  'final_article_update_output',
  'final_article_mark_complete',
];

const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address());
    });
  });

const close = (server) =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

test('MCP HTTP server exposes the same tools and health endpoint', async () => {
  const server = createHttpServer();
  const address = await listen(server);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const client = new Client({ name: 'save-json-blob-mcp-http-smoke-test', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', baseUrl));

  try {
    const healthResponse = await fetch(`${baseUrl}/health`);
    const health = await healthResponse.json();

    assert.equal(healthResponse.status, 200);
    assert.deepEqual(health, {
      ok: true,
      name: 'save-json-blob-mcp',
      transport: 'streamable-http',
      mcpPath: '/mcp',
    });

    await client.connect(transport);
    const { tools } = await client.listTools();

    assert.deepEqual(
      tools.map((tool) => tool.name),
      EXPECTED_TOOL_NAMES
    );

    const pingResult = await client.callTool({ name: 'ping', arguments: {} });
    assert.deepEqual(pingResult.structuredContent, { ok: true, server: 'Dr_Lurie_Science_MCP' });
  } finally {
    await client.close();
    await close(server);
  }
});
