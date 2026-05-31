import assert from 'node:assert/strict';
import test from 'node:test';

const FUNCTION_PATH = '/.netlify/functions/save-json-blob';
const REQUIRED_ENV = ['NETLIFY_PUBLISH_SECRET', 'SAVE_JSON_BLOB_BASE_URL'];
const missingEnv = REQUIRED_ENV.filter((name) => !process.env[name]);

const functionUrl = () => {
  const baseUrl = process.env.SAVE_JSON_BLOB_BASE_URL.endsWith('/')
    ? process.env.SAVE_JSON_BLOB_BASE_URL.slice(0, -1)
    : process.env.SAVE_JSON_BLOB_BASE_URL;

  return `${baseUrl}${FUNCTION_PATH}`;
};

const postWorkflowAction = async (payload) => {
  const response = await fetch(functionUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-publish-key': process.env.NETLIFY_PUBLISH_SECRET,
    },
    body: JSON.stringify(payload),
  });
  const responseText = await response.text();
  let body;

  try {
    body = responseText ? JSON.parse(responseText) : {};
  } catch {
    body = { raw: responseText };
  }

  return { body, response, responseText };
};

const assertWorkflowOk = ({ body, response, responseText }, action) => {
  assert.equal(response.ok, true, `${action} failed with HTTP ${response.status}: ${responseText}`);
  assert.equal(body.ok, true, `${action} response body was not ok`);
  assert.equal(body.action, action);

  return body;
};

test(
  'save-json-blob workflow idempotency and conflict integration',
  { skip: missingEnv.length ? `requires ${missingEnv.join(', ')}` : false },
  async () => {
    const requestId = `wf-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const input = {
      source: 'save-json-blob-mcp integration test',
      created_at: new Date().toISOString(),
    };

    const createBody = assertWorkflowOk(
      await postWorkflowAction({ action: 'create_request', request_id: requestId, input }),
      'create_request'
    );
    assert.equal(createBody.record.request_id, requestId);
    assert.equal(createBody.record.version, 1);
    assert.equal(createBody.record.next_agent, 'reader_insight');

    const listBody = assertWorkflowOk(
      await postWorkflowAction({ action: 'list_pending_requests', stage: 'reader_insight' }),
      'list_pending_requests'
    );
    assert.ok(
      listBody.records.some((record) => record.request_id === requestId),
      `Expected ${requestId} in reader_insight pending list`
    );

    const patchPayload = {
      action: 'patch_agent_output',
      request_id: requestId,
      agent_name: 'reader_insight',
      expected_agent_version: 0,
      output: {
        summary: 'Reader insight complete.',
        audiences: ['integration-test'],
      },
    };
    const patchBody = assertWorkflowOk(await postWorkflowAction(patchPayload), 'patch_agent_output');
    assert.equal(patchBody.record.request_id, requestId);
    assert.equal(patchBody.record.agent_outputs.reader_insight.version, 1);
    assert.equal(patchBody.record.version, 2);

    const idempotentPatchBody = assertWorkflowOk(await postWorkflowAction(patchPayload), 'patch_agent_output');
    assert.equal(idempotentPatchBody.idempotent, true);
    assert.equal(idempotentPatchBody.record.version, patchBody.record.version);

    const completeBody = assertWorkflowOk(
      await postWorkflowAction({
        action: 'mark_agent_complete',
        request_id: requestId,
        agent_name: 'reader_insight',
        expected_record_version: patchBody.record.version,
        next_agent: 'research',
        workflow_status: 'in_progress',
      }),
      'mark_agent_complete'
    );
    assert.equal(completeBody.record.request_id, requestId);
    assert.equal(completeBody.record.version, patchBody.record.version + 1);
    assert.equal(completeBody.record.next_agent, 'research');
    assert.ok(completeBody.record.completed_agents.includes('reader_insight'));

    const conflictResult = await postWorkflowAction({
      action: 'mark_agent_complete',
      request_id: requestId,
      agent_name: 'reader_insight',
      expected_record_version: patchBody.record.version,
      next_agent: 'angle',
      workflow_status: 'in_progress',
    });
    assert.equal(conflictResult.response.status, 409);
    assert.equal(conflictResult.body.ok, false);
    assert.equal(conflictResult.body.conflict, true);
  }
);
