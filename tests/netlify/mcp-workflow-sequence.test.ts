import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import test from 'node:test';

import { handler } from '../../netlify/functions/mcp.js';

const localBlobRoot = new URL('../../.netlify/local-blobs/workflows/', import.meta.url);

const contentSourceInput = (requestId: string) => ({
  record_type: 'content_source',
  schema_version: 'content_source.v1',
  content: {
    schema_version: 'content_blocks.v1',
    title: 'MCP workflow smoke test',
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

const callTool = async (name: string, args: Record<string, unknown>) => {
  const response = await handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });

  assert.equal(response.statusCode, 200);

  const body = JSON.parse(response.body) as {
    result: { isError?: boolean; structuredContent?: Record<string, unknown>; content?: Array<{ text: string }> };
  };

  assert.equal(body.result.isError, undefined, body.result.content?.[0]?.text ?? `${name} returned an MCP error`);
  assert.ok(body.result.structuredContent, `${name} should return structuredContent`);

  return body.result.structuredContent;
};

test('MCP tools run create → checkout → patch output → mark complete → mark published → checkin', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = 'mcp-smoke-secret';
  process.env.PUBLISH_SECRET = 'mcp-smoke-secret';
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  await rm(localBlobRoot, { recursive: true, force: true });

  const requestId = `mcp-smoke-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const createResult = await callTool('save_json_blob_create_request', {
    request_id: requestId,
    input: contentSourceInput(requestId),
  });
  const createdRecord = createResult.record as Record<string, unknown>;
  assert.equal(createdRecord.request_id, requestId);
  assert.equal(createdRecord.version, 1);

  const checkoutResult = await callTool('save_json_blob_checkout_request', {
    request_id: requestId,
    owner_id: 'mcp-smoke-agent',
    owner_label: 'MCP smoke test agent',
    lease_seconds: 900,
  });
  const checkoutRecord = checkoutResult.record as { version: number; lock: { token: string } };
  assert.ok(checkoutRecord.lock.token);

  const patchResult = await callTool('save_json_blob_patch_agent_output', {
    request_id: requestId,
    agent_name: 'reader_insight',
    expected_agent_version: 0,
    lock_token: checkoutRecord.lock.token,
    output: { summary: 'Reader insight complete.' },
  });
  const patchedRecord = patchResult.record as {
    version: number;
    agent_outputs: { reader_insight: { version: number } };
  };
  assert.equal(patchedRecord.version, checkoutRecord.version + 1);
  assert.equal(patchedRecord.agent_outputs.reader_insight.version, 1);

  const completeResult = await callTool('save_json_blob_mark_agent_complete', {
    request_id: requestId,
    agent_name: 'reader_insight',
    expected_record_version: patchedRecord.version,
    lock_token: checkoutRecord.lock.token,
    next_agent: 'research',
    workflow_status: 'in_progress',
  });
  const completedRecord = completeResult.record as {
    version: number;
    next_agent: string;
    completed_agents: string[];
  };
  assert.equal(completedRecord.version, patchedRecord.version + 1);
  assert.equal(completedRecord.next_agent, 'research');
  assert.equal(completedRecord.completed_agents.includes('reader_insight'), true);

  const checkinResult = await callTool('save_json_blob_checkin_request', {
    request_id: requestId,
    lock_token: checkoutRecord.lock.token,
  });
  const checkedInRecord = checkinResult.record as { version: number; lock?: unknown };
  assert.equal(checkedInRecord.lock, undefined);

  const finalCheckoutResult = await callTool('save_json_blob_checkout_request', {
    request_id: requestId,
    owner_id: 'mcp-smoke-final-agent',
    owner_label: 'MCP smoke final agent',
  });
  const finalCheckoutRecord = finalCheckoutResult.record as { version: number; lock: { token: string } };

  const finalCompleteResult = await callTool('final_article_mark_complete', {
    request_id: requestId,
    expected_record_version: finalCheckoutRecord.version,
    lock_token: finalCheckoutRecord.lock.token,
    current_stage: 'final_article',
    next_agent: null,
    workflow_status: 'completed',
    needs_review: false,
    last_error: null,
  });
  const finalCompleteRecord = finalCompleteResult.record as {
    current_stage: string;
    next_agent: string | null;
    workflow_status: string;
    needs_review: boolean;
    last_error: string | null;
  };
  assert.equal(finalCompleteRecord.current_stage, 'final_article');
  assert.equal(finalCompleteRecord.next_agent, null);
  assert.equal(finalCompleteRecord.workflow_status, 'completed');
  assert.equal(finalCompleteRecord.needs_review, false);
  assert.equal(finalCompleteRecord.last_error, null);

  const publishedResult = await callTool('save_json_blob_mark_published', {
    request_id: requestId,
    lock_token: finalCheckoutRecord.lock.token,
    commit_metadata: {
      commit: 'abc123',
      articlePath: 'src/data/post/mcp-smoke.md',
      deployStatus: 'queued',
    },
  });
  const publishedRecord = publishedResult.record as {
    workflow_status: string;
    current_stage: string | null;
    next_agent: string | null;
    history: Array<{ action: string; details?: { commit_metadata?: Record<string, unknown> } }>;
  };
  assert.equal(publishedRecord.workflow_status, 'published');
  assert.equal(publishedRecord.current_stage, null);
  assert.equal(publishedRecord.next_agent, null);
  assert.deepEqual(publishedRecord.history.at(-1)?.details?.commit_metadata, {
    commit: 'abc123',
    articlePath: 'src/data/post/mcp-smoke.md',
    deployStatus: 'queued',
  });

  await callTool('save_json_blob_checkin_request', {
    request_id: requestId,
    lock_token: finalCheckoutRecord.lock.token,
  });
});

test('final_article_mark_complete matches generic mark_agent_complete state changes', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = 'mcp-smoke-secret';
  process.env.PUBLISH_SECRET = 'mcp-smoke-secret';
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  await rm(localBlobRoot, { recursive: true, force: true });

  const checkoutWorkflow = async (suffix: string) => {
    const requestId = `mcp-final-equivalence-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    await callTool('save_json_blob_create_request', {
      request_id: requestId,
      input: contentSourceInput(requestId),
    });

    const checkoutResult = await callTool('save_json_blob_checkout_request', {
      request_id: requestId,
      owner_id: 'mcp-final-equivalence-agent',
      owner_label: 'MCP final equivalence agent',
      lease_seconds: 900,
    });

    return {
      requestId,
      checkoutRecord: checkoutResult.record as { version: number; lock: { token: string } },
    };
  };

  const generic = await checkoutWorkflow('generic');
  const specific = await checkoutWorkflow('specific');

  const finalCompleteArgs = {
    current_stage: 'final_article',
    next_agent: null,
    workflow_status: 'completed',
    needs_review: false,
    last_error: null,
  };

  const genericResult = await callTool('save_json_blob_mark_agent_complete', {
    request_id: generic.requestId,
    agent_name: 'final_article',
    expected_record_version: generic.checkoutRecord.version,
    lock_token: generic.checkoutRecord.lock.token,
    ...finalCompleteArgs,
  });

  const specificResult = await callTool('final_article_mark_complete', {
    request_id: specific.requestId,
    expected_record_version: specific.checkoutRecord.version,
    lock_token: specific.checkoutRecord.lock.token,
    ...finalCompleteArgs,
  });

  type ComparableRecord = {
    version: number;
    workflow_status: string;
    current_stage: string | null;
    next_agent: string | null;
    completed_agents: string[];
    failed_agents: string[];
    needs_review: boolean;
    last_error: string | null;
    lock?: { token: string };
    history: Array<{ action: string; agent_name?: string }>;
  };

  const genericRecord = genericResult.record as ComparableRecord;
  const specificRecord = specificResult.record as ComparableRecord;
  const comparableState = (record: ComparableRecord, checkoutVersion: number, lockToken: string) => ({
    version_increment: record.version - checkoutVersion,
    workflow_status: record.workflow_status,
    current_stage: record.current_stage,
    next_agent: record.next_agent,
    completed_agents: record.completed_agents,
    failed_agents: record.failed_agents,
    needs_review: record.needs_review,
    last_error: record.last_error,
    lock_token_preserved: record.lock?.token === lockToken,
    history_length: record.history.length,
    last_history_action: record.history.at(-1)?.action,
    last_history_agent: record.history.at(-1)?.agent_name,
  });

  assert.deepEqual(
    comparableState(genericRecord, generic.checkoutRecord.version, generic.checkoutRecord.lock.token),
    comparableState(specificRecord, specific.checkoutRecord.version, specific.checkoutRecord.lock.token)
  );
});
