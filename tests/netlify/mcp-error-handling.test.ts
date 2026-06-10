import assert from 'node:assert/strict';
import test from 'node:test';

import { handler } from '../../netlify/functions/mcp.js';
import { setNetlifyBlobsModuleForTesting } from '../../netlify/lib/blob-store.js';

test('MCP handler reports parse errors only for request body parsing failures', async () => {
  const response = await handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not json',
  });
  const body = JSON.parse(response.body) as { error: { code: number; message: string } };

  assert.equal(response.statusCode, 400);
  assert.equal(body.error.code, -32700);
  assert.equal(body.error.message, 'Parse error');
});

test('MCP handler returns a server error when request handling fails after parsing', async () => {
  const previousNetlify = process.env.NETLIFY;
  const previousConsoleError = console.error;

  process.env.NETLIFY = 'true';
  console.error = () => {};
  setNetlifyBlobsModuleForTesting({
    connectLambda() {},
    getStore() {
      return {
        async set() {},
        async setJSON() {},
        async get() {
          return null;
        },
        async del() {},
        async list() {
          throw new Error('simulated artifact index failure');
        },
      };
    },
  });

  try {
    const response = await handler({
      httpMethod: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list_artifacts_for_request', arguments: { requestId: 'request-with-store-failure' } },
      }),
    });
    const body = JSON.parse(response.body) as { error: { code: number; message: string } };

    assert.equal(response.statusCode, 500);
    assert.equal(body.error.code, -32000);
    assert.equal(body.error.message, 'Internal server error');
  } finally {
    setNetlifyBlobsModuleForTesting(undefined);
    console.error = previousConsoleError;

    if (previousNetlify === undefined) delete process.env.NETLIFY;
    else process.env.NETLIFY = previousNetlify;
  }
});

test('admin artifact browsing and reconciliation MCP tools require admin authentication', async () => {
  const previousClerkSecret = process.env.CLERK_SECRET_KEY;
  delete process.env.CLERK_SECRET_KEY;

  try {
    const response = await handler({
      httpMethod: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'soft_delete_artifact', arguments: { requestId: 'request', sha256: 'a'.repeat(64) } },
      }),
    });
    const body = JSON.parse(response.body) as {
      result: { isError: boolean; structuredContent: { error: string } };
    };

    assert.equal(response.statusCode, 200);
    assert.equal(body.result.isError, true);
    assert.match(body.result.structuredContent.error, /Clerk session token|required/i);
  } finally {
    if (previousClerkSecret === undefined) delete process.env.CLERK_SECRET_KEY;
    else process.env.CLERK_SECRET_KEY = previousClerkSecret;
  }
});

test('MCP tools/call preserves structured tool errors from save-json-blob JSON responses', async () => {
  const previousPublishSecret = process.env.NETLIFY_PUBLISH_SECRET;
  const previousFallbackSecret = process.env.PUBLISH_SECRET;
  const previousNetlify = process.env.NETLIFY;
  const previousSiteId = process.env.NETLIFY_SITE_ID;

  process.env.NETLIFY_PUBLISH_SECRET = 'mcp-error-handling-secret';
  process.env.PUBLISH_SECRET = 'mcp-error-handling-secret';
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  try {
    const response = await handler({
      httpMethod: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'save_json_blob_create_request',
          arguments: { request_id: 'mcp-error-handling-missing-input' },
        },
      }),
    });
    const body = JSON.parse(response.body) as {
      result: { isError?: boolean; structuredContent?: Record<string, unknown> };
      error?: unknown;
    };

    assert.equal(response.statusCode, 200);
    assert.equal(body.error, undefined);
    assert.equal(body.result.isError, true);
    assert.equal(body.result.structuredContent?.statusCode, 400);
    assert.equal(body.result.structuredContent?.action, 'create_request');
    assert.equal(typeof body.result.structuredContent?.error, 'string');
  } finally {
    if (previousPublishSecret === undefined) delete process.env.NETLIFY_PUBLISH_SECRET;
    else process.env.NETLIFY_PUBLISH_SECRET = previousPublishSecret;

    if (previousFallbackSecret === undefined) delete process.env.PUBLISH_SECRET;
    else process.env.PUBLISH_SECRET = previousFallbackSecret;

    if (previousNetlify === undefined) delete process.env.NETLIFY;
    else process.env.NETLIFY = previousNetlify;

    if (previousSiteId === undefined) delete process.env.NETLIFY_SITE_ID;
    else process.env.NETLIFY_SITE_ID = previousSiteId;
  }
});
