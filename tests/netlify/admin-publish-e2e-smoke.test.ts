import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import test from 'node:test';

import { saveAdminJsonDraft } from '../../netlify/functions/admin-save-json-draft.js';
import { handler as mcpHandler } from '../../netlify/functions/mcp.js';
import { handler as publishHandler } from '../../netlify/functions/publish-article.js';
import { getWorkflowBlobStore } from '../../netlify/lib/blob-store.js';
import type { WorkflowRecord } from '../../src/schema/schema-v1.js';

const localBlobRoot = new URL('../../.netlify/local-blobs/workflows/', import.meta.url);
const publishSecret = 'admin-publish-e2e-smoke-secret';

const contentSourceInput = (requestId: string, body = 'Initial publish smoke body.') => ({
  record_type: 'content_source',
  schema_version: 'content_source.v1',
  content: {
    schema_version: 'content_blocks.v1',
    title: 'Admin Publish E2E Smoke',
    blocks: [
      {
        block_id: 'body',
        block_type: 'markdown',
        section_id: 'body',
        payload: { markdown: body },
      },
    ],
  },
  publication: {
    schema_version: 'publication.v1',
    publication_status: 'draft',
    publish_payload: {
      slug: 'admin-publish-e2e-smoke',
      title: 'Admin Publish E2E Smoke',
      author: 'Dr. Lurié',
      markdown: `---\npublishDate: 2026-06-05T00:00:00.000Z\ntitle: "Admin Publish E2E Smoke"\nauthor: "Dr. Lurié"\n---\n\n${body}\n`,
      content: body,
      draft: true,
      overwrite: false,
    },
  },
  workflow: {
    schema_version: 'content_workflow.v1',
    workflow_id: requestId,
    current_agent: 'draft',
    next_agent: 'final_article',
  },
  versioning: {
    schema_version: 'versioning.v1',
    record_version: 1,
  },
});

const callToolRaw = async (name: string, args: Record<string, unknown>) => {
  const response = await mcpHandler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `${name}-${Date.now()}`,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });

  assert.equal(response.statusCode, 200, response.body);

  const body = JSON.parse(response.body) as {
    result: { isError?: boolean; structuredContent?: Record<string, unknown>; content?: Array<{ text: string }> };
  };

  return body.result;
};

const callTool = async (name: string, args: Record<string, unknown>) => {
  const result = await callToolRaw(name, args);

  assert.equal(result.isError, undefined, result.content?.[0]?.text ?? `${name} failed`);
  assert.ok(result.structuredContent, `${name} should return structuredContent`);

  return result.structuredContent;
};

const parseJsonBody = <T>(response: { body: string }) => JSON.parse(response.body) as T;

const installGitHubPublishMock = (slug = 'admin-publish-e2e-smoke', commitSha = 'published-smoke-commit') => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; url: string }> = [];
  const blobWrites: Array<{ content: string; encoding: string }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url });

    if (url.includes(`/contents/src/data/post/${slug}.md`)) {
      return new Response('not found', { status: 404 });
    }

    if (url.includes('/git/ref/heads/main')) {
      return Response.json({ object: { sha: 'base-sha' } });
    }

    if (url.endsWith('/git/commits/base-sha')) {
      return Response.json({ tree: { sha: 'base-tree' } });
    }

    if (url.endsWith('/git/blobs') && method === 'POST') {
      blobWrites.push(JSON.parse(String(init?.body)) as { content: string; encoding: string });
      return Response.json({ sha: `blob-${blobWrites.length}` });
    }

    if (url.endsWith('/git/trees') && method === 'POST') {
      return Response.json({ sha: 'new-tree' });
    }

    if (url.endsWith('/git/commits') && method === 'POST') {
      return Response.json({ sha: commitSha });
    }

    if (url.includes('/git/refs/heads/main') && method === 'PATCH') {
      return Response.json({ ok: true });
    }

    return new Response(`unexpected ${method} ${url}`, { status: 500 });
  }) as typeof fetch;

  return { calls, blobWrites, restore: () => (globalThis.fetch = originalFetch) };
};

test('admin publish pseudo-E2E propagates lock through draft save, publish, mark_published, and checkin', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-e2e-smoke-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';

  await rm(localBlobRoot, { recursive: true, force: true });

  const requestId = `admin-publish-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const createResult = await callTool('save_json_blob_create_request', {
    request_id: requestId,
    input: contentSourceInput(requestId),
  });
  const createdRecord = createResult.record as WorkflowRecord;
  assert.equal(createdRecord.request_id, requestId);
  assert.equal(createdRecord.lock, undefined);

  const checkoutResult = await callTool('save_json_blob_checkout_request', {
    request_id: requestId,
    owner_id: 'admin-publish-ui-smoke',
    owner_label: 'Admin publish UI smoke test',
    lease_seconds: 900,
  });
  const checkoutRecord = checkoutResult.record as WorkflowRecord;
  const lockToken = checkoutRecord.lock?.token;
  assert.ok(lockToken, 'checkout must return a lock_token');

  const store = await getWorkflowBlobStore({});
  const editedInput = contentSourceInput(requestId, 'Edited draft body that should be published.');
  const missingLockResponse = await saveAdminJsonDraft(store, { request_id: requestId, input: editedInput });
  const missingLockBody = parseJsonBody<{ error_code: string; ok: boolean }>(missingLockResponse);
  assert.equal(missingLockResponse.statusCode, 400);
  assert.equal(missingLockBody.ok, false);
  assert.equal(missingLockBody.error_code, 'missing_lock_token');

  const savedDraftResponse = await saveAdminJsonDraft(store, {
    request_id: requestId,
    lock_token: lockToken,
    input: editedInput,
  });
  const savedDraftBody = parseJsonBody<{ record: WorkflowRecord }>(savedDraftResponse);
  assert.equal(savedDraftResponse.statusCode, 200, savedDraftResponse.body);
  assert.equal(savedDraftBody.record.lock?.token, lockToken);
  assert.equal(
    savedDraftBody.record.input.publication?.publish_payload?.content,
    'Edited draft body that should be published.'
  );

  const finalArticleBody = 'Completed final_article body that should be imported into the publish form.';
  const finalOutputResult = await callTool('final_article_update_output', {
    request_id: requestId,
    expected_agent_version: 0,
    lock_token: lockToken,
    output: {
      title: 'Admin Publish E2E Smoke Final',
      slug: 'admin-publish-e2e-smoke',
      author: 'Dr. Final',
      body: finalArticleBody,
      excerpt: 'Final article excerpt.',
      seoDescription: 'Final article SEO description.',
      tags: ['final-article', 'smoke-test'],
      featuredImage: 'https://kugelmedia.netlify.app/drlurieblog/final-article.jpg',
      mediaEntries: [{ kind: 'image', alt: 'Final article image' }],
      artifactReferences: [{ blobKey: 'artifact/final-article-image', contentType: 'image/png' }],
    },
  });
  const finalOutputRecord = finalOutputResult.record as WorkflowRecord;
  assert.equal(finalOutputRecord.input.publication?.schema_version, 'publication.v1');
  assert.equal(finalOutputRecord.input.publication?.publish_payload?.title, 'Admin Publish E2E Smoke Final');
  assert.equal(finalOutputRecord.input.publication?.publish_payload?.slug, 'admin-publish-e2e-smoke');
  assert.equal(finalOutputRecord.input.publication?.publish_payload?.author, 'Dr. Final');
  assert.equal(finalOutputRecord.input.publication?.publish_payload?.content, finalArticleBody);
  assert.deepEqual(finalOutputRecord.input.publication?.publish_payload?.tags, ['final-article', 'smoke-test']);

  const finalCompleteResult = await callTool('final_article_mark_complete', {
    request_id: requestId,
    expected_record_version: finalOutputRecord.version,
    lock_token: lockToken,
  });
  const finalCompleteRecord = finalCompleteResult.record as WorkflowRecord;
  assert.equal(finalCompleteRecord.workflow_status, 'completed');
  assert.equal(finalCompleteRecord.current_stage, null);
  assert.equal(finalCompleteRecord.completed_agents.includes('final_article'), true);
  assert.ok(finalCompleteRecord.agent_outputs.final_article, 'final article output must be preserved before publish');
  assert.equal(finalCompleteRecord.input.publication?.schema_version, 'publication.v1');
  assert.equal(finalCompleteRecord.input.publication?.publish_payload?.title, 'Admin Publish E2E Smoke Final');
  assert.equal(finalCompleteRecord.input.publication?.publish_payload?.slug, 'admin-publish-e2e-smoke');
  assert.equal(finalCompleteRecord.input.publication?.publish_payload?.author, 'Dr. Final');
  assert.equal(finalCompleteRecord.input.publication?.publish_payload?.content, finalArticleBody);
  assert.equal(finalCompleteRecord.input.publication?.publish_payload?.excerpt, 'Final article excerpt.');
  assert.equal(
    finalCompleteRecord.input.publication?.publish_payload?.seoDescription,
    'Final article SEO description.'
  );
  assert.equal(
    finalCompleteRecord.input.publication?.publish_payload?.featuredImage,
    'https://kugelmedia.netlify.app/drlurieblog/final-article.jpg'
  );
  assert.deepEqual(finalCompleteRecord.input.publication?.publish_payload?.mediaEntries, [
    { kind: 'image', alt: 'Final article image' },
  ]);
  assert.deepEqual(finalCompleteRecord.input.publication?.publish_payload?.artifactReferences, [
    { blobKey: 'artifact/final-article-image', contentType: 'image/png' },
  ]);

  const fetchedDraftResult = await callTool('save_json_blob_get_request', { request_id: requestId });
  const fetchedDraftRecord = fetchedDraftResult.record as WorkflowRecord;
  const importedPublishPayload = fetchedDraftRecord.input.publication?.publish_payload;
  assert.equal(importedPublishPayload?.title, 'Admin Publish E2E Smoke Final');
  assert.equal(importedPublishPayload?.author, 'Dr. Final');
  assert.equal(importedPublishPayload?.content, finalArticleBody);

  const github = installGitHubPublishMock();
  try {
    const publishResponse = await publishHandler({
      httpMethod: 'POST',
      headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'admin-publish-e2e-smoke',
        title: importedPublishPayload?.title,
        content: importedPublishPayload?.content,
        author: importedPublishPayload?.author,
        excerpt: importedPublishPayload?.excerpt,
        seoDescription: importedPublishPayload?.seoDescription,
        tags: importedPublishPayload?.tags,
        overwrite: false,
        requestId,
        request_id: requestId,
        lock_token: lockToken,
        artifactReferences: [],
      }),
    });
    const publishBody = parseJsonBody<{ articlePath: string; commit: string; success: boolean }>(publishResponse);
    assert.equal(publishResponse.statusCode, 201, publishResponse.body);
    assert.equal(publishBody.success, true);
    assert.equal(publishBody.articlePath, 'src/data/post/admin-publish-e2e-smoke.md');
    assert.equal(publishBody.commit, 'published-smoke-commit');
    assert.ok(github.blobWrites.some((write) => write.content.includes(finalArticleBody)));
    assert.equal(
      github.blobWrites.some((write) => write.content.includes('Edited draft body that should be published.')),
      false
    );

    const missingPublishLockResult = await callTool('save_json_blob_mark_published', {
      request_id: requestId,
      commit_metadata: { commit: publishBody.commit, articlePath: publishBody.articlePath },
    }).catch((error: unknown) => error);
    assert.ok(missingPublishLockResult instanceof Error, 'mark_published must reject missing lock_token');

    const publishedResult = await callTool('save_json_blob_mark_published', {
      request_id: requestId,
      expected_record_version: finalCompleteRecord.version,
      lock_token: lockToken,
      commit_metadata: { commit: publishBody.commit, articlePath: publishBody.articlePath },
    });
    const publishedRecord = publishedResult.record as WorkflowRecord;
    assert.equal(publishedRecord.workflow_status, 'published');
    assert.equal(publishedRecord.current_stage, null);
    assert.equal(publishedRecord.next_agent, null);
    assert.deepEqual(publishedRecord.completed_agents, finalCompleteRecord.completed_agents);
    assert.deepEqual(publishedRecord.agent_outputs.final_article, finalCompleteRecord.agent_outputs.final_article);
    assert.equal(publishedRecord.lock?.token, lockToken);
    assert.deepEqual(publishedRecord.history.at(-1)?.details?.commit_metadata, {
      commit: 'published-smoke-commit',
      articlePath: 'src/data/post/admin-publish-e2e-smoke.md',
    });

    const checkinResult = await callTool('save_json_blob_checkin_request', {
      request_id: requestId,
      lock_token: lockToken,
    });
    const checkedInRecord = checkinResult.record as WorkflowRecord;
    assert.equal(checkedInRecord.workflow_status, 'published');
    assert.equal(checkedInRecord.lock, undefined);
    assert.equal(checkedInRecord.history.at(-1)?.action, 'checkin_request');
  } finally {
    github.restore();
  }
});

test('scheduled publish tool publishes due scheduled records and returns not-due reasons for future records', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-scheduled-smoke-token';
  process.env.GITHUB_REPOSITORY = 'vreich-ui/dr-lurie-blog-test';
  process.env.GITHUB_BRANCH = 'main';

  await rm(localBlobRoot, { recursive: true, force: true });

  const requestId = `req_scheduled_publish_smoke_${Date.now()}`;
  const scheduledSlug = `scheduled-publish-smoke-${Date.now()}`;
  const scheduledInput = contentSourceInput(requestId, 'Scheduled publish smoke body.') as ReturnType<
    typeof contentSourceInput
  > & {
    publication: ReturnType<typeof contentSourceInput>['publication'] & {
      publish_payload: ReturnType<typeof contentSourceInput>['publication']['publish_payload'] & {
        publishDate?: string;
      };
      scheduled_for?: string;
    };
  };
  scheduledInput.publication.publication_status = 'scheduled';
  scheduledInput.publication.scheduled_for = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  scheduledInput.publication.publish_payload.slug = scheduledSlug;
  scheduledInput.publication.publish_payload.title = 'Scheduled Publish Smoke';
  scheduledInput.publication.publish_payload.markdown = 'Scheduled publish smoke body.\n';
  scheduledInput.publication.publish_payload.publishDate = '2026-06-10T00:00:00.000Z';
  scheduledInput.publication.publish_payload.author = 'Dr. Lurié';
  scheduledInput.publication.publish_payload.content = 'Scheduled publish smoke body.';
  scheduledInput.content.title = 'Scheduled Publish Smoke';

  const createResult = await callTool('save_json_blob_create_request', {
    request_id: requestId,
    input: scheduledInput,
    current_agent: 'final_article',
    next_agent: null,
    validation_mode: 'admin_publish_draft',
  });
  const createdRecord = createResult.record as WorkflowRecord;

  const checkoutResult = await callTool('save_json_blob_checkout_request', {
    request_id: requestId,
    owner_id: 'scheduled-agent',
    owner_label: 'Scheduled agent',
  });
  const checkedOutRecord = checkoutResult.record as WorkflowRecord;
  const lockToken = checkedOutRecord.lock?.token;
  assert.ok(lockToken);

  const finalOutputResult = await callTool('final_article_update_output', {
    request_id: requestId,
    expected_agent_version: 0,
    lock_token: lockToken,
    output: scheduledInput.publication.publish_payload,
  });
  const finalOutputRecord = finalOutputResult.record as WorkflowRecord;

  const completeResult = await callTool('final_article_mark_complete', {
    request_id: requestId,
    expected_record_version: finalOutputRecord.version,
    lock_token: lockToken,
  });
  const completeRecord = completeResult.record as WorkflowRecord;
  assert.equal(completeRecord.workflow_status, 'completed');

  const futureResult = await callToolRaw('save_json_blob_publish_scheduled', {
    request_id: requestId,
    expected_record_version: completeRecord.version,
    lock_token: lockToken,
    agent_id: 'agent-scheduled-smoke',
    agent_owner: 'QA',
  });
  assert.equal(futureResult.isError, true);
  assert.equal(futureResult.structuredContent?.error_code, 'scheduled_publish_not_due');

  const store = await getWorkflowBlobStore({ blobs: undefined });
  const storedText = await store.get(`workflows/by-id/${requestId}.json`);
  assert.ok(storedText);
  const storedRecord = JSON.parse(storedText) as WorkflowRecord;
  storedRecord.input.publication!.scheduled_for = new Date(Date.now() - 1000).toISOString();
  await store.setJSON(`workflows/by-id/${requestId}.json`, storedRecord);

  const github = installGitHubPublishMock(scheduledSlug, 'scheduled-published-commit');
  try {
    const scheduledResult = await callTool('save_json_blob_publish_scheduled', {
      request_id: requestId,
      expected_record_version: completeRecord.version,
      lock_token: lockToken,
      agent_id: 'agent-scheduled-smoke',
      agent_owner: 'QA',
      agent_label: 'Scheduled Smoke Agent',
    });
    const publishedRecord = scheduledResult.record as WorkflowRecord;
    assert.equal(publishedRecord.workflow_status, 'published');
    assert.equal(
      (scheduledResult.publish_result as { commit?: string } | undefined)?.commit,
      'scheduled-published-commit'
    );
    assert.ok(github.blobWrites.some((write) => write.content.includes('Scheduled publish smoke body.')));
    assert.deepEqual(publishedRecord.history.at(-1)?.details?.commit_metadata, {
      commit: 'scheduled-published-commit',
      articlePath: `src/data/post/${scheduledSlug}.md`,
      deployStatus: 'queued',
      message: `Article publish queued for src/data/post/${scheduledSlug}.md.`,
      scheduled_for: storedRecord.input.publication!.scheduled_for,
      scheduled_publish: true,
      agent_id: 'agent-scheduled-smoke',
      agent_owner: 'QA',
      agent_label: 'Scheduled Smoke Agent',
    });
  } finally {
    github.restore();
  }

  assert.equal(createdRecord.request_id, requestId);
});
