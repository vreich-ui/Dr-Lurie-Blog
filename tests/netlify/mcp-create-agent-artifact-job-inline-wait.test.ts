import '../../sites/drlurie/config/policy-bindings.js';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { handler, _mcpInternal, type LambdaEvent } from '../../netlify/functions/mcp.js';
import { setLocalBlobsRootForTesting } from '../../packages/core/server/lib/local-blobs.js';
import { stubPdfToolMcp, type PdfToolMcpRoute } from './pdf-tool-mcp-fetch-stub.js';

const { resolveArtifactJobInlineWaitBudgetMs } = _mcpInternal;

const STORAGE_SECRET = 'storage-secret-never-expose';
const RUN_SECRET = 'run-secret-never-expose';
const PROOF_SECRET = 'proof-never-expose';
const LOCAL_BLOBS_ROOT = join(
  process.cwd(),
  '.netlify',
  'local-blobs-test',
  'mcp-create-agent-artifact-job-inline-wait'
);
setLocalBlobsRootForTesting(LOCAL_BLOBS_ROOT);

for (const key of [
  'NETLIFY',
  'NETLIFY_SITE_ID',
  'NETLIFY_BLOBS_TOKEN',
  'NETLIFY_AUTH_TOKEN',
  'SITE_ID',
  'MCP_HTTP_AUTH_TOKEN',
]) {
  delete process.env[key];
}
process.env.PUBLISH_SECRET = 'test-publish-secret';
process.env.PDF_TOOL_STORAGE_TOKEN = STORAGE_SECRET;
process.env.PDF_TOOL_STORAGE_SITE_ID = 'site-api-id';
process.env.PDF_TOOL_BASE_URL = 'https://pdf-tool.test';
process.env.PDF_TOOL_AGENT_RUN_TOKEN = RUN_SECRET;
delete process.env.PDF_JOB_INLINE_WAIT_MS;

type ToolResult = { isError?: boolean; structuredContent?: Record<string, unknown> };

const rpc = async (name: string, args: Record<string, unknown>, extra: Partial<LambdaEvent> = {}) => {
  const response = await handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    ...extra,
  });
  assert.equal(response.statusCode, 200);
  return { response, result: (JSON.parse(response.body) as { result: ToolResult }).result };
};

const resetAndSeedRequest = async (requestId: string) => {
  await rm(join(LOCAL_BLOBS_ROOT, 'site-objects'), { recursive: true, force: true });
  const created = await rpc('object_create', {
    object_type: 'content_item',
    site: 'site_drlurie',
    requested_id: requestId,
    body: {
      slug: 'inline-wait-fastpath',
      title: 'Inline wait fast path fixture',
      nodes: [
        {
          id: 'n_start',
          kind: 'content',
          public: { title: 'x', body: 'y' },
          visibility: 'public',
        },
      ],
    },
  });
  assert.ok(!created.result.isError, JSON.stringify(created.result.structuredContent));
};

const referenceForRequest = (requestId: string) => ({
  blobKey: `image/${requestId}/${'a'.repeat(64)}.webp`,
  sha256: 'a'.repeat(64),
  sizeBytes: 12345,
  contentType: 'image/webp',
  artifactKind: 'image',
  originalFilename: 'inline.webp',
});

const withMockedFetch = async <T>(routes: Record<string, PdfToolMcpRoute>, run: () => Promise<T>): Promise<T> => {
  const originalFetch = globalThis.fetch;
  const { fetchImpl } = stubPdfToolMcp(routes);
  globalThis.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
};

// ── resolveArtifactJobInlineWaitBudgetMs — the same "never wait past what the
//    invocation could still deliver" cap resolveReleaseWaitBudgetSeconds
//    already applies to release_to_production. ──

test('inline wait budget defaults to 10s when the invocation deadline is unknown', () => {
  assert.equal(resolveArtifactJobInlineWaitBudgetMs(undefined, 1_000_000, {}), 10_000);
});

test('inline wait budget honors the PDF_JOB_INLINE_WAIT_MS override when it fits the invocation budget', () => {
  const now = 1_000_000;
  assert.equal(resolveArtifactJobInlineWaitBudgetMs(now + 26_000, now, { PDF_JOB_INLINE_WAIT_MS: '2000' }), 2_000);
});

test('inline wait budget is capped to the remaining invocation budget minus the safety margin', () => {
  const now = 1_000_000;
  // 3s remaining - 1.5s margin = 1.5s, well under the 10s default.
  assert.equal(resolveArtifactJobInlineWaitBudgetMs(now + 3_000, now, {}), 1_500);
  // An override bigger than the remaining budget is still capped down.
  assert.equal(resolveArtifactJobInlineWaitBudgetMs(now + 3_000, now, { PDF_JOB_INLINE_WAIT_MS: '50000' }), 1_500);
});

test('inline wait budget floors at zero (skip the wait) rather than forcing a minimum', () => {
  const now = 1_000_000;
  assert.equal(resolveArtifactJobInlineWaitBudgetMs(now + 1_000, now, {}), 0);
  assert.equal(resolveArtifactJobInlineWaitBudgetMs(now - 5_000, now, {}), 0);
});

// ── create_agent_artifact_job inline fast path (end to end) ────────────────────

test('a job that completes within budget comes back inline, with jobId + polling still present', async () => {
  const requestId = 'req_agent_inline_fastpath_complete_20260806_01';
  await resetAndSeedRequest(requestId);
  const reference = referenceForRequest(requestId);
  let statusCalls = 0;

  await withMockedFetch(
    {
      create_agent_artifact_job: (body) => ({
        status: 202,
        body: {
          jobId: 'job-fast',
          status: 'pending',
          projectId: body.projectId,
          requestId: body.requestId,
          artifactKind: body.artifactKind,
        },
      }),
      get_agent_artifact_job_status: (body) => {
        statusCalls += 1;
        // First poll still running, second poll (well within the ~1s job
        // completion window and the 10s default budget) reports complete.
        if (statusCalls === 1) {
          return { body: { jobId: 'job-fast', status: 'pending', projectId: body.projectId, requestId } };
        }
        return {
          body: {
            jobId: 'job-fast',
            status: 'complete',
            projectId: body.projectId,
            requestId,
            artifactKind: 'image',
            artifactReference: reference,
            materializationProof: PROOF_SECRET,
          },
        };
      },
      verify_agent_artifact: (body) => ({
        body: {
          verified: true,
          projectId: body.projectId,
          requestId: body.requestId,
          artifactReference: body.artifactReference,
          materializationProof: `${PROOF_SECRET}-rotated`,
        },
      }),
    },
    async () => {
      const created = await rpc('create_agent_artifact_job', {
        site_id: 'site_drlurie',
        request_id: requestId,
        artifact_kind: 'image',
        operation: 'generate',
        prompt: 'editorial image',
        filename: 'inline.webp',
      });

      assert.ok(!created.result.isError, JSON.stringify(created.result.structuredContent));
      // Same "today" fields a fire-and-forget caller depends on.
      assert.equal(created.result.structuredContent?.jobId, 'job-fast');
      assert.deepEqual((created.result.structuredContent?.polling as { input: unknown })?.input, {
        site_id: 'site_drlurie',
        request_id: requestId,
        job_id: 'job-fast',
      });
      // Plus the completed artifact, inline, from the single create call.
      assert.equal(created.result.structuredContent?.status, 'complete');
      assert.equal(created.result.structuredContent?.verified, true);
      assert.deepEqual(created.result.structuredContent?.artifactReference, reference);
      assert.equal(created.result.structuredContent?.public_path, `/img/${requestId}/${reference.sha256}.webp`);
      assert.ok(statusCalls >= 1, 'the create call must have polled pdf-tool status internally');
    }
  );
});

test('a job still running when the wait budget expires returns the unchanged 202 shape', async () => {
  const requestId = 'req_agent_inline_fastpath_timeout_20260806_01';
  await resetAndSeedRequest(requestId);
  const previousBudget = process.env.PDF_JOB_INLINE_WAIT_MS;
  // Keep this test fast: a short override budget instead of the 10s default.
  process.env.PDF_JOB_INLINE_WAIT_MS = '900';
  let statusCalls = 0;

  try {
    await withMockedFetch(
      {
        create_agent_artifact_job: (body) => ({
          status: 202,
          body: {
            jobId: 'job-slow',
            status: 'pending',
            projectId: body.projectId,
            requestId: body.requestId,
            artifactKind: body.artifactKind,
          },
        }),
        get_agent_artifact_job_status: (body) => {
          statusCalls += 1;
          return { body: { jobId: 'job-slow', status: 'pending', projectId: body.projectId, requestId } };
        },
      },
      async () => {
        const created = await rpc('create_agent_artifact_job', {
          site_id: 'site_drlurie',
          request_id: requestId,
          artifact_kind: 'image',
          operation: 'generate',
          prompt: 'editorial image',
          filename: 'inline.webp',
        });

        assert.ok(!created.result.isError, JSON.stringify(created.result.structuredContent));
        assert.equal(created.result.structuredContent?.jobId, 'job-slow');
        assert.equal(created.result.structuredContent?.status, 'pending');
        assert.ok(created.result.structuredContent?.polling, 'polling instructions must still be present');
        assert.equal(created.result.structuredContent?.artifactReference, undefined);
        assert.equal(created.result.structuredContent?.verified, undefined);
        assert.ok(statusCalls >= 1, 'must have polled at least once before giving up');
      }
    );
  } finally {
    if (previousBudget === undefined) delete process.env.PDF_JOB_INLINE_WAIT_MS;
    else process.env.PDF_JOB_INLINE_WAIT_MS = previousBudget;
  }
});

test('a job that fails during the internal wait surfaces the failure, not a pending/202 shape', async () => {
  const requestId = 'req_agent_inline_fastpath_failed_20260806_01';
  await resetAndSeedRequest(requestId);
  let statusCalls = 0;

  await withMockedFetch(
    {
      create_agent_artifact_job: (body) => ({
        status: 202,
        body: {
          jobId: 'job-failed',
          status: 'pending',
          projectId: body.projectId,
          requestId: body.requestId,
          artifactKind: body.artifactKind,
        },
      }),
      get_agent_artifact_job_status: (body) => {
        statusCalls += 1;
        if (statusCalls === 1) {
          return { body: { jobId: 'job-failed', status: 'pending', projectId: body.projectId, requestId } };
        }
        return {
          body: {
            jobId: 'job-failed',
            status: 'failed',
            projectId: body.projectId,
            requestId,
            error: 'pdf-tool render worker crashed',
          },
        };
      },
    },
    async () => {
      const created = await rpc('create_agent_artifact_job', {
        site_id: 'site_drlurie',
        request_id: requestId,
        artifact_kind: 'image',
        operation: 'generate',
        prompt: 'editorial image',
        filename: 'inline.webp',
      });

      // The failure must be visible directly in this response's structured
      // content -- not masked as a still-pending 202.
      assert.equal(created.result.structuredContent?.status, 'failed');
      assert.equal(created.result.structuredContent?.error, 'pdf-tool render worker crashed');
      assert.notEqual(created.result.structuredContent?.status, 'pending');
      assert.equal(created.result.structuredContent?.artifactReference, undefined);
      // jobId + polling stay present so an existing polling caller does not break.
      assert.equal(created.result.structuredContent?.jobId, 'job-failed');
      assert.ok(created.result.structuredContent?.polling, 'polling instructions must still be present');
    }
  );
});

test('wait:false returns the fire-and-forget response immediately with zero internal poll calls', async () => {
  const requestId = 'req_agent_inline_fastpath_optout_20260806_01';
  await resetAndSeedRequest(requestId);
  let statusCalls = 0;

  await withMockedFetch(
    {
      create_agent_artifact_job: (body) => ({
        status: 202,
        body: {
          jobId: 'job-optout',
          status: 'pending',
          projectId: body.projectId,
          requestId: body.requestId,
          artifactKind: body.artifactKind,
        },
      }),
      get_agent_artifact_job_status: (body) => {
        statusCalls += 1;
        return {
          body: {
            jobId: 'job-optout',
            status: 'complete',
            projectId: body.projectId,
            requestId,
            artifactKind: 'image',
            artifactReference: referenceForRequest(requestId),
            materializationProof: PROOF_SECRET,
          },
        };
      },
    },
    async () => {
      const created = await rpc('create_agent_artifact_job', {
        site_id: 'site_drlurie',
        request_id: requestId,
        artifact_kind: 'image',
        operation: 'generate',
        prompt: 'editorial image',
        filename: 'inline.webp',
        wait: false,
      });

      assert.ok(!created.result.isError, JSON.stringify(created.result.structuredContent));
      assert.equal(created.result.structuredContent?.jobId, 'job-optout');
      assert.equal(created.result.structuredContent?.status, 'pending');
      assert.ok(created.result.structuredContent?.polling, 'polling instructions must still be present');
      assert.equal(created.result.structuredContent?.artifactReference, undefined);
      assert.equal(statusCalls, 0, 'wait:false must not poll pdf-tool status at all');
    }
  );
});

test('the internal wait stops polling early when the remaining invocation budget is short', async () => {
  const requestId = 'req_agent_inline_fastpath_shortbudget_20260806_01';
  await resetAndSeedRequest(requestId);
  let statusCallsShortBudget = 0;

  await withMockedFetch(
    {
      create_agent_artifact_job: (body) => ({
        status: 202,
        body: {
          jobId: 'job-shortbudget',
          status: 'pending',
          projectId: body.projectId,
          requestId: body.requestId,
          artifactKind: body.artifactKind,
        },
      }),
      get_agent_artifact_job_status: (body) => {
        statusCallsShortBudget += 1;
        // Never completes -- the only way this resolves quickly is by
        // respecting the (short) remaining invocation budget.
        return { body: { jobId: 'job-shortbudget', status: 'pending', projectId: body.projectId, requestId } };
      },
    },
    async () => {
      const created = await rpc(
        'create_agent_artifact_job',
        {
          site_id: 'site_drlurie',
          request_id: requestId,
          artifact_kind: 'image',
          operation: 'generate',
          prompt: 'editorial image',
          filename: 'inline.webp',
        },
        // Deadline so close that (budget - safety margin) rounds down to 0:
        // the inline wait must be skipped entirely rather than polling.
        { invocationDeadlineMs: Date.now() + 900 }
      );

      assert.ok(!created.result.isError, JSON.stringify(created.result.structuredContent));
      assert.equal(created.result.structuredContent?.status, 'pending');
      assert.equal(statusCallsShortBudget, 0, 'a near-exhausted invocation budget must skip the inline wait');
    }
  );

  // Contrast against a comfortable (but still test-fast) explicit budget:
  // at least one poll must happen when the remaining budget allows it.
  const requestId2 = 'req_agent_inline_fastpath_shortbudget_control_20260806_01';
  await resetAndSeedRequest(requestId2);
  let statusCallsControl = 0;

  await withMockedFetch(
    {
      create_agent_artifact_job: (body) => ({
        status: 202,
        body: {
          jobId: 'job-control',
          status: 'pending',
          projectId: body.projectId,
          requestId: body.requestId,
          artifactKind: body.artifactKind,
        },
      }),
      get_agent_artifact_job_status: (body) => {
        statusCallsControl += 1;
        return {
          body: {
            jobId: 'job-control',
            status: 'pending',
            projectId: body.projectId,
            requestId: requestId2,
          },
        };
      },
    },
    async () => {
      await rpc(
        'create_agent_artifact_job',
        {
          site_id: 'site_drlurie',
          request_id: requestId2,
          artifact_kind: 'image',
          operation: 'generate',
          prompt: 'editorial image',
          filename: 'inline.webp',
        },
        { invocationDeadlineMs: Date.now() + 2_400 }
      );
    }
  );

  assert.ok(
    statusCallsControl > statusCallsShortBudget,
    `expected more polls with a comfortable budget (${statusCallsControl}) than with a near-exhausted one (${statusCallsShortBudget})`
  );
});
