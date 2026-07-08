import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildObjectContract,
  OBJECT_CONTRACT_TYPES,
  type ObjectContract,
} from '../../src/lib/registry/object-contract.js';
import type { ApprovalPolicy } from '../../src/lib/approval-policy.js';
import { REGISTERED_SECTION_TYPES } from '../../src/lib/registry/components/registered-types.js';
import { sectionTypes } from '../../src/schema/bodies/section-v1.js';
import { patchOpNamesByObjectType } from '../../src/schema/object-patch-ops.js';
import type { ObjectType } from '../../src/schema/object-record-v1.js';

const GOVERNED: ObjectType[] = ['page', 'section', 'navigation', 'taxonomy', 'site', 'template'];

// Building every contract exercises z.toJSONSchema over the recursive navItem
// (z.lazy), the section discriminated union, and the patch-op refinements — so
// this loop IS the "does toJSONSchema throw?" risk check.
test('every object type produces a well-formed contract without throwing', () => {
  for (const type of OBJECT_CONTRACT_TYPES) {
    const contract: ObjectContract = buildObjectContract(type);
    assert.equal(contract.object_type, type);
    assert.ok(contract.summary.length > 0);
    assert.ok(Array.isArray(contract.patch_ops));
    assert.ok(Array.isArray(contract.constraints));
    assert.ok(contract.publish_policy);
    assert.ok(Array.isArray(contract.workflow.sequence) && contract.workflow.sequence.length > 0);
  }
});

test('governed types carry a non-empty body JSON-schema; content_item points at the article tools', () => {
  for (const type of GOVERNED) {
    const body = buildObjectContract(type).body_schema as Record<string, unknown>;
    assert.equal(body.type, 'object', `${type} body_schema should be a JSON-schema object`);
    assert.ok(body.properties && Object.keys(body.properties).length > 0, `${type} body_schema has properties`);
  }
  const contentItem = buildObjectContract('content_item').body_schema as { note?: string };
  assert.match(contentItem.note ?? '', /save_json_blob/);
  assert.equal(buildObjectContract('content_item').creatable, false);
});

test('section_types covers every variant; the component-bound ones carry editor hints', () => {
  for (const type of ['page', 'section'] as ObjectType[]) {
    const sections = buildObjectContract(type).section_types ?? [];
    assert.deepEqual(
      sections.map((s) => s.type).sort(),
      [...sectionTypes].sort(),
      `${type} must enumerate every section variant`
    );
    const bound = sections.filter((s) => s.component_bound);
    assert.deepEqual(
      bound.map((s) => s.type).sort(),
      [...REGISTERED_SECTION_TYPES].sort(),
      'component_bound exactly tracks the registered (component-bound) types'
    );
    for (const s of bound) assert.ok(s.editor, `${s.type} (bound) must carry editor hints`);
    for (const s of sections) assert.ok(s.data_schema, `${s.type} must carry a data_schema`);
  }
  // non-page/section types don't enumerate sections
  assert.equal(buildObjectContract('navigation').section_types, undefined);
});

test('patch_ops covers exactly the per-type allowlist, with arg schemas + minted-id fields', () => {
  for (const type of GOVERNED) {
    const ops = buildObjectContract(type).patch_ops;
    assert.deepEqual(
      ops.map((o) => o.op).sort(),
      [...patchOpNamesByObjectType[type]].sort(),
      `${type} patch_ops must match patchOpNamesByObjectType`
    );
    for (const o of ops) assert.ok(o.arg_schema, `${o.op} must carry an arg_schema`);
  }
  // the five minted-id ops advertise which id an agent may omit
  const navOps = buildObjectContract('navigation').patch_ops;
  assert.equal(navOps.find((o) => o.op === 'upsert_item')?.minted_id_field, 'item.id');
  assert.equal(navOps.find((o) => o.op === 'upsert_group')?.minted_id_field, 'group.id');
  const taxOps = buildObjectContract('taxonomy').patch_ops;
  assert.equal(taxOps.find((o) => o.op === 'add_term')?.minted_id_field, 'term.term_id');
  // reactivate_term is inverse-only machinery, not agent-authored
  assert.equal(taxOps.find((o) => o.op === 'reactivate_term')?.agent_authored, false);
});

test('content_item has no allowlisted patch ops (served by the article surface)', () => {
  assert.deepEqual(buildObjectContract('content_item').patch_ops, []);
});

test('requires_approval is computed from the policy, not hardcoded', () => {
  const gated: ApprovalPolicy = { master: 'all-require-approval', overrides: {} };
  const autonomous: ApprovalPolicy = { master: 'all-autonomous', overrides: {} };
  assert.equal(buildObjectContract('page', { approvalPolicy: gated }).publish_policy.requires_approval, true);
  assert.equal(buildObjectContract('page', { approvalPolicy: autonomous }).publish_policy.requires_approval, false);
  // a per-type override beats the master switch
  const overridden: ApprovalPolicy = { master: 'all-autonomous', overrides: { navigation: 'require-approval' } };
  assert.equal(
    buildObjectContract('navigation', { approvalPolicy: overridden }).publish_policy.requires_approval,
    true
  );
  assert.equal(buildObjectContract('page', { approvalPolicy: overridden }).publish_policy.requires_approval, false);
  // gated workflow surfaces the review step
  assert.ok(
    buildObjectContract('page', { approvalPolicy: gated }).workflow.sequence.some((s) =>
      s.includes('object_review_decide')
    )
  );
});

test('anti-drift coverage guard: contract types match objectTypes exactly', () => {
  assert.deepEqual(
    [...OBJECT_CONTRACT_TYPES].sort(),
    [...(['page', 'section', 'navigation', 'taxonomy', 'site', 'template', 'content_item'] as ObjectType[])].sort()
  );
});
