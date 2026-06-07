import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import test from 'node:test';

import { checkinRequest, handler, type WorkflowRecord } from '../../netlify/functions/save-json-blob.js';
import { getWorkflowBlobStore } from '../../netlify/lib/blob-store.js';

const publishSecret = 'save-json-blob-checkin-secret';
const localBlobRoot = new URL('../../.netlify/local-blobs/workflows/', import.meta.url);
const recordKey = (requestId: string) => `workflows/by-id/${requestId}.json`;

const contentSourceInput = (requestId: string) => ({
  record_type: 'content_source',
  schema_version: 'content_source.v1',
  content: {
    schema_version: 'content_blocks.v1',
    title: 'Checkin regression article',
  },
  publication: {
    schema_version: 'publication.v1',
    publication_status: 'draft',
    publish_payload: {
      slug: 'checkin-regression-article',
      title: 'Checkin regression article',
      author: 'Dr. Lurié',
      markdown: '# Checkin regression article',
      content: '# Checkin regression article',
      draft: true,
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

const postWorkflowAction = async (body: Record<string, unknown>) => {
  const response = await handler({
    httpMethod: 'POST',
    headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  assert.ok(response.statusCode >= 200 && response.statusCode < 300, response.body);

  return JSON.parse(response.body) as { record: WorkflowRecord };
};

const parseRecordResponse = (response: Awaited<ReturnType<typeof checkinRequest>>) => {
  assert.equal(response.statusCode, 200, response.body);

  return JSON.parse(response.body) as { record: WorkflowRecord };
};

test('checkin_request preserves newer published canonical workflow state over a stale completed checkout snapshot', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  await rm(localBlobRoot, { recursive: true, force: true });

  const requestId = `checkin-regression-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  await postWorkflowAction({
    action: 'create_request',
    request_id: requestId,
    input: contentSourceInput(requestId),
  });

  const checkout = await postWorkflowAction({
    action: 'checkout_request',
    request_id: requestId,
    owner_id: 'checkin-regression-agent',
    owner_label: 'Checkin regression agent',
    lease_seconds: 900,
  });
  const lockToken = checkout.record.lock?.token;
  assert.ok(lockToken, 'checkout must acquire a lock token');

  const finalOutput = await postWorkflowAction({
    action: 'patch_agent_output',
    request_id: requestId,
    agent_name: 'final_article',
    expected_agent_version: 0,
    lock_token: lockToken,
    output: { title: 'Checkin regression article', body: 'Final article output.' },
  });

  const finalComplete = await postWorkflowAction({
    action: 'mark_agent_complete',
    request_id: requestId,
    agent_name: 'final_article',
    expected_record_version: finalOutput.record.version,
    lock_token: lockToken,
    current_stage: null,
    next_agent: null,
    workflow_status: 'completed',
    needs_review: false,
    last_error: null,
  });
  const staleCompletedSnapshot = finalComplete.record;
  assert.equal(staleCompletedSnapshot.workflow_status, 'completed');
  assert.equal(staleCompletedSnapshot.current_stage, null);
  assert.equal(staleCompletedSnapshot.completed_agents.includes('final_article'), true);
  assert.ok(staleCompletedSnapshot.agent_outputs.final_article);

  await postWorkflowAction({
    action: 'mark_published',
    request_id: requestId,
    lock_token: lockToken,
    commit_metadata: {
      commit: 'published-checkin-regression-commit',
      articlePath: 'src/data/post/checkin-regression-article.md',
      deployStatus: 'queued',
    },
  });

  const store = await getWorkflowBlobStore({});
  const canonicalKey = recordKey(requestId);
  let canonicalGetCount = 0;
  const staleOnceStore = {
    ...store,
    async get(key: string) {
      if (key === canonicalKey && canonicalGetCount === 0) {
        canonicalGetCount += 1;
        return JSON.stringify(staleCompletedSnapshot);
      }

      if (key === canonicalKey) canonicalGetCount += 1;

      return store.get(key);
    },
  };

  const checkin = parseRecordResponse(
    await checkinRequest(staleOnceStore, {
      action: 'checkin_request',
      request_id: requestId,
      lock_token: lockToken,
    })
  );

  assert.equal(checkin.record.workflow_status, 'published');
  assert.equal(checkin.record.lock, undefined);
  assert.equal(checkin.record.completed_agents.includes('final_article'), true);
  assert.equal(checkin.record.input.publication?.publish_payload?.slug, 'checkin-regression-article');
  assert.ok(checkin.record.history.some((entry) => entry.action === 'mark_published'));
  assert.equal(checkin.record.history.at(-1)?.action, 'checkin_request');

  const fetched = await postWorkflowAction({ action: 'get_request', request_id: requestId });

  assert.equal(fetched.record.workflow_status, 'published');
  assert.equal(fetched.record.lock, undefined);
  assert.equal(fetched.record.completed_agents.includes('final_article'), true);
  assert.equal(fetched.record.input.publication?.publish_payload?.slug, 'checkin-regression-article');
  assert.ok(fetched.record.history.some((entry) => entry.action === 'mark_published'));
  assert.deepEqual(
    fetched.record.history.find((entry) => entry.action === 'mark_published')?.details?.commit_metadata,
    {
      commit: 'published-checkin-regression-commit',
      articlePath: 'src/data/post/checkin-regression-article.md',
      deployStatus: 'queued',
    }
  );
});
