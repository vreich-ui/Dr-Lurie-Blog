import assert from 'node:assert/strict';
import test from 'node:test';

import { handler } from '../../netlify/functions/mcp.js';

type RpcBody = {
  result?: Record<string, unknown>;
  error?: { data?: { reason?: string } };
};

const previousMcpHttpAuthToken = process.env.MCP_HTTP_AUTH_TOKEN;

test.afterEach(() => {
  if (previousMcpHttpAuthToken === undefined) {
    delete process.env.MCP_HTTP_AUTH_TOKEN;
  } else {
    process.env.MCP_HTTP_AUTH_TOKEN = previousMcpHttpAuthToken;
  }
});

const mcpRequest = async (method: string, headers: Record<string, string> = {}) => {
  const logs: Array<Record<string, unknown>> = [];
  const response = await handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method }),
    log: (payload) => logs.push(payload),
  });

  return {
    response,
    body: JSON.parse(response.body) as RpcBody,
    logs,
  };
};

test('MCP_HTTP_AUTH_TOKEN unset allows initialize', async () => {
  delete process.env.MCP_HTTP_AUTH_TOKEN;

  const { response, body } = await mcpRequest('initialize');

  assert.equal(response.statusCode, 200);
  assert.equal((body.result?.serverInfo as { name?: string } | undefined)?.name, 'Dr_Lurie_MCP_Server');
});

test('MCP_HTTP_AUTH_TOKEN set without Authorization returns 401 with safe diagnostic data', async () => {
  process.env.MCP_HTTP_AUTH_TOKEN = 'expected-token';

  const { response, body, logs } = await mcpRequest('initialize');

  assert.equal(response.statusCode, 401);
  assert.equal(body.error?.data?.reason, 'mcp_auth_missing_authorization');
  assert.equal(JSON.stringify(body), JSON.stringify(JSON.parse(response.body)));
  assert.doesNotMatch(response.body, /expected-token/);

  const authLog = logs.find((log) => log.event === 'mcp_auth_rejected');
  assert.deepEqual(authLog, {
    event: 'mcp_auth_rejected',
    rpcMethod: null,
    slug: null,
    hasMcpHttpAuthToken: true,
    hasMcpAuthTokenHeader: false,
    hasAuthorizationHeader: false,
    reason: 'mcp_auth_missing_authorization',
  });
});

test('wrong bearer token returns 401 with safe diagnostic data', async () => {
  process.env.MCP_HTTP_AUTH_TOKEN = 'expected-token';

  const { response, body, logs } = await mcpRequest('initialize', { authorization: 'Bearer wrong-token' });

  assert.equal(response.statusCode, 401);
  assert.equal(body.error?.data?.reason, 'mcp_auth_invalid_authorization');
  assert.doesNotMatch(response.body, /expected-token|wrong-token/);

  const authLog = logs.find((log) => log.event === 'mcp_auth_rejected');
  assert.equal(authLog?.hasMcpHttpAuthToken, true);
  assert.equal(authLog?.hasMcpAuthTokenHeader, false);
  assert.equal(authLog?.hasAuthorizationHeader, true);
  assert.equal(authLog?.reason, 'mcp_auth_invalid_authorization');
  assert.equal(JSON.stringify(authLog).includes('expected-token'), false);
  assert.equal(JSON.stringify(authLog).includes('wrong-token'), false);
});

test('correct x-mcp-auth-token allows initialize and tools/list', async () => {
  process.env.MCP_HTTP_AUTH_TOKEN = 'expected-token';

  const initialize = await mcpRequest('initialize', { 'x-mcp-auth-token': 'expected-token' });
  assert.equal(initialize.response.statusCode, 200);
  assert.equal((initialize.body.result?.serverInfo as { name?: string } | undefined)?.name, 'Dr_Lurie_MCP_Server');

  const toolsList = await mcpRequest('tools/list', { 'x-mcp-auth-token': 'expected-token' });
  assert.equal(toolsList.response.statusCode, 200);
  assert.ok(Array.isArray(toolsList.body.result?.tools));
});

test('correct bearer token allows initialize and tools/list for backward compatibility', async () => {
  process.env.MCP_HTTP_AUTH_TOKEN = 'expected-token';

  const initialize = await mcpRequest('initialize', { authorization: 'Bearer expected-token' });
  assert.equal(initialize.response.statusCode, 200);
  assert.equal((initialize.body.result?.serverInfo as { name?: string } | undefined)?.name, 'Dr_Lurie_MCP_Server');

  const toolsList = await mcpRequest('tools/list', { authorization: 'Bearer expected-token' });
  assert.equal(toolsList.response.statusCode, 200);
  assert.ok(Array.isArray(toolsList.body.result?.tools));
});

test('wrong x-mcp-auth-token returns 401 with safe diagnostic data', async () => {
  process.env.MCP_HTTP_AUTH_TOKEN = 'expected-token';

  const { response, body, logs } = await mcpRequest('initialize', { 'x-mcp-auth-token': 'wrong-token' });

  assert.equal(response.statusCode, 401);
  assert.equal(body.error?.data?.reason, 'mcp_auth_invalid_authorization');
  assert.doesNotMatch(response.body, /expected-token|wrong-token/);

  const authLog = logs.find((log) => log.event === 'mcp_auth_rejected');
  assert.equal(authLog?.hasMcpHttpAuthToken, true);
  assert.equal(authLog?.hasMcpAuthTokenHeader, true);
  assert.equal(authLog?.hasAuthorizationHeader, false);
  assert.equal(authLog?.reason, 'mcp_auth_invalid_authorization');
  assert.equal(JSON.stringify(authLog).includes('expected-token'), false);
  assert.equal(JSON.stringify(authLog).includes('wrong-token'), false);
});
