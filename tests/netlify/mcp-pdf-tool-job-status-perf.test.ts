/**
 * perf/drop-verify-hop-cache-scope — end-to-end proof for get_agent_artifact_job_status:
 *
 *  1. a completing poll makes exactly ONE outbound call to pdf-tool (no more
 *     verify-agent-artifact round trip) and still returns a verified artifact
 *     backed by the status response's own materializationProof (Change 1);
 *  2. a second poll for the SAME jobId reuses the cached scope instead of
 *     re-invoking the object store, and a poll for a DIFFERENT jobId still
 *     resolves scope freshly (Change 2) — proven here by deleting the
 *     backing content_item BETWEEN polls and observing that only the
 *     never-before-seen jobId's poll notices.
 */
import '../../sites/drlurie/config/policy-bindings.js';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { handler } from '../../netlify/functions/mcp.js';
import { setLocalBlobsRootForTesting } from '../../packages/core/server/lib/local-blobs.js';

const REQUEST_ID = 'req_agent_job_status_perf_test_20260806_01';
const STORAGE_SECRET = 'storage-secret-never-expose';
const RUN_SECRET = 'run-secret-never-expose';
const PROOF_SECRET = 'proof-never-expose';
const LOCAL_BLOBS_ROOT = join(process.cwd(), '.netlify', 'local-blobs-test', 'mcp-pdf-tool-job-status-perf');
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

type ToolResult = { isError?: boolean; structuredContent?: Record<string, unknown> };

const rpc = async (name: string, args: Record<string, unknown>) => {
  const response = await handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  assert.equal(response.statusCode, 200);
  return { response, result: (JSON.parse(response.body) as { result: ToolResult }).result };
};

const seedRequest = async () => {
  await rm(join(LOCAL_BLOBS_ROOT, 'site-objects'), { recursive: true, force: true });
  await rm(join(LOCAL_BLOBS_ROOT, 'idempotency'), { recursive: true, force: true });
  const created = await rpc('object_create', {
    object_type: 'content_item',
    site: 'site_drlurie',
    requested_id: REQUEST_ID,
    body: {
      slug: 'job-status-perf-test',
      title: 'Job status perf test',
      nodes: [
        {
          id: 'n_start',
          kind: 'content',
          public: { title: 'x', body: 'x' },
          visibility: 'public',
        },
      ],
    },
  });
  assert.ok(!created.result.isError, JSON.stringify(created.result.structuredContent));
};

const wipeContentItem = () => rm(join(LOCAL_BLOBS_ROOT, 'site-objects'), { recursive: true, force: true });

const reference = {
  blobKey: `image/${REQUEST_ID}/${'a'.repeat(64)}.webp`,
  sha256: 'a'.repeat(64),
  sizeBytes: 12345,
  contentType: 'image/webp',
  artifactKind: 'image',
  originalFilename: 'article_image_1.webp',
};

test('a completing poll makes exactly ONE outbound call to pdf-tool and still returns a verified materialization proof', async () => {
  await seedRequest();
  const originalFetch = globalThis.fetch;
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ path: url.pathname, body });

    if (url.pathname.endsWith('/get-agent-artifact-job-status')) {
      return Response.json({
        jobId: body.jobId,
        status: 'complete',
        projectId: body.projectId,
        requestId: REQUEST_ID,
        artifactKind: 'image',
        artifactReference: reference,
        materializationProof: PROOF_SECRET,
      });
    }
    // A second hop (verify-agent-artifact) — or anything else — must never happen.
    return Response.json({ error: `unexpected path: ${url.pathname}` }, { status: 404 });
  }) as typeof fetch;

  try {
    const completed = await rpc('get_agent_artifact_job_status', {
      site_id: 'site_drlurie',
      request_id: REQUEST_ID,
      job_id: 'job-single-hop',
    });

    assert.ok(!completed.result.isError, JSON.stringify(completed.result.structuredContent));
    assert.equal(completed.result.structuredContent?.status, 'complete');
    assert.equal(completed.result.structuredContent?.verified, true);
    assert.equal(completed.result.structuredContent?.public_path, `/img/${REQUEST_ID}/${reference.sha256}.webp`);
    assert.deepEqual(completed.result.structuredContent?.artifactReference, reference);

    assert.equal(calls.length, 1, 'a completing poll must make exactly one outbound call to pdf-tool');
    assert.equal(calls[0]?.path, '/.netlify/functions/get-agent-artifact-job-status');
    assert.ok(
      !calls.some((call) => call.path.endsWith('/verify-agent-artifact')),
      'the redundant verify-agent-artifact hop must never be called from the status-poll path'
    );

    // The proof is consumed server-side only — it must never reach the wire.
    assert.ok(!completed.response.body.includes(PROOF_SECRET));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a second poll for the same jobId reuses the cached scope; a different jobId resolves scope freshly', async () => {
  await seedRequest();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    if (url.pathname.endsWith('/get-agent-artifact-job-status')) {
      return Response.json({
        jobId: body.jobId,
        status: 'pending',
        projectId: body.projectId,
        requestId: REQUEST_ID,
        artifactKind: 'image',
      });
    }
    return Response.json({ error: `unexpected path: ${url.pathname}` }, { status: 404 });
  }) as typeof fetch;

  try {
    const first = await rpc('get_agent_artifact_job_status', {
      site_id: 'site_drlurie',
      request_id: REQUEST_ID,
      job_id: 'job-cached',
    });
    assert.ok(!first.result.isError, JSON.stringify(first.result.structuredContent));

    // Pull the rug out from under a LIVE scope resolution: the content_item
    // this request_id used to map to no longer exists.
    await wipeContentItem();

    const secondSameJob = await rpc('get_agent_artifact_job_status', {
      site_id: 'site_drlurie',
      request_id: REQUEST_ID,
      job_id: 'job-cached',
    });
    assert.ok(
      !secondSameJob.result.isError,
      'a poll for the SAME jobId must be served from the cached scope, not a fresh (now-failing) object-store check'
    );
    assert.equal(secondSameJob.result.structuredContent?.status, 'pending');

    const differentJob = await rpc('get_agent_artifact_job_status', {
      site_id: 'site_drlurie',
      request_id: REQUEST_ID,
      job_id: 'job-never-cached',
    });
    assert.equal(
      differentJob.result.isError,
      true,
      "a DIFFERENT jobId must never inherit another job's cached scope — it must resolve scope freshly and see the deletion"
    );
    assert.equal(differentJob.result.structuredContent?.error_code, 'artifact_request_not_found');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
