import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { handler as mcpHandler, _mcpInternal } from '../../netlify/functions/mcp.js';

describe('save_json_blob_publish_by_time media promotion', () => {
  const publishSecret = 'test-publish-secret';
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.MCP_HTTP_AUTH_TOKEN = 'test-mcp-token';

  it('promotes images from article_body, image_sets, and artifactReferences to publish payload', async () => {
    const requestId = 'req_test_media_promotion';
    const lockToken = 'lock_test_123';
    const sha256_ref = 'a'.repeat(64);
    const sha256_final = 'b'.repeat(64);

    // 1. Mock save-json-blob get_request to return a workflow record
    const mockRecord = {
      request_id: requestId,
      input: {
        record_type: 'content_source',
        schema_version: 'content_source.v1',
        content: {
          title: 'Test Media Promotion',
          article_body: {
            schema_version: 'article_body.v1',
            nodes: [
              {
                id: 'n_1',
                kind: 'content',
                public: {
                  title: 'Hero Node',
                  media: { type: 'image', src: 'https://example.com/node-hero.jpg' }
                },
                rendering: { presentation: 'hero' }
              }
            ]
          }
        },
        media: {
          image_asset_register: [
            {
              asset_id: 'asset_1',
              url: 'https://example.com/asset-regular.jpg'
            },
            {
              asset_id: 'asset_hero',
              url: 'https://example.com/asset-hero.jpg',
              metadata: { purpose: 'hero' }
            }
          ],
          image_sets: [
            {
              set_id: 'set_hero',
              asset_ids: ['asset_1'],
              metadata: { purpose: 'hero' }
            }
          ]
        }
      },
      agent_outputs: {
        final_article: {
          output: {
            artifactReferences: [
              {
                blobKey: `image/${requestId}/${sha256_final}.png`,
                sha256: sha256_final,
                contentType: 'image/png',
                sizeBytes: 200,
                createdAtISO: new Date().toISOString()
              }
            ]
          }
        }
      },
      lock: { token: lockToken, expires_at: new Date(Date.now() + 10000).toISOString() },
      version: 5
    };

    mock.method(_mcpInternal, 'saveJsonBlobHandler', async (event: Record<string, unknown>) => {
      const body = JSON.parse(event.body as string);
      if (body.action === 'get_request') {
        return { statusCode: 200, body: JSON.stringify({ ok: true, record: mockRecord }) };
      }
      if (body.action === 'set_published_time') {
        return { statusCode: 200, body: JSON.stringify({ ok: true, record: { ...mockRecord, input: { ...mockRecord.input, publication: { published_time: body.published_time } } } }) };
      }
      return { statusCode: 500, body: 'Unexpected action' };
    });

    // 2. Mock artifact index
    const mockArtifactRef = {
      blobKey: `image/${requestId}/${sha256_ref}.png`,
      sha256: sha256_ref,
      contentType: 'image/png',
      sizeBytes: 100,
      createdAtISO: new Date().toISOString()
    };

    mock.method(_mcpInternal, 'getArtifactIndexBlobStore', async () => ({
       get: async (key: string) => {
         if (key.includes(sha256_ref)) return JSON.stringify(mockArtifactRef);
         if (key.includes('pointer')) return JSON.stringify({ requestId, sha256: sha256_ref });
         return null;
       },
       list: async (options: { prefix?: string } | undefined) => {
         return {
           [Symbol.asyncIterator]: async function* () {
             if (options?.prefix?.includes('by-request/')) {
               yield { blobs: [{ key: `by-request/${encodeURIComponent(requestId)}/image/pointer.json` }] };
             } else {
               yield { blobs: [] };
             }
           }
         };
       },
       setJSON: async () => {}
    }));

    // Let's mock publish-article and check its input.
    let capturedPublishPayload: Record<string, unknown> | null = null;
    mock.method(_mcpInternal, 'publishArticleHandler', async (event: Record<string, unknown>) => {
      capturedPublishPayload = JSON.parse(event.body as string);
      return {
        statusCode: 201,
        body: JSON.stringify({
          success: true,
          articlePath: 'src/data/post/test-media-promotion.md',
          media: ['src/assets/images/uploads/test-media-promotion/ref.png'],
          commit: 'new-commit-sha'
        })
      };
    });

    const event = {
      httpMethod: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${process.env.MCP_HTTP_AUTH_TOKEN}`
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'save_json_blob_publish_by_time',
          arguments: {
            request_id: requestId,
            lock_token: lockToken
          }
        }
      })
    };

    const response = await mcpHandler(event as Record<string, unknown>);
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.ok(!body.error, `MCP Error: ${JSON.stringify(body.error)}`);

    // Verify the captured publish payload has the promoted images
    assert.ok(capturedPublishPayload);
    const payload = capturedPublishPayload as unknown as Record<string, unknown>;
    // Priority check:
    // set_hero (points to asset_1) has priority 12.
    // asset_hero has priority 10.
    // node-hero.jpg has priority 10.
    // asset-regular has priority 5.
    // Win: asset_1 path (https://example.com/asset-regular.jpg)
    assert.equal(payload.featuredImage, 'https://example.com/asset-regular.jpg');

    // Artifact references should include both from index and from final_article output
    const artifactRefs = payload.artifactReferences as Record<string, unknown>[];
    assert.equal(artifactRefs.length, 2);
    const shas = artifactRefs.map((r: Record<string, unknown>) => r.sha256);
    assert.ok((shas as unknown[]).includes(sha256_ref));
    assert.ok((shas as unknown[]).includes(sha256_final));
  });
});
