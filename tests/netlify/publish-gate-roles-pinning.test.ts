/**
 * T9.4 — publish-gate behavior pinned across the role change. publish-gate.ts
 * is byte-untouched; this proves the new `owner` tier changes nothing about
 * its decisions: owner (expanded to owner+admin+publisher) is treated exactly
 * like an admin, existing role sets behave as before, and owner does NOT
 * bypass an approval requirement.
 */
import '../../src/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import test from 'node:test';

import { checkPublishGate } from '../../packages/core/server/lib/publish-gate.js';
import { expandRole, type Role } from '../../packages/core/server/lib/roles.js';
import type { ApprovalPolicy } from '../../packages/core/lib/approval-policy.js';
import type { ObjectRecord, Principal } from '../../packages/core/schema/object-record-v1.js';

const HUMAN: Principal = { kind: 'human', id: 'u1', email: 'x@y.com' };
const AGENT: Principal = { kind: 'agent', agent_name: 'writer', auth: 'publish_key' };
const AUTONOMOUS: ApprovalPolicy = { master: 'all-autonomous', overrides: {} };
const REQUIRE: ApprovalPolicy = { master: 'all-require-approval', overrides: {} };

const record = (over: Partial<ObjectRecord> = {}): ObjectRecord => ({
  object_id: 'page_x',
  object_type: 'page',
  schema_version: 'page.v1',
  site: 'site_drlurie',
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
  status: 'active',
  body: {},
  publication: { published_time: null },
  history: [],
  version: 1,
  content_revision: 1,
  ...over,
});

const gate = (roles: readonly Role[], principal: Principal = HUMAN, policy: ApprovalPolicy = AUTONOMOUS) =>
  checkPublishGate({ record: record(), principal, roles, requested: {}, policy });

test('autonomous type: existing role sets pinned (admin/publisher allow; editor/none deny)', () => {
  assert.equal(gate(['admin']).allow, true);
  assert.equal(gate(['publisher']).allow, true);
  assert.equal(gate(['editor']).allow, false);
  assert.equal(gate([]).allow, false);
});

test('owner is treated identically to admin+publisher by the gate (migration invariant)', () => {
  assert.deepEqual(gate(expandRole('owner')), gate(['admin', 'publisher']));
  assert.equal(gate(expandRole('owner')).allow, true);
  // and identical to a plain admin on the autonomous path
  assert.deepEqual(gate(expandRole('owner')), gate(['admin']));
});

test('agents still publish on an autonomous type with no roles (unchanged)', () => {
  assert.equal(gate([], AGENT).allow, true);
});

test('owner does NOT bypass an approval requirement — same denial as an admin', () => {
  const ownerResult = checkPublishGate({
    record: record(),
    principal: HUMAN,
    roles: expandRole('owner'),
    requested: {},
    policy: REQUIRE,
  });
  const adminResult = checkPublishGate({
    record: record(),
    principal: HUMAN,
    roles: ['admin'],
    requested: {},
    policy: REQUIRE,
  });
  assert.equal(ownerResult.allow, false);
  assert.deepEqual(ownerResult, adminResult);
});
