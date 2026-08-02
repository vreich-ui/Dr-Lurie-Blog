import '../../sites/drlurie/config/policy-bindings.js'; // W11 T11.2: register providers for tests hitting active*/getSiteIdentity
import assert from 'node:assert/strict';
import test from 'node:test';

import { handler } from '../../netlify/functions/mcp.js';
import {
  buildPdfToolStorageGrant,
  pdfToolStorageGrantTtlMs,
  pdfToolStorageStores,
} from '../../packages/core/server/lib/pdf-tool-storage-grant.js';
import { activeMediaPolicy, mediaPolicyLimits } from '../../packages/core/lib/media-policy.js';

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

const callRemovedGrantTool = async () => {
  const logs: Array<Record<string, unknown>> = [];
  const response = await handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
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

test('buildPdfToolStorageGrant returns the exact internal grant contract when configured', async () => {
  await withGrantEnv(
    { PDF_TOOL_STORAGE_TOKEN: 'nfp_test_machine_pat', PDF_TOOL_STORAGE_SITE_ID: 'site-api-id-1234' },
    async () => {
      const before = Date.now();
      const built = buildPdfToolStorageGrant();
      const after = Date.now();

      assert.ok(built.ok);
      const grant = built.grant as unknown as Record<string, unknown>;
      assert.equal(grant.grantVersion, 1);
      assert.equal(grant.grantType, 'netlify-pat');
      assert.equal(grant.projectId, 'dr-lurie');
      assert.equal(grant.siteId, 'site-api-id-1234');
      assert.equal(grant.token, 'nfp_test_machine_pat');
      assert.deepEqual(grant.stores, CONTRACT_STORES);
      assert.deepEqual(grant.limits, mediaPolicyLimits(activeMediaPolicy()));

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
        'limits',
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

test('buildPdfToolStorageGrant fails closed with a named error when env vars are missing', async () => {
  const cases: Array<Partial<Record<(typeof GRANT_ENV_VARS)[number], string>>> = [
    {},
    { PDF_TOOL_STORAGE_TOKEN: 'tok' },
    { PDF_TOOL_STORAGE_SITE_ID: 'site' },
  ];

  for (const env of cases) {
    await withGrantEnv(env, async () => {
      const built = buildPdfToolStorageGrant();

      assert.equal(built.ok, false);
      if (built.ok) return;
      assert.equal(built.errorCode, 'pdf_tool_storage_grant_not_configured');
      assert.match(built.error, /PDF_TOOL_STORAGE_/);
    });
  }
});

test('the removed raw grant RPC cannot return a storage token even when its name is guessed', async () => {
  const secret = 'nfp_super_secret_value_do_not_log';

  await withGrantEnv({ PDF_TOOL_STORAGE_TOKEN: secret, PDF_TOOL_STORAGE_SITE_ID: 'site-api-id-1234' }, async () => {
    const { response, logs } = await callRemovedGrantTool();

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Unknown tool/);
    assert.ok(!response.body.includes(secret), 'the removed route must never return the storage token');
    assert.ok(!JSON.stringify(logs).includes(secret), 'the removed route must never log the storage token');
  });
});

test('tools/list does not advertise the removed raw pdf-tool storage grant', async () => {
  const response = await handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  const body = JSON.parse(response.body) as {
    result: { tools: Array<{ name: string; description: string; inputSchema: { required?: string[] } }> };
  };
  const tool = body.result.tools.find((candidate) => candidate.name === 'get_pdf_tool_storage_grant');

  assert.equal(tool, undefined);
});
