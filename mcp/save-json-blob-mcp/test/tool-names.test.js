import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const EXPECTED_CORE_TOOL_NAMES = [
  'save_json_blob_create_request',
  'save_json_blob_get_request',
  'save_json_blob_list_pending_requests',
  'save_json_blob_patch_agent_output',
  'save_json_blob_mark_agent_complete',
  'save_json_blob_checkout_request',
  'save_json_blob_refresh_lock',
  'save_json_blob_checkin_request',
];

test('registered MCP tools use Agent Builder underscore-only names', async () => {
  const source = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
  const registeredToolNames = [...source.matchAll(/server\.registerTool\(\s*(?:'([^']+)'|`([^`]+)`)/g)].map(
    ([, quoted, templated]) => quoted ?? templated
  );

  assert.deepEqual(registeredToolNames.slice(0, EXPECTED_CORE_TOOL_NAMES.length), EXPECTED_CORE_TOOL_NAMES);
  assert.equal(
    registeredToolNames.some((name) => name.includes('.')),
    false
  );
  assert.equal(source.includes('save_json_blob.create_request'), false);
});
