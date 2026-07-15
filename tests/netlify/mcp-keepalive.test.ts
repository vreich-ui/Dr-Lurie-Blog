import assert from 'node:assert/strict';
import test from 'node:test';

import { runKeepaliveProbe } from '../../netlify/functions/mcp-keepalive.js';

type RecordedRequest = { url: string; method?: string; headers?: Record<string, string>; body?: string };

const recordingFetch = (status = 200, payload: unknown = { ok: true }) => {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(url),
      method: init?.method,
      headers: init?.headers as Record<string, string> | undefined,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  return { fetchImpl, requests };
};

test('keepalive skips without probing when MCP_KEEPALIVE_DISABLED is true', async () => {
  const { fetchImpl, requests } = recordingFetch();
  const result = await runKeepaliveProbe(fetchImpl, {
    MCP_KEEPALIVE_DISABLED: 'true',
    URL: 'https://example.netlify.app',
  } as NodeJS.ProcessEnv);

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'skipped');
  assert.equal(requests.length, 0);
});

test('keepalive reports a skip (not a crash) when no target URL is configured', async () => {
  const { fetchImpl, requests } = recordingFetch();
  const result = await runKeepaliveProbe(fetchImpl, {} as NodeJS.ProcessEnv);

  assert.equal(result.ok, false);
  assert.equal(result.mode, 'skipped');
  assert.equal(requests.length, 0);
});

test('keepalive with an auth token POSTs the ping tool through the full MCP path', async () => {
  const pingPayload = {
    jsonrpc: '2.0',
    id: 'keepalive',
    result: { structuredContent: { ok: true, instance_age_ms: 123_456 } },
  };
  const { fetchImpl, requests } = recordingFetch(200, pingPayload);
  const result = await runKeepaliveProbe(fetchImpl, {
    URL: 'https://example.netlify.app/',
    MCP_HTTP_AUTH_TOKEN: 'warm-token',
  } as NodeJS.ProcessEnv);

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'ping_tool');
  assert.equal(result.httpStatus, 200);
  assert.equal(result.instanceAgeMs, 123_456);
  assert.equal(result.coldStartSuspected, false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://example.netlify.app/mcp');
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].headers?.['x-mcp-auth-token'], 'warm-token');
  assert.match(requests[0].body ?? '', /"name":"ping"/);
});

test('keepalive without an auth token uses the unauthenticated GET health probe', async () => {
  const { fetchImpl, requests } = recordingFetch(200, { ok: true, instance_age_ms: 42 });
  const result = await runKeepaliveProbe(fetchImpl, {
    URL: 'https://example.netlify.app',
  } as NodeJS.ProcessEnv);

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'health_get');
  assert.equal(result.instanceAgeMs, 42);
  assert.equal(result.coldStartSuspected, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://example.netlify.app/mcp?health=1');
  assert.equal(requests[0].method, 'GET');
});

test('keepalive reports a fetch failure as ok:false with the error message', async () => {
  const failingFetch = (async () => {
    throw new Error('socket hang up');
  }) as typeof fetch;
  const result = await runKeepaliveProbe(failingFetch, {
    URL: 'https://example.netlify.app',
  } as NodeJS.ProcessEnv);

  assert.equal(result.ok, false);
  assert.equal(result.error, 'socket hang up');
});
