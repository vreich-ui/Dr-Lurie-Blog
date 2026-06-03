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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForPendingRequest = async ({ requestId, stage, timeoutMs = 5000 }) => {
  const startedAt = Date.now();
  let lastBody;

  while (Date.now() - startedAt <= timeoutMs) {
    const listBody = assertWorkflowOk(
      await postWorkflowAction({ action: 'list_pending_requests', stage, limit: 50 }),
      'list_pending_requests'
    );

    if (listBody.records.some((record) => record.request_id === requestId)) {
      return listBody;
    }

    lastBody = listBody;
    await sleep(250);
  }

  assert.fail(
    `Expected ${requestId} in ${stage} pending list within ${timeoutMs}ms. Last records: ${JSON.stringify(
      lastBody?.records ?? []
    )}`
  );
};

test(
  'save-json-blob workflow idempotency and conflict integration',
  { skip: missingEnv.length ? `requires ${missingEnv.join(', ')}` : false },
  async () => {
    const requestId = `wf-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const input = {
      record_type: 'content_source',
      schema_version: 'content_source.v1',
      content: {
        schema_version: 'content_blocks.v1',
        title: 'save-json-blob-mcp integration test',
      },
      workflow: {
        schema_version: 'content_workflow.v1',
        workflow_id: requestId,
      },
      versioning: {
        schema_version: 'versioning.v1',
        record_version: 1,
      },
    };

    const createBody = assertWorkflowOk(
      await postWorkflowAction({ action: 'create_request', request_id: requestId, input }),
      'create_request'
    );
    assert.equal(createBody.record.request_id, requestId);
    assert.equal(createBody.record.version, 1);
    assert.equal(createBody.record.next_agent, 'reader_insight');

    await waitForPendingRequest({ requestId, stage: 'reader_insight' });

    const checkoutBody = assertWorkflowOk(
      await postWorkflowAction({
        action: 'checkout_request',
        request_id: requestId,
        owner_id: 'integration-test-agent',
        owner_label: 'Integration test agent',
        lease_seconds: 900,
      }),
      'checkout_request'
    );
    assert.equal(checkoutBody.record.request_id, requestId);
    assert.ok(checkoutBody.record.lock.token);
    const lockToken = checkoutBody.record.lock.token;

    const patchPayload = {
      action: 'patch_agent_output',
      request_id: requestId,
      agent_name: 'reader_insight',
      expected_agent_version: 0,
      lock_token: lockToken,
      output: {
        summary: 'Reader insight complete.',
        audiences: ['integration-test'],
      },
    };
    const patchBody = assertWorkflowOk(await postWorkflowAction(patchPayload), 'patch_agent_output');
    assert.equal(patchBody.record.request_id, requestId);
    assert.equal(patchBody.record.agent_outputs.reader_insight.version, 1);
    assert.equal(patchBody.record.version, checkoutBody.record.version + 1);

    const idempotentPatchBody = assertWorkflowOk(await postWorkflowAction(patchPayload), 'patch_agent_output');
    assert.equal(idempotentPatchBody.idempotent, true);
    assert.equal(idempotentPatchBody.record.version, patchBody.record.version);

    const completeBody = assertWorkflowOk(
      await postWorkflowAction({
        action: 'mark_agent_complete',
        request_id: requestId,
        agent_name: 'reader_insight',
        expected_record_version: patchBody.record.version,
        lock_token: lockToken,
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
      lock_token: lockToken,
      next_agent: 'angle',
      workflow_status: 'in_progress',
    });
    assert.equal(conflictResult.response.status, 409);
    assert.equal(conflictResult.body.ok, false);
    assert.equal(conflictResult.body.conflict, true);

    const checkinBody = assertWorkflowOk(
      await postWorkflowAction({ action: 'checkin_request', request_id: requestId, lock_token: lockToken }),
      'checkin_request'
    );
    assert.equal(checkinBody.record.request_id, requestId);
    assert.equal(checkinBody.record.lock, undefined);
  }
);
