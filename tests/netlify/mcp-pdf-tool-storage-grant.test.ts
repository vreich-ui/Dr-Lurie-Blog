import assert from 'node:assert/strict';
import test from 'node:test';

import { handler } from '../../netlify/functions/mcp.js';
import {
  buildPdfToolStorageGrant,
  pdfToolStorageGrantTtlMs,
  pdfToolStorageStores,
} from '../../netlify/lib/pdf-tool-storage-grant.js';

type ToolCallResult = {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};

// The exact store mapping the pdf-tool grant contract names. The lib and the
// provisioning script are each pinned to this literal so they cannot drift
// from the contract (or from each other).
const CONTRACT_STORES = {
  artifacts: 'artifacts',
  artifactIndex: 'artifact-index',
  templates: 'pdf-templates',
  imageSearch: 'image-search',
  renderData: 'pdf-render-data',
  jobs: 'pdf-tool-jobs',
};

const GRANT_ENV_VARS = ['PDF_TOOL_STORAGE_TOKEN', 'PDF_TOOL_STORAGE_SITE_ID'] as const;

const withGrantEnv = async (
  values: Partial<Record<(typeof GRANT_ENV_VARS)[number], string>>,
  fn: () => Promise<void>
) => {
  const previous = Object.fromEntries(GRANT_ENV_VARS.map((name) => [name, process.env[name]]));

  for (const name of GRANT_ENV_VARS) {
    if (values[name] === undefined) delete process.env[name];
    else process.env[name] = values[name];
  }

  try {
    await fn();
  } finally {
    for (const name of GRANT_ENV_VARS) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
};

const callGrantTool = async (headers: Record<string, string> = {}) => {
  const logs: Array<Record<string, unknown>> = [];
  const response = await handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_pdf_tool_storage_grant', arguments: {} },
    }),
    log: (payload) => logs.push(payload),
  });

  return { response, logs };
};

test('get_pdf_tool_storage_grant returns the exact grant contract when configured', async () => {
  await withGrantEnv(
    { PDF_TOOL_STORAGE_TOKEN: 'nfp_test_machine_pat', PDF_TOOL_STORAGE_SITE_ID: 'site-api-id-1234' },
    async () => {
      const before = Date.now();
      const { response } = await callGrantTool();
      const after = Date.now();

      assert.equal(response.statusCode, 200);
      const result = (JSON.parse(response.body) as { result: ToolCallResult }).result;
      assert.equal(result.isError, undefined);

      const grant = result.structuredContent as Record<string, unknown>;
      assert.equal(grant.grantVersion, 1);
      assert.equal(grant.grantType, 'netlify-pat');
      assert.equal(grant.projectId, 'dr-lurie');
      assert.equal(grant.siteId, 'site-api-id-1234');
      assert.equal(grant.token, 'nfp_test_machine_pat');
      assert.deepEqual(grant.stores, CONTRACT_STORES);

      const expiresAt = Date.parse(String(grant.expiresAt));
      assert.ok(Number.isFinite(expiresAt), `expiresAt must be an ISO timestamp; got ${String(grant.expiresAt)}`);
      assert.ok(
        expiresAt >= before + pdfToolStorageGrantTtlMs && expiresAt <= after + pdfToolStorageGrantTtlMs,
        'expiresAt must be exactly the grant TTL (1 hour) from issuance'
      );

      assert.deepEqual(Object.keys(grant).sort(), [
        'expiresAt',
        'grantType',
        'grantVersion',
        'projectId',
        'siteId',
        'stores',
        'token',
      ]);
    }
  );
});

test('the grant TTL is one hour and the lib store mapping matches the contract', () => {
  assert.equal(pdfToolStorageGrantTtlMs, 60 * 60 * 1000);
  assert.deepEqual({ ...pdfToolStorageStores }, CONTRACT_STORES);
});

test('buildPdfToolStorageGrant computes expiresAt from the provided clock', async () => {
  await withGrantEnv({ PDF_TOOL_STORAGE_TOKEN: 'tok', PDF_TOOL_STORAGE_SITE_ID: 'site' }, async () => {
    const now = new Date('2026-07-15T12:00:00.000Z');
    const built = buildPdfToolStorageGrant(now);

    assert.ok(built.ok);
    assert.equal(built.grant.expiresAt, '2026-07-15T13:00:00.000Z');
  });
});

test('get_pdf_tool_storage_grant fails closed with a named error when env vars are missing', async () => {
  const cases: Array<Partial<Record<(typeof GRANT_ENV_VARS)[number], string>>> = [
    {},
    { PDF_TOOL_STORAGE_TOKEN: 'tok' },
    { PDF_TOOL_STORAGE_SITE_ID: 'site' },
  ];

  for (const env of cases) {
    await withGrantEnv(env, async () => {
      const { response, logs } = await callGrantTool();

      assert.equal(response.statusCode, 200);
      const result = (JSON.parse(response.body) as { result: ToolCallResult }).result;
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent?.error_code, 'pdf_tool_storage_grant_not_configured');
      assert.match(String(result.structuredContent?.error), /PDF_TOOL_STORAGE_/);
      assert.doesNotMatch(response.body, /"token"\s*:/, 'a misconfigured server must never return a token field');
      assert.ok(logs.some((log) => log.event === 'pdf_tool_storage_grant_not_configured'));
    });
  }
});

test('the storage token never appears in structured logs, and issuance is logged metadata-only', async () => {
  const secret = 'nfp_super_secret_value_do_not_log';

  await withGrantEnv({ PDF_TOOL_STORAGE_TOKEN: secret, PDF_TOOL_STORAGE_SITE_ID: 'site-api-id-1234' }, async () => {
    const { response, logs } = await callGrantTool();

    assert.equal(response.statusCode, 200);
    const serializedLogs = JSON.stringify(logs);
    assert.ok(!serializedLogs.includes(secret), 'the storage token must never be logged');
    assert.ok(!serializedLogs.includes('site-api-id-1234'), 'issuance logs should not need the site id either');

    const issued = logs.find((log) => log.event === 'pdf_tool_storage_grant_issued');
    assert.ok(issued, 'a grant issuance must leave a structured log entry');
    assert.equal(issued.grantType, 'netlify-pat');
    assert.equal(typeof issued.expiresAt, 'string');
    assert.equal('token' in issued, false);
  });
});

test('get_pdf_tool_storage_grant sits behind the MCP endpoint auth gate', async () => {
  const previousMcpToken = process.env.MCP_HTTP_AUTH_TOKEN;
  process.env.MCP_HTTP_AUTH_TOKEN = 'mcp-endpoint-token';

  try {
    await withGrantEnv(
      { PDF_TOOL_STORAGE_TOKEN: 'nfp_gate_test_secret', PDF_TOOL_STORAGE_SITE_ID: 'site-api-id-1234' },
      async () => {
        const unauthorized = await callGrantTool();
        assert.equal(unauthorized.response.statusCode, 401);
        assert.ok(
          !unauthorized.response.body.includes('nfp_gate_test_secret'),
          'an unauthorized call must never receive the storage token'
        );

        const authorized = await callGrantTool({ authorization: 'Bearer mcp-endpoint-token' });
        assert.equal(authorized.response.statusCode, 200);
        const result = (JSON.parse(authorized.response.body) as { result: ToolCallResult }).result;
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.token, 'nfp_gate_test_secret');
      }
    );
  } finally {
    if (previousMcpToken === undefined) delete process.env.MCP_HTTP_AUTH_TOKEN;
    else process.env.MCP_HTTP_AUTH_TOKEN = previousMcpToken;
  }
});

test('tool description teaches the storage argument, re-fetch-on-expiry, and never-persist rules', async () => {
  const response = await handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  const body = JSON.parse(response.body) as {
    result: { tools: Array<{ name: string; description: string; inputSchema: { required?: string[] } }> };
  };
  const tool = body.result.tools.find((candidate) => candidate.name === 'get_pdf_tool_storage_grant');

  assert.ok(tool, 'expected tools/list to include get_pdf_tool_storage_grant');
  assert.match(tool!.description, /"storage" argument/);
  assert.match(tool!.description, /rejects expired grants/i);
  assert.match(tool!.description, /retry once/i);
  assert.match(tool!.description, /NEVER write the grant or its token/i);
  assert.deepEqual(tool!.inputSchema.required ?? [], [], 'the grant tool must not require any input');
});
