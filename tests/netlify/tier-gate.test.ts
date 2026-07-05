import assert from 'node:assert/strict';
import test from 'node:test';

import { checkinObjectLock, checkoutObjectLock } from '../../netlify/lib/object-lock.js';
import { objectRecordKey } from '../../netlify/lib/object-store-keys.js';
import { checkPublishGate, tierForObjectType, type PublishGateResult } from '../../netlify/lib/tier-gate.js';
import { canDecideReview, canExecutePublish, resolveHumanRoles, resolveRolesForPrincipal, type Role } from '../../netlify/lib/roles.js';
import { applyPatchOps } from '../../src/lib/object-patch-apply.js';
import type { ObjectRecord, ObjectType, Principal, ReviewState } from '../../src/schema/object-record-v1.js';

const AT = '2026-07-04T12:00:00.000Z';
const NOW = Date.parse(AT);

const humanActor: Principal = { kind: 'human', id: 'u1', email: 'wolf@example.com' };
const agentActor: Principal = { kind: 'agent', agent_name: 'codex', auth: 'publish_key' };

const approveDecision = (contentRevision: number, publishAction?: { published_time: string | null }) => ({
  at: AT,
  by: humanActor,
  decision: 'approve' as const,
  ...(publishAction !== undefined ? { publish_action: publishAction } : {}),
  content_revision: contentRevision,
});

const baseRecord = (objectType: ObjectType, objectId: string, review?: ReviewState): ObjectRecord => ({
  object_id: objectId,
  object_type: objectType,
  schema_version: `${objectType}.v1`,
  site: 'site_drlurie',
  created_at: AT,
  updated_at: AT,
  status: 'active',
  body: {},
  publication: { published_time: null },
  ...(review !== undefined ? { review } : {}),
  history: [{ at: AT, action: 'object_create', actor: humanActor }],
  version: 7,
  content_revision: 2,
});

// ─── the gate matrix: every cell explicit ────────────────────────────────────

type ApprovalKey =
  | 'none'
  | 'open'
  | 'changes_requested'
  | 'approved_current_pin_match'
  | 'approved_current_pin_mismatch'
  | 'approved_current_no_pin'
  | 'approved_stale';

// Record content_revision is 2 in every fixture; requests omit published_time.
const APPROVALS: Record<ApprovalKey, ReviewState | undefined> = {
  none: undefined,
  open: { state: 'open', decisions: [] },
  changes_requested: {
    state: 'changes_requested',
    decisions: [{ at: AT, by: humanActor, decision: 'request_changes', content_revision: 2 }],
  },
  approved_current_pin_match: {
    state: 'approved',
    decisions: [approveDecision(2, { published_time: 'immediate' })],
  },
  approved_current_pin_mismatch: {
    state: 'approved',
    decisions: [approveDecision(2, { published_time: '2026-07-05T09:00:00.000Z' })],
  },
  approved_current_no_pin: { state: 'approved', decisions: [approveDecision(2)] },
  approved_stale: { state: 'approved', decisions: [approveDecision(1, { published_time: 'immediate' })] },
};

type PrincipalKey = 'agent' | 'human_admin' | 'human_publisher' | 'human_editor' | 'human_norole';
const PRINCIPALS: Record<PrincipalKey, { principal: Principal; roles: Role[] }> = {
  agent: { principal: agentActor, roles: [] },
  human_admin: { principal: humanActor, roles: ['admin'] },
  human_publisher: { principal: humanActor, roles: ['publisher'] },
  human_editor: { principal: humanActor, roles: ['editor'] },
  human_norole: { principal: humanActor, roles: [] },
};

type Expected = 'allow' | NonNullable<Extract<PublishGateResult, { allow: false }>>['code'];

// Hand-written truth table (C§2.2/M-6/D§3.9) — deliberately NOT computed, so
// a gate bug cannot silently rewrite the expectations.
const TIER2_MATRIX: Array<[PrincipalKey, ApprovalKey, Expected]> = [
  ['agent', 'none', 'approval_required'],
  ['agent', 'open', 'approval_required'],
  ['agent', 'changes_requested', 'changes_requested'],
  ['agent', 'approved_current_pin_match', 'allow'],
  ['agent', 'approved_current_pin_mismatch', 'publish_action_mismatch'],
  ['agent', 'approved_current_no_pin', 'publish_action_not_pinned'],
  ['agent', 'approved_stale', 'approval_stale'],
  ['human_admin', 'none', 'approval_required'],
  ['human_admin', 'open', 'approval_required'],
  ['human_admin', 'changes_requested', 'changes_requested'],
  ['human_admin', 'approved_current_pin_match', 'allow'],
  ['human_admin', 'approved_current_pin_mismatch', 'allow'], // pin binds agents, not humans (C§2.2)
  ['human_admin', 'approved_current_no_pin', 'allow'],
  ['human_admin', 'approved_stale', 'approval_stale'],
  ['human_publisher', 'none', 'approval_required'],
  ['human_publisher', 'open', 'approval_required'],
  ['human_publisher', 'changes_requested', 'changes_requested'],
  ['human_publisher', 'approved_current_pin_match', 'allow'],
  ['human_publisher', 'approved_current_pin_mismatch', 'allow'],
  ['human_publisher', 'approved_current_no_pin', 'allow'],
  ['human_publisher', 'approved_stale', 'approval_stale'],
  ['human_editor', 'none', 'approval_required'],
  ['human_editor', 'open', 'approval_required'],
  ['human_editor', 'changes_requested', 'changes_requested'],
  ['human_editor', 'approved_current_pin_match', 'publish_role_required'],
  ['human_editor', 'approved_current_pin_mismatch', 'publish_role_required'],
  ['human_editor', 'approved_current_no_pin', 'publish_role_required'],
  ['human_editor', 'approved_stale', 'approval_stale'],
  ['human_norole', 'none', 'approval_required'],
  ['human_norole', 'open', 'approval_required'],
  ['human_norole', 'changes_requested', 'changes_requested'],
  ['human_norole', 'approved_current_pin_match', 'publish_role_required'],
  ['human_norole', 'approved_current_pin_mismatch', 'publish_role_required'],
  ['human_norole', 'approved_current_no_pin', 'publish_role_required'],
  ['human_norole', 'approved_stale', 'approval_stale'],
];

const TIER3_MATRIX: Array<[PrincipalKey, ApprovalKey, Expected]> = [
  // Agents: always denied, regardless of approval state — even a valid pin.
  ['agent', 'none', 'human_execution_required'],
  ['agent', 'open', 'human_execution_required'],
  ['agent', 'changes_requested', 'human_execution_required'],
  ['agent', 'approved_current_pin_match', 'human_execution_required'],
  ['agent', 'approved_current_pin_mismatch', 'human_execution_required'],
  ['agent', 'approved_current_no_pin', 'human_execution_required'],
  ['agent', 'approved_stale', 'human_execution_required'],
  // Humans: approval still required — only the execution is human-only.
  ['human_admin', 'none', 'approval_required'],
  ['human_admin', 'open', 'approval_required'],
  ['human_admin', 'changes_requested', 'changes_requested'],
  ['human_admin', 'approved_current_pin_match', 'allow'],
  ['human_admin', 'approved_current_pin_mismatch', 'allow'],
  ['human_admin', 'approved_current_no_pin', 'allow'],
  ['human_admin', 'approved_stale', 'approval_stale'],
  ['human_publisher', 'none', 'approval_required'],
  ['human_publisher', 'open', 'approval_required'],
  ['human_publisher', 'changes_requested', 'changes_requested'],
  ['human_publisher', 'approved_current_pin_match', 'allow'],
  ['human_publisher', 'approved_current_pin_mismatch', 'allow'],
  ['human_publisher', 'approved_current_no_pin', 'allow'],
  ['human_publisher', 'approved_stale', 'approval_stale'],
  ['human_editor', 'none', 'approval_required'],
  ['human_editor', 'open', 'approval_required'],
  ['human_editor', 'changes_requested', 'changes_requested'],
  ['human_editor', 'approved_current_pin_match', 'publish_role_required'],
  ['human_editor', 'approved_current_pin_mismatch', 'publish_role_required'],
  ['human_editor', 'approved_current_no_pin', 'publish_role_required'],
  ['human_editor', 'approved_stale', 'approval_stale'],
  ['human_norole', 'none', 'approval_required'],
  ['human_norole', 'open', 'approval_required'],
  ['human_norole', 'changes_requested', 'changes_requested'],
  ['human_norole', 'approved_current_pin_match', 'publish_role_required'],
  ['human_norole', 'approved_current_pin_mismatch', 'publish_role_required'],
  ['human_norole', 'approved_current_no_pin', 'publish_role_required'],
  ['human_norole', 'approved_stale', 'approval_stale'],
];

const runCell = (objectType: ObjectType, objectId: string, principalKey: PrincipalKey, approvalKey: ApprovalKey) => {
  const { principal, roles } = PRINCIPALS[principalKey];
  return checkPublishGate({
    record: baseRecord(objectType, objectId, APPROVALS[approvalKey]),
    principal,
    roles,
    requested: {},
  });
};

for (const [principalKey, approvalKey, expected] of TIER2_MATRIX) {
  test(`gate matrix tier 2 (page) × ${principalKey} × ${approvalKey} → ${expected}`, () => {
    const result = runCell('page', 'page_home', principalKey, approvalKey);
    if (expected === 'allow') {
      assert.equal(result.allow, true, JSON.stringify(result));
    } else {
      assert.equal(result.allow, false);
      assert.equal(result.allow === false && result.code, expected);
      assert.equal(result.allow === false && result.status, 403);
    }
  });
}

for (const [principalKey, approvalKey, expected] of TIER3_MATRIX) {
  test(`gate matrix tier 3 (navigation) × ${principalKey} × ${approvalKey} → ${expected}`, () => {
    const result = runCell('navigation', 'nav_footer', principalKey, approvalKey);
    if (expected === 'allow') {
      assert.equal(result.allow, true, JSON.stringify(result));
    } else {
      assert.equal(result.allow, false);
      assert.equal(result.allow === false && result.code, expected);
    }
  });
}

test('gate matrix tier 1 (content_item) × agent → tier1_not_gated', () => {
  const result = runCell('content_item', 'req_smoke_pdf_cta_20260630_01', 'agent', 'approved_current_pin_match');
  assert.equal(result.allow, false);
  assert.equal(result.allow === false && result.code, 'tier1_not_gated');
});

test('gate matrix tier 1 (content_item) × human_admin → tier1_not_gated', () => {
  const result = runCell('content_item', 'req_smoke_pdf_cta_20260630_01', 'human_admin', 'approved_current_pin_match');
  assert.equal(result.allow, false);
  assert.equal(result.allow === false && result.code, 'tier1_not_gated');
});

// Tier membership itself, plus the same allow/deny shape on every other type.
test('tier mapping: page/section/template are Tier 2; navigation/taxonomy/site are Tier 3; content_item is Tier 1', () => {
  assert.equal(tierForObjectType('content_item'), 1);
  assert.equal(tierForObjectType('page'), 2);
  assert.equal(tierForObjectType('section'), 2);
  assert.equal(tierForObjectType('template'), 2);
  assert.equal(tierForObjectType('navigation'), 3);
  assert.equal(tierForObjectType('taxonomy'), 3);
  assert.equal(tierForObjectType('site'), 3);
});

for (const objectType of ['section', 'template'] as const) {
  test(`agent publish of approved ${objectType} (Tier 2) is allowed with a matching pin`, () => {
    const result = runCell(objectType, objectType === 'section' ? 'sec_cta' : 'tpl_home', 'agent', 'approved_current_pin_match');
    assert.equal(result.allow, true, JSON.stringify(result));
  });
}

for (const objectType of ['taxonomy', 'site'] as const) {
  test(`agent publish of approved ${objectType} (Tier 3) is always human_execution_required`, () => {
    const result = runCell(objectType, objectType === 'taxonomy' ? 'tax_drlurie' : 'site_drlurie', 'agent', 'approved_current_pin_match');
    assert.equal(result.allow, false);
    assert.equal(result.allow === false && result.code, 'human_execution_required');
  });
}

// ─── M-6 pin-matching exactness ──────────────────────────────────────────────

const gateWithPinAndRequest = (pin: { published_time: string | null }, requested: { published_time?: string | null }) =>
  checkPublishGate({
    record: baseRecord('page', 'page_home', { state: 'approved', decisions: [approveDecision(2, pin)] }),
    principal: agentActor,
    roles: [],
    requested,
  });

test('M-6: an ISO pin matches the same instant in a different ISO formatting', () => {
  const result = gateWithPinAndRequest(
    { published_time: '2026-07-04T09:00:00.000Z' },
    { published_time: '2026-07-04T09:00:00+00:00' }
  );
  assert.equal(result.allow, true, JSON.stringify(result));
});

test('M-6: an ISO pin rejects a different instant', () => {
  const result = gateWithPinAndRequest(
    { published_time: '2026-07-04T09:00:00.000Z' },
    { published_time: '2026-07-04T09:00:01.000Z' }
  );
  assert.equal(result.allow === false && result.code, 'publish_action_mismatch');
});

test('M-6: a null pin is the only thing authorizing an agent unpublish', () => {
  assert.equal(gateWithPinAndRequest({ published_time: null }, { published_time: null }).allow, true);
  const omitted = gateWithPinAndRequest({ published_time: null }, {});
  assert.equal(omitted.allow === false && omitted.code, 'publish_action_mismatch');
  const nullWithoutPin = gateWithPinAndRequest({ published_time: 'immediate' }, { published_time: null });
  assert.equal(nullWithoutPin.allow === false && nullWithoutPin.code, 'publish_action_mismatch');
});

test("M-6: an 'immediate' pin requires the call to omit published_time", () => {
  const explicit = gateWithPinAndRequest({ published_time: 'immediate' }, { published_time: AT });
  assert.equal(explicit.allow === false && explicit.code, 'publish_action_mismatch');
});

// ─── counter-independence invariants (D§3.1/D§3.9) ───────────────────────────

const approvedPageRecord = () =>
  baseRecord('page', 'page_home', {
    state: 'approved',
    decisions: [approveDecision(2, { published_time: 'immediate' })],
  });

test('lock checkout/checkin does NOT invalidate a pending approval (version-only churn)', async () => {
  const map = new Map<string, string>();
  const store = {
    get: async (key: string) => map.get(key) ?? null,
    setJSON: async (key: string, value: unknown) => {
      map.set(key, JSON.stringify(value));
    },
  };
  const record = approvedPageRecord();
  const key = objectRecordKey('page', 'page_home');
  map.set(key, JSON.stringify(record));

  const checkout = await checkoutObjectLock(store, key, { actor: humanActor, nowMs: NOW });
  assert.equal(checkout.ok, true);
  const afterCheckout = JSON.parse(map.get(key) as string) as ObjectRecord;
  assert.ok(afterCheckout.version > record.version, 'checkout must bump version');
  assert.equal(afterCheckout.content_revision, record.content_revision, 'checkout must not bump content_revision');
  assert.equal(
    checkPublishGate({ record: afterCheckout, principal: agentActor, roles: [], requested: {} }).allow,
    true,
    'approval must survive checkout'
  );

  const checkin = await checkinObjectLock(store, key, {
    actor: humanActor,
    lockToken: afterCheckout.lock?.token,
    nowMs: NOW + 1000,
  });
  assert.equal(checkin.ok, true);
  const afterCheckin = JSON.parse(map.get(key) as string) as ObjectRecord;
  assert.equal(afterCheckin.content_revision, record.content_revision);
  assert.equal(
    checkPublishGate({ record: afterCheckin, principal: agentActor, roles: [], requested: {} }).allow,
    true,
    'approval must survive checkin'
  );
});

test('a body write DOES invalidate the approval (content_revision moves past the pin)', () => {
  const record = {
    ...approvedPageRecord(),
    body: {
      route: '/',
      pageType: 'home',
      title: 'Home',
      seo: {},
      sections: [{ id: 's_hero1', type: 'hero', data: { heading: 'Original', actions: [] } }],
    },
  };
  const { record: edited } = applyPatchOps(
    record,
    [{ op: 'update_section_data', section_id: 's_hero1', fields: { heading: 'Changed' } }],
    { actor: agentActor, at: AT }
  );
  assert.equal(edited.content_revision, record.content_revision + 1);

  const result = checkPublishGate({ record: edited, principal: agentActor, roles: [], requested: {} });
  assert.equal(result.allow, false);
  assert.equal(result.allow === false && result.code, 'approval_stale');

  const humanResult = checkPublishGate({ record: edited, principal: humanActor, roles: ['admin'], requested: {} });
  assert.equal(humanResult.allow === false && humanResult.code, 'approval_stale', 'stale approvals bind humans too');
});

test('the publish stamp itself does NOT invalidate the approval (T1.3 writes version, never content_revision)', () => {
  const record = approvedPageRecord();
  // Exactly the T1.3 step-5 stamp shape: publication + history + version.
  const stamped: ObjectRecord = {
    ...record,
    updated_at: AT,
    publication: {
      published_time: AT,
      publish_receipt: { kind: 'object_export_commit', commit_sha: 'commit1' },
    },
    history: [...record.history, { at: AT, action: 'publish', actor: humanActor }],
    version: record.version + 1,
    content_revision: record.content_revision,
  };
  const result = checkPublishGate({ record: stamped, principal: agentActor, roles: [], requested: {} });
  assert.equal(result.allow, true, 'publishing must consume, never invalidate, its approval');
});

// ─── roles.ts resolution ─────────────────────────────────────────────────────

test('roles: env allowlists resolve with trim/lowercase and ADMIN_EMAILS superset compatibility', () => {
  const env = {
    ROLE_EMAILS_ADMIN: ' Alice@Example.com ',
    ROLE_EMAILS_PUBLISHER: 'bob@example.com, alice@example.com',
    ROLE_EMAILS_EDITOR: 'carol@example.com',
    ADMIN_EMAILS: 'legacy@example.com',
  };
  assert.deepEqual(resolveHumanRoles('alice@example.com', env), ['admin', 'publisher']);
  assert.deepEqual(resolveHumanRoles('BOB@example.com', env), ['publisher']);
  assert.deepEqual(resolveHumanRoles('carol@example.com', env), ['editor']);
  assert.deepEqual(resolveHumanRoles('legacy@example.com', env), ['admin'], 'ADMIN_EMAILS members stay admins');
  assert.deepEqual(resolveHumanRoles('stranger@example.com', env), []);
  assert.deepEqual(resolveHumanRoles('', env), []);
});

test('roles: agents resolve to no roles; publish execution requires admin or publisher', () => {
  assert.deepEqual(resolveRolesForPrincipal(agentActor, { ROLE_EMAILS_ADMIN: 'codex' }), []);
  assert.equal(canExecutePublish(['admin']), true);
  assert.equal(canExecutePublish(['publisher']), true);
  assert.equal(canExecutePublish(['editor']), false);
  assert.equal(canExecutePublish([]), false);
  assert.equal(canDecideReview(['editor']), true);
  assert.equal(canDecideReview([]), false);
});
