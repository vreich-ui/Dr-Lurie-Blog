import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { handler as mcpHandler, _mcpInternal } from '../../netlify/functions/mcp.js';

// Reproduce the bug: when the agent's article_body has the SAME public node count
// as the input body (e.g. media added to existing nodes, no new nodes added),
// promoteAgentArticleBodyIfRicher incorrectly refuses to promote the agent body.
// The original body (no media) is used for node-media candidate scanning, so the
// artifact isn't discovered via cross-request resolution, and media: [] is returned.
describe('save_json_blob_publish_by_time agent article_body promotion (same public node count)', () => {
  process.env.NETLIFY_PUBLISH_SECRET = 'test-publish-secret';
  process.env.MCP_HTTP_AUTH_TOKEN = 'test-mcp-token';

  it('promotes agent article_body and resolves artifact when agent adds media to existing nodes (same count)', async () => {
    const requestId = 'req_blog_bodyfix_20260701_01';
    const lockToken = 'lock_same_count_abc';
    const sha256 = 'd'.repeat(64);

    // The artifact is only discoverable via the artifact index (not in output.artifactReferences).
    const artifactRef = {
      blobKey: `image/${requestId}/${sha256}.png`,
      sha256,
      contentType: 'image/png',
      sizeBytes: 300,
      createdAtISO: new Date().toISOString(),
    };

    // Input body: 2 public nodes, no media on any node.
    const inputBody = {
      schema_version: 'article_body.v1',
      nodes: [
        { id: 'node_1', kind: 'content', public: { title: 'Node 1' } },
        { id: 'node_2', kind: 'content', public: { title: 'Node 2' } },
      ],
    };

    // Agent body: same 2 public nodes, but node_1 now has media pointing at the artifact.
    // Node count is IDENTICAL to inputBody — the <= bug suppresses promotion.
    const agentBody = {
      schema_version: 'article_body.v1',
      nodes: [
        {
          id: 'node_1',
          kind: 'content',
          public: {
            title: 'Node 1',
            media: { type: 'image', src: artifactRef.blobKey },
          },
        },
        { id: 'node_2', kind: 'content', public: { title: 'Node 2' } },
      ],
    };

    const mockRecord = {
      request_id: requestId,
      input: {
        record_type: 'content_source',
        schema_version: 'content_source.v1',
        content: {
          title: 'Agent Body Promotion Test',
          article_body: inputBody,
        },
      },
      // Agent output has article_body WITH media but NO artifactReferences array,
      // so the only discovery path is node media → cross-request index lookup.
      agent_outputs: {
        final_article: {
          output: {
            article_body: agentBody,
          },
        },
      },
      lock: { token: lockToken, expires_at: new Date(Date.now() + 10000).toISOString() },
      version: 3,
    };

    mock.method(_mcpInternal, 'saveJsonBlobHandler', async (event: Record<string, unknown>) => {
      const body = JSON.parse(event.body as string);
      if (body.action === 'get_request') {
        return { statusCode: 200, body: JSON.stringify({ ok: true, record: mockRecord }) };
      }
      if (body.action === 'set_published_time') {
        return {
          statusCode: 200,
          body: JSON.stringify({
            ok: true,
            record: {
              ...mockRecord,
              input: { ...mockRecord.input, publication: { published_time: body.published_time } },
            },
          }),
        };
      }
      return { statusCode: 500, body: 'Unexpected action' };
    });

    // Artifact index: by-request listing is empty (fallback path), but the full reference
    // is available at request-artifacts/{requestId}/{sha256}.json for cross-ref resolution.
    mock.method(_mcpInternal, 'getArtifactIndexBlobStore', async () => ({
      get: async (key: string) => {
        if (key === `request-artifacts/${encodeURIComponent(requestId)}/${sha256}.json`) {
          return JSON.stringify(artifactRef);
        }
        return null;
      },
      list: async (_options: { prefix?: string } | undefined) => ({
        [Symbol.asyncIterator]: async function* () {
          yield { blobs: [] };
        },
      }),
      setJSON: async () => {},
    }));

    let capturedPublishPayload: Record<string, unknown> | null = null;
    mock.method(_mcpInternal, 'publishArticleHandler', async (event: Record<string, unknown>) => {
      capturedPublishPayload = JSON.parse(event.body as string);
      return {
        statusCode: 201,
        body: JSON.stringify({
          success: true,
          articlePath: 'src/data/post/agent-body-promotion-test.md',
          media: [`src/assets/images/uploads/agent-body-promotion-test/${sha256}.png`],
          commit: 'agent-body-commit-sha',
        }),
      };
    });

    const mcpEvent = {
      httpMethod: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.MCP_HTTP_AUTH_TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'save_json_blob_publish_by_time',
          arguments: { request_id: requestId, lock_token: lockToken },
        },
      }),
    };

    const response = await mcpHandler(mcpEvent as Record<string, unknown>);
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.ok(!body.error, `MCP Error: ${JSON.stringify(body.error)}`);

    // publish-article must have been called with the agent body's artifact
    assert.ok(capturedPublishPayload, 'publish-article must have been called');
    const payload = capturedPublishPayload as unknown as Record<string, unknown>;

    // The artifact discovered via agent body node media must appear in artifactReferences
    const artifactRefs = payload.artifactReferences as Record<string, unknown>[];
    assert.ok(Array.isArray(artifactRefs), 'artifactReferences must be an array');
    const found = artifactRefs.find((r) => r.sha256 === sha256);
    assert.ok(
      found,
      `artifact sha256=${sha256} must be in artifactReferences — agent body with same ` +
        `node count as input body must be promoted so its media nodes are scanned`
    );
    assert.equal(found.blobKey, artifactRef.blobKey);

    // article_body in payload must be the agent's version (with media on node_1)
    const articleBody = payload.article_body as Record<string, unknown>;
    const nodes = articleBody?.nodes as Record<string, unknown>[];
    assert.ok(Array.isArray(nodes), 'article_body.nodes must be an array');
    const node1 = nodes.find((n) => n.id === 'node_1');
    assert.ok(node1, 'node_1 must be present in the promoted article_body');
    const nodePublic = node1.public as Record<string, unknown>;
    const nodeMedia = nodePublic?.media as Record<string, unknown> | undefined;
    assert.ok(nodeMedia, 'node_1.public.media must be present after agent body promotion');
    assert.equal(nodeMedia.src, artifactRef.blobKey, 'node_1.public.media.src must point to the artifact');

    // MCP response must surface the publish result
    const resultText = body.result?.content?.[0]?.text;
    assert.ok(resultText, 'MCP result text must be present');
    const parsed = JSON.parse(resultText as string);
    assert.equal(parsed.status, 'published');
    assert.equal(parsed.commit_sha, 'agent-body-commit-sha');
    assert.ok(Array.isArray(parsed.media) && parsed.media.length > 0, 'media must be non-empty in MCP result');
  });
});
