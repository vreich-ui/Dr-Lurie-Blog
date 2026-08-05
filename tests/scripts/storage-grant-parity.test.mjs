/**
 * Tests for the storage-grant parity machinery (packages/core/cli/
 * create-site.mjs: checkStorageGrantParity + assertNoStorageGrantCollision)
 * and its standalone CLI wrapper (scripts/audit-storage-grant-parity.mjs).
 *
 * This is the LIVE counterpart to ENV_CHECKLIST's 'per-site' classification
 * of PDF_TOOL_STORAGE_SITE_ID/TOKEN — see docs/agents/pdf-tool-storage-grant.md.
 * Network calls are mocked (the same injectable-fetchImpl seam
 * executeNetlifyProvisioning already uses for testability) so these run
 * anywhere, no live Netlify account needed.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertNoStorageGrantCollision,
  checkStorageGrantParity,
  ENV_CHECKLIST,
} from '../../packages/core/cli/create-site.mjs';

// A minimal fake of the two Netlify endpoints checkStorageGrantParity calls
// (GET /sites?name=..., GET /accounts/{id}/env?site_id=...), keyed by site
// name -> { id, accountId, env }.
const makeFetchImpl = (fleet) => async (url) => {
  const parsed = new URL(url);
  if (parsed.pathname === '/api/v1/sites') {
    const name = parsed.searchParams.get('name');
    const site = fleet[name];
    return {
      ok: true,
      json: async () => (site ? [{ name, id: site.id, account_id: site.accountId }] : []),
    };
  }
  const envMatch = parsed.pathname.match(/^\/api\/v1\/accounts\/([^/]+)\/env$/);
  if (envMatch) {
    const accountId = envMatch[1];
    const siteId = parsed.searchParams.get('site_id');
    const site = Object.values(fleet).find((s) => s.id === siteId && s.accountId === accountId);
    const variables = site
      ? Object.entries(site.env || {}).map(([key, value]) => ({ key, values: [{ context: 'all', value }] }))
      : [];
    return { ok: true, json: async () => variables };
  }
  throw new Error(`unexpected URL in test fetch mock: ${url}`);
};

test('ENV_CHECKLIST still classifies both storage-grant vars per-site (regression guard)', () => {
  const rows = ENV_CHECKLIST.flatMap((group) => group.rows);
  const siteIdRow = rows.find((row) => row.name === 'PDF_TOOL_STORAGE_SITE_ID');
  const tokenRow = rows.find((row) => row.name === 'PDF_TOOL_STORAGE_TOKEN');
  assert.equal(siteIdRow.cls, 'per-site');
  assert.equal(tokenRow.cls, 'per-site');
});

test('checkStorageGrantParity: distinct storage targets pass with no collisions', async () => {
  const fetchImpl = makeFetchImpl({
    'kugel-platform': { id: 'site-1', accountId: 'acct-1', env: { PDF_TOOL_STORAGE_SITE_ID: 'store-platform' } },
    'kugel-fernwell': { id: 'site-2', accountId: 'acct-1', env: { PDF_TOOL_STORAGE_SITE_ID: 'store-fernwell' } },
  });
  const { rows, collisions } = await checkStorageGrantParity(fetchImpl, 'token', ['kugel-platform', 'kugel-fernwell']);
  assert.deepEqual(
    rows.map((row) => row.status),
    ['ok', 'ok']
  );
  assert.equal(collisions.length, 0);
});

test('checkStorageGrantParity: two tenants on the same storage target is a reported collision', async () => {
  const fetchImpl = makeFetchImpl({
    'kugel-fernwell': { id: 'site-2', accountId: 'acct-1', env: { PDF_TOOL_STORAGE_SITE_ID: 'dr-lurie-root' } },
    'dr-lurie-root': { id: 'site-3', accountId: 'acct-1', env: { PDF_TOOL_STORAGE_SITE_ID: 'dr-lurie-root' } },
  });
  const { collisions } = await checkStorageGrantParity(fetchImpl, 'token', ['kugel-fernwell', 'dr-lurie-root']);
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].storageSiteId, 'dr-lurie-root');
  assert.deepEqual(collisions[0].siteNames.sort(), ['dr-lurie-root', 'kugel-fernwell']);
});

test('checkStorageGrantParity: unset and not-found sites are reported, never treated as collisions', async () => {
  const fetchImpl = makeFetchImpl({
    'kugel-platform': { id: 'site-1', accountId: 'acct-1', env: {} },
  });
  const { rows, collisions } = await checkStorageGrantParity(fetchImpl, 'token', ['kugel-platform', 'ghost-site']);
  assert.equal(collisions.length, 0);
  assert.deepEqual(
    rows.map((row) => row.status),
    ['unset', 'not-found']
  );
});

test('checkStorageGrantParity: three-way collision reports every sharing site together', async () => {
  const fetchImpl = makeFetchImpl({
    'kugel-platform': { id: 'site-1', accountId: 'acct-1', env: { PDF_TOOL_STORAGE_SITE_ID: 'shared' } },
    'kugel-fernwell': { id: 'site-2', accountId: 'acct-1', env: { PDF_TOOL_STORAGE_SITE_ID: 'shared' } },
    'dr-lurie-root': { id: 'site-3', accountId: 'acct-1', env: { PDF_TOOL_STORAGE_SITE_ID: 'shared' } },
  });
  const { collisions } = await checkStorageGrantParity(fetchImpl, 'token', [
    'kugel-platform',
    'kugel-fernwell',
    'dr-lurie-root',
  ]);
  assert.equal(collisions.length, 1);
  assert.deepEqual(collisions[0].siteNames.sort(), ['dr-lurie-root', 'kugel-fernwell', 'kugel-platform']);
});

test('assertNoStorageGrantCollision throws only for the named site, and only when it collides', () => {
  const parity = { collisions: [{ storageSiteId: 'shared', siteNames: ['kugel-fernwell', 'dr-lurie-root'] }] };
  assert.throws(() => assertNoStorageGrantCollision(parity, 'kugel-fernwell'), /parity violation/);
  assert.throws(() => assertNoStorageGrantCollision(parity, 'kugel-fernwell'), /dr-lurie-root/);
  // A site not in the collision (e.g. platform, already dedicated) is unaffected.
  assert.doesNotThrow(() => assertNoStorageGrantCollision(parity, 'kugel-platform'));
  assert.doesNotThrow(() => assertNoStorageGrantCollision({ collisions: [] }, 'kugel-platform'));
});
