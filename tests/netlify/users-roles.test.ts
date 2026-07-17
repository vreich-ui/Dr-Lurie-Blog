/**
 * T9.4 — users store + async role resolver. Security-boundary tests: the
 * resolver feeds publish-gate and every Owner gate, so a precedence bug here
 * either locks Wolf out or over-grants. These pin the precedence rules.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveRolesForPrincipalAsync,
  resolveRolesForPrincipal,
  expandRole,
  isOwner,
  type Role,
} from '../../netlify/lib/roles.js';
import {
  getUserRecord,
  putUserRecord,
  listUserRecords,
  userRecordKey,
  normalizeUserEmail,
  type UserRecord,
  type UsersBlobStore,
} from '../../netlify/lib/users-store.js';
import type { Principal } from '../../src/schema/object-record-v1.js';

const human = (email: string): Principal => ({ kind: 'human', id: 'u1', email });
const agent: Principal = { kind: 'agent', agent_name: 'writer', auth: 'mcp_token' };

const userRec = (over: Partial<UserRecord> = {}): UserRecord => ({
  schema_version: 1,
  email: 'alex@example.com',
  display_name: 'Alex',
  role: 'admin',
  status: 'active',
  invited_by: 'boot',
  created_at: '2026-07-17T00:00:00.000Z',
  updated_at: '2026-07-17T00:00:00.000Z',
  audit: [],
  ...over,
});

const memStore = (): UsersBlobStore & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return {
    map,
    async get(key) {
      return map.get(key) ?? null;
    },
    async setJSON(key, value) {
      map.set(key, JSON.stringify(value));
    },
    async list({ prefix }) {
      return { blobs: [...map.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) };
    },
  };
};

const readerFor = (store: UsersBlobStore) => (email: string) => getUserRecord(store, email);

// ─── expandRole / isOwner ─────────────────────────────────────────────────────

test('owner expands to owner+admin+publisher (publish-gate sees admin/publisher); admin expands to admin', () => {
  assert.deepEqual(expandRole('owner'), ['owner', 'admin', 'publisher']);
  assert.deepEqual(expandRole('admin'), ['admin']);
  assert.equal(isOwner(['owner', 'admin', 'publisher']), true);
  assert.equal(isOwner(['admin']), false);
});

// ─── resolver precedence ──────────────────────────────────────────────────────

test('agent principals resolve to [] (unchanged capability-class semantics)', async () => {
  assert.deepEqual(await resolveRolesForPrincipalAsync(agent, { env: { ADMIN_EMAILS: 'boss@x.com' } }), []);
});

test('ADMIN_EMAILS member always resolves owner — lockout is structurally impossible', async () => {
  const env = { ADMIN_EMAILS: 'boss@x.com' };
  // no store at all
  assert.deepEqual(await resolveRolesForPrincipalAsync(human('boss@x.com'), { env }), ['owner', 'admin', 'publisher']);
  // even with a store record that DISABLES them
  const store = memStore();
  await putUserRecord(store, userRec({ email: 'boss@x.com', role: 'admin', status: 'disabled' }));
  assert.deepEqual(await resolveRolesForPrincipalAsync(human('BOSS@x.com'), { env, getUserRecord: readerFor(store) }), [
    'owner',
    'admin',
    'publisher',
  ]);
});

test('store record wins over env allowlists for a non-bootstrap user', async () => {
  const store = memStore();
  // env would make them a publisher; the store says admin → store wins, publisher dropped
  await putUserRecord(store, userRec({ email: 'alex@example.com', role: 'admin', status: 'active' }));
  const roles = await resolveRolesForPrincipalAsync(human('alex@example.com'), {
    env: { ROLE_EMAILS_PUBLISHER: 'alex@example.com' },
    getUserRecord: readerFor(store),
  });
  assert.deepEqual(roles, ['admin']);
});

test('an active owner record grants owner', async () => {
  const store = memStore();
  await putUserRecord(store, userRec({ email: 'own@example.com', role: 'owner', status: 'active' }));
  assert.deepEqual(
    await resolveRolesForPrincipalAsync(human('own@example.com'), { env: {}, getUserRecord: readerFor(store) }),
    ['owner', 'admin', 'publisher']
  );
});

test('a disabled member loses all roles', async () => {
  const store = memStore();
  await putUserRecord(store, userRec({ email: 'gone@example.com', role: 'owner', status: 'disabled' }));
  assert.deepEqual(
    await resolveRolesForPrincipalAsync(human('gone@example.com'), { env: {}, getUserRecord: readerFor(store) }),
    []
  );
});

test('no store record → env allowlist fallback (env admin resolves admin, unknown resolves [])', async () => {
  const store = memStore();
  const reader = readerFor(store);
  assert.deepEqual(
    await resolveRolesForPrincipalAsync(human('envadmin@x.com'), {
      env: { ROLE_EMAILS_ADMIN: 'envadmin@x.com' },
      getUserRecord: reader,
    }),
    ['admin']
  );
  assert.deepEqual(await resolveRolesForPrincipalAsync(human('nobody@x.com'), { env: {}, getUserRecord: reader }), []);
});

test('a store read that throws degrades to the env fallback (store unavailable ≠ deny everyone)', async () => {
  const throwing = () => Promise.reject(new Error('blob store down'));
  const roles = await resolveRolesForPrincipalAsync(human('envadmin@x.com'), {
    env: { ROLE_EMAILS_ADMIN: 'envadmin@x.com' },
    getUserRecord: throwing,
  });
  assert.deepEqual(roles, ['admin']);
});

test('the sync resolver still exists and never returns owner (owner is store/bootstrap only)', () => {
  const roles: Role[] = resolveRolesForPrincipal(human('envadmin@x.com'), { ROLE_EMAILS_ADMIN: 'envadmin@x.com' });
  assert.deepEqual(roles, ['admin']);
  assert.equal(roles.includes('owner'), false);
});

// ─── users store ──────────────────────────────────────────────────────────────

test('getUserRecord: missing → null; corrupt → null; valid → parsed', async () => {
  const store = memStore();
  assert.equal(await getUserRecord(store, 'missing@x.com'), null);
  store.map.set(userRecordKey('corrupt@x.com'), '{ not valid json');
  assert.equal(await getUserRecord(store, 'corrupt@x.com'), null);
  store.map.set(userRecordKey('bad@x.com'), JSON.stringify({ schema_version: 1, email: 'bad@x.com' }));
  assert.equal(await getUserRecord(store, 'bad@x.com'), null); // missing required fields
  await putUserRecord(store, userRec({ email: 'ok@x.com' }));
  const r = await getUserRecord(store, 'OK@x.com');
  assert.equal(r?.email, 'ok@x.com');
});

test('putUserRecord normalizes the email in key and record', async () => {
  const store = memStore();
  await putUserRecord(store, userRec({ email: '  Mixed@Case.COM  ' }));
  assert.equal(normalizeUserEmail('  Mixed@Case.COM  '), 'mixed@case.com');
  assert.ok(store.map.has(userRecordKey('mixed@case.com')));
  const r = await getUserRecord(store, 'mixed@case.com');
  assert.equal(r?.email, 'mixed@case.com');
});

test('listUserRecords returns valid records sorted by email, skipping corrupt', async () => {
  const store = memStore();
  await putUserRecord(store, userRec({ email: 'zed@x.com' }));
  await putUserRecord(store, userRec({ email: 'amy@x.com' }));
  store.map.set(userRecordKey('junk@x.com'), '{bad');
  const rows = await listUserRecords(store);
  assert.deepEqual(
    rows.map((r) => r.email),
    ['amy@x.com', 'zed@x.com']
  );
});
