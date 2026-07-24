/**
 * T9.4 — owner-only force check-in (lock takeover, OQ-W9-8). Pins the security
 * gate and the lock semantics: non-owner is refused, an owner takeover writes
 * previous-owner history and bumps `version` but never `content_revision`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { handleObjectVerb, type ObjectVerbStore } from '../../netlify/lib/object-verbs.js';
import { objectRecordKey } from '../../netlify/lib/object-store-keys.js';
import type { ObjectRecord, Principal } from '../../packages/core/schema/object-record-v1.js';

const NOW = Date.parse('2026-07-17T12:00:00.000Z');
const EDITOR: Principal = { kind: 'human', id: 'ed1', email: 'editor@example.com' };
const OWNER: Principal = { kind: 'human', id: 'own1', email: 'owner@example.com' };

const memStore = () => {
  const map = new Map<string, string>();
  return {
    map,
    async get(key: string) {
      return map.get(key) ?? null;
    },
    async setJSON(key: string, value: unknown) {
      map.set(key, JSON.stringify(value));
    },
    async list({ prefix }: { prefix: string }) {
      return { blobs: [...map.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) };
    },
  };
};
type Store = ReturnType<typeof memStore>;

const seedRecord = (store: Store): ObjectRecord => {
  const record: ObjectRecord = {
    object_id: 'page_x',
    object_type: 'page',
    schema_version: 'page.v1',
    site: 'site_drlurie',
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    status: 'active',
    body: { route: '/x', title: 'X' },
    publication: { published_time: null },
    history: [],
    version: 1,
    content_revision: 3,
  };
  store.map.set(objectRecordKey('page', 'page_x'), JSON.stringify(record));
  return record;
};

const call = (
  store: Store,
  request: Record<string, unknown>,
  principal: Principal,
  opts: Record<string, unknown> = {}
) => handleObjectVerb(store as unknown as ObjectVerbStore, request as never, principal, { nowMs: NOW, ...opts });

test('an owner force takeover releases another editor’s lock and records it', async () => {
  const store = memStore();
  seedRecord(store);
  // editor A holds the lock
  const co = await call(
    store,
    { action: 'checkout', object_type: 'page', object_id: 'page_x', lease_seconds: 300 },
    EDITOR
  );
  assert.equal(co.status, 200);
  const lockedRev = JSON.parse(store.map.get(objectRecordKey('page', 'page_x'))!).content_revision;

  // owner forces a takeover — no lock token
  const forced = await call(
    store,
    { action: 'checkin', object_type: 'page', object_id: 'page_x', force: true },
    OWNER,
    { roles: ['owner', 'admin', 'publisher'] }
  );
  assert.equal(forced.status, 200);

  const after = JSON.parse(store.map.get(objectRecordKey('page', 'page_x'))!) as ObjectRecord;
  assert.equal(after.lock, undefined, 'lock released');
  // version bumped (checkout +1, force-release +1); content_revision untouched
  assert.ok(after.version >= 3, 'version bumped');
  assert.equal(after.content_revision, lockedRev);
  assert.equal(after.content_revision, 3, 'content_revision never changes on a lock op');
  // previous-owner history written
  const forceEntry = after.history.find((h) => h.action === 'force_release');
  assert.ok(forceEntry, 'force_release history entry written');
  assert.equal((forceEntry!.details as Record<string, unknown>).previous_owner_id, EDITOR.id);
});

test('a non-owner is refused force check-in with 403', async () => {
  const store = memStore();
  seedRecord(store);
  await call(store, { action: 'checkout', object_type: 'page', object_id: 'page_x', lease_seconds: 300 }, EDITOR);

  const denied = await call(
    store,
    { action: 'checkin', object_type: 'page', object_id: 'page_x', force: true },
    { kind: 'human', id: 'a', email: 'admin@example.com' },
    { roles: ['admin'] } // admin, not owner
  );
  assert.equal(denied.status, 403);
  // lock is still held (nothing released)
  const after = JSON.parse(store.map.get(objectRecordKey('page', 'page_x'))!) as ObjectRecord;
  assert.ok(after.lock, 'lock untouched after refused force check-in');
});

test('force takeover is idempotent when no lock is held', async () => {
  const store = memStore();
  seedRecord(store);
  const forced = await call(
    store,
    { action: 'checkin', object_type: 'page', object_id: 'page_x', force: true },
    OWNER,
    { roles: ['owner', 'admin', 'publisher'] }
  );
  assert.equal(forced.status, 200);
});
