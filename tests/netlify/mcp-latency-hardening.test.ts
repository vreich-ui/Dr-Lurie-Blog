import assert from 'node:assert/strict';
import test from 'node:test';

import { handler, _mcpInternal } from '../../netlify/functions/mcp.js';

const { resolveReleaseWaitBudgetSeconds } = _mcpInternal;

// ── release_to_production wait budget ──────────────────────────────────────
// The deploy poll must never outlive the serverless invocation: a killed
// function surfaces to the agent as a dropped connection, not JSON-RPC.

test('release wait falls back to a sub-10s budget when the invocation deadline is unknown', () => {
  assert.equal(resolveReleaseWaitBudgetSeconds(undefined, undefined), 6);
});

test('release wait is capped to the remaining invocation budget minus the safety margin', () => {
  const now = 1_000_000;
  // 26s remaining (raised Netlify timeout) - 3.5s margin = 22.5s → floor 22s.
  assert.equal(resolveReleaseWaitBudgetSeconds(undefined, now + 26_000, now), 22);
  // The lib's old 120s default must never survive a 10s invocation budget.
  assert.equal(resolveReleaseWaitBudgetSeconds(120, now + 10_000, now), 6);
});

test('release wait keeps an explicit request when it already fits the budget', () => {
  const now = 1_000_000;
  assert.equal(resolveReleaseWaitBudgetSeconds(4, now + 26_000, now), 4);
});

test('release wait never drops below one second even with an exhausted budget', () => {
  const now = 1_000_000;
  assert.equal(resolveReleaseWaitBudgetSeconds(undefined, now + 1_000, now), 1);
  assert.equal(resolveReleaseWaitBudgetSeconds(30, now - 5_000, now), 1);
});

// ── liveness surfaces ──────────────────────────────────────────────────────

test('GET /mcp?health=1 answers 200 with non-sensitive instance diagnostics, no auth required', async () => {
  const response = await handler({
    httpMethod: 'GET',
    headers: {},
    queryStringParameters: { health: '1' },
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as Record<string, unknown>;
  assert.equal(body.ok, true);
  assert.equal(body.server, 'Dr_Lurie_Science_MCP');
  assert.equal(typeof body.instance_age_ms, 'number');
  assert.equal(typeof body.instance_invocations, 'number');
});

test('plain GET /mcp (no health param) still returns 405 per the Streamable HTTP spec', async () => {
  const response = await handler({ httpMethod: 'GET', headers: {} });

  assert.equal(response.statusCode, 405);
});

test('ping tool result carries the additive instance diagnostics', async () => {
  const response = await handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'ping', arguments: {} },
    }),
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as {
    result: { structuredContent: Record<string, unknown> };
  };
  assert.equal(body.result.structuredContent.ok, true);
  assert.equal(body.result.structuredContent.server, 'Dr_Lurie_Science_MCP');
  assert.equal(typeof body.result.structuredContent.instance_age_ms, 'number');
  assert.equal(typeof body.result.structuredContent.instance_invocations, 'number');
});
