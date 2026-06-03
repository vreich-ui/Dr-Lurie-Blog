import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const EXPECTED_TOOL_NAMES = [
  'save_json_blob_create_request',
  'save_json_blob_get_request',
  'save_json_blob_list_pending_requests',
  'save_json_blob_patch_agent_output',
  'save_json_blob_mark_agent_complete',
  'save_json_blob_checkout_request',
  'save_json_blob_refresh_lock',
  'save_json_blob_checkin_request',
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

const serverPath = fileURLToPath(new URL('../src/index.js', import.meta.url));
const packageDir = fileURLToPath(new URL('..', import.meta.url));

test('MCP stdio server lists underscore-only Agent Builder tool names', async () => {
  const client = new Client({ name: 'save-json-blob-mcp-smoke-test', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: packageDir,
    env: {
      NETLIFY_PUBLISH_SECRET: 'test-secret',
      SAVE_JSON_BLOB_BASE_URL: 'https://example.netlify.app',
    },
    stderr: 'pipe',
  });

  try {
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
  }
});
