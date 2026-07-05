import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { handler as adminObjectHandler } from '../../netlify/functions/admin-object.js';
import { handler as objectStoreHandler } from '../../netlify/functions/object-store.js';
import type { ObjectRecord } from '../../src/schema/object-record-v1.js';

// End-to-end tests of BOTH auth entry points against the local blob fallback.
// Neither NETLIFY runtime env is set and events carry no blob context, so
// getSiteObjectsBlobStore falls back to the file-backed local store.
for (const key of ['NETLIFY', 'NETLIFY_SITE_ID', 'NETLIFY_BLOBS_TOKEN', 'NETLIFY_AUTH_TOKEN', 'SITE_ID']) {
  delete process.env[key];
}
const PUBLISH_SECRET = 'test-publish-secret';
process.env.PUBLISH_SECRET = PUBLISH_SECRET;
process.env.ADMIN_EMAILS = 'admin@drlurie.com';

const SITE_OBJECTS_DIR = join(process.cwd(), '.netlify', 'local-blobs', 'site-objects');
const reset = () => rm(SITE_OBJECTS_DIR, { recursive: true, force: true });

const validPageBody = () => ({
  route: '/',
  pageType: 'home',
  title: 'Dr. Lurié',
  seo: { description: 'Science-first skincare.' },
  sections: [{ id: 's_hero', type: 'hero', data: { heading: 'Hi', actions: [] } }],
});

const post = (body: unknown, headers: Record<string, string> = {}) => ({
  httpMethod: 'POST',
  headers,
  body: JSON.stringify(body),
});

const parse = (response: { statusCode: number; body: string }) => ({
  status: response.statusCode,
  json: JSON.parse(response.body) as Record<string, unknown>,
});

// ═══ object-store.ts (publish-key path) ══════════════════════════════════════

test('object-store: rejects non-POST with 405', async () => {
  const res = parse(await objectStoreHandler({ httpMethod: 'GET' }));
  assert.equal(res.status, 405);
});

test('object-store: 401 when the publish key is missing or wrong', async () => {
  const missing = parse(await objectStoreHandler(post({ action: 'get', object_type: 'page', object_id: 'page_x' })));
  assert.equal(missing.status, 401);
  const wrong = parse(
    await objectStoreHandler(
      post({ action: 'get', object_type: 'page', object_id: 'page_x' }, { 'x-publish-key': 'nope' })
    )
  );
  assert.equal(wrong.status, 401);
});

test('object-store: with a valid publish key, an agent creates a record end-to-end', async () => {
  await reset();
  const res = parse(
    await objectStoreHandler(
      post(
        {
          action: 'create',
          object_type: 'page',
          site: 'site_drlurie',
          body: validPageBody(),
          requested_id: 'page_home',
          agent_name: 'smoke-agent',
        },
        { 'x-publish-key': PUBLISH_SECRET }
      )
    )
  );
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const record = res.json.record as ObjectRecord;
  assert.equal(record.object_id, 'page_home');
  assert.equal(record.history[0].actor.kind, 'agent');
  assert.equal((record.history[0].actor as { agent_name: string }).agent_name, 'smoke-agent');
});

// ═══ admin-object.ts (Netlify Identity path) ═════════════════════════════════

const adminContext = (email: string) => ({ clientContext: { user: { sub: 'identity-user', email } } });

test('admin-object: rejects non-POST with 405', async () => {
  const res = parse(await adminObjectHandler({ httpMethod: 'GET' }));
  assert.equal(res.status, 405);
});

test('admin-object: 401 unauthenticated, 403 for a non-admin identity', async () => {
  const anon = parse(await adminObjectHandler(post({ action: 'get', object_type: 'page', object_id: 'page_x' })));
  assert.equal(anon.status, 401);
  const nonAdmin = parse(
    await adminObjectHandler(
      post({ action: 'get', object_type: 'page', object_id: 'page_x' }),
      adminContext('nobody@example.com')
    )
  );
  assert.equal(nonAdmin.status, 403);
});

test('admin-object: an admin creates a record with NO publish key present (identity only)', async () => {
  await reset();
  const res = parse(
    await adminObjectHandler(
      // Note: no x-publish-key header anywhere on this request.
      post({
        action: 'create',
        object_type: 'page',
        site: 'site_drlurie',
        body: validPageBody(),
        requested_id: 'page_home',
      }),
      adminContext('admin@drlurie.com')
    )
  );
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const record = res.json.record as ObjectRecord;
  assert.equal(record.history[0].actor.kind, 'human');
  assert.equal((record.history[0].actor as { email: string }).email, 'admin@drlurie.com');
});

test('both paths share one store: an agent-created record is readable through the admin path', async () => {
  await reset();
  await objectStoreHandler(
    post(
      { action: 'create', object_type: 'page', site: 'site_drlurie', body: validPageBody(), requested_id: 'page_home' },
      { 'x-publish-key': PUBLISH_SECRET }
    )
  );
  const got = parse(
    await adminObjectHandler(
      post({ action: 'get', object_type: 'page', object_id: 'page_home' }),
      adminContext('admin@drlurie.com')
    )
  );
  assert.equal(got.status, 200);
  assert.equal((got.json.record as ObjectRecord).object_id, 'page_home');
});

// ═══ security invariant: the browser path never sees the publish key ═════════

test('admin-object source references the publish key nowhere (never receives/reads/forwards it)', () => {
  const source = readFileSync(join(process.cwd(), 'netlify/functions/admin-object.ts'), 'utf8');
  // Allow the doc-comment sentence that NAMES the invariant; strip comments first.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/PUBLISH_SECRET/i.test(code), 'admin-object must not reference PUBLISH_SECRET');
  assert.ok(!/x-publish-key/i.test(code), 'admin-object must not read the x-publish-key header');
  assert.ok(!/verifyPublishKey|secretsMatch/i.test(code), 'admin-object must not run publish-key auth');
});

// ═══ minting is centralized in one helper, not inlined per action ════════════

test('object-verbs mints only through the shared mintId helper (no inline id generation)', () => {
  const source = readFileSync(join(process.cwd(), 'netlify/lib/object-verbs.ts'), 'utf8');
  assert.ok(/from '\.\.\/\.\.\/src\/lib\/object-ids-mint\.js'/.test(source), 'must import the shared mintId helper');
  assert.ok(/mintId\(/.test(source), 'must call mintId');
  assert.ok(!/randomUUID/.test(source), 'no inline UUID id generation');
  assert.ok(!/createHash/.test(source), 'no inline hashing — that belongs to mintId');
});
