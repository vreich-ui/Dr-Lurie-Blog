import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  blockerMessages,
  checkValidationAgainstSeed,
  sameBody,
  validatorHasNavRules,
  warningIds,
} from '../../scripts/lib/object-store-client.mjs';

// Report shapes as the deployed endpoint returns them (readiness groups).
const preT21Report = (structureStatus = 'optional') => [
  { id: 'schema', criteria: [{ id: 'schema_zod', status: 'complete', message: '' }] },
  {
    id: 'structure',
    criteria: [{ id: 'structure', status: structureStatus, message: 'No structural invariants for this type.' }],
  },
];

const postT21Report = (duplicateStatus = 'warning') => [
  { id: 'schema', criteria: [{ id: 'schema_zod', status: 'complete', message: '' }] },
  {
    id: 'structure',
    criteria: [
      { id: 'nav_groups', status: 'complete', message: '' },
      { id: 'nav_depth', status: 'complete', message: '' },
      { id: 'nav_duplicates', status: duplicateStatus, message: 'group "Solutions": …' },
      { id: 'nav_published_targets', status: 'optional', message: '' },
    ],
  },
];

test('validatorHasNavRules distinguishes pre- and post-T2.1 reports', () => {
  assert.equal(validatorHasNavRules(preT21Report()), false);
  assert.equal(validatorHasNavRules(postT21Report()), true);
});

test('pre-T2.1 validator: expected warning is NOT enforced (noted instead), blockers still fail', () => {
  const ok = checkValidationAgainstSeed(preT21Report(), ['nav_duplicates']);
  assert.equal(ok.ok, true);
  assert.match(ok.note, /predates T2\.1/);

  const withBlocker = [
    ...preT21Report(),
    { id: 'schema2', criteria: [{ id: 'schema_richtext', status: 'missing', message: 'bad tag' }] },
  ];
  const failed = checkValidationAgainstSeed(withBlocker, ['nav_duplicates']);
  assert.equal(failed.ok, false);
  assert.match(failed.note, /hard failures/);
});

test('post-T2.1 validator: exact warning set enforced both ways', () => {
  assert.equal(checkValidationAgainstSeed(postT21Report('warning'), ['nav_duplicates']).ok, true);
  // expected a warning, got none → fail
  assert.equal(checkValidationAgainstSeed(postT21Report('complete'), ['nav_duplicates']).ok, false);
  // expected none, got one → fail
  assert.equal(checkValidationAgainstSeed(postT21Report('warning'), []).ok, false);
  // expected none, got none → ok
  assert.equal(checkValidationAgainstSeed(postT21Report('complete'), []).ok, true);
});

test('sameBody is key-order-insensitive and value-sensitive', () => {
  assert.equal(sameBody({ a: 1, b: [{ x: 1, y: 2 }] }, { b: [{ y: 2, x: 1 }], a: 1 }), true);
  assert.equal(sameBody({ a: 1 }, { a: 2 }), false);
  assert.equal(sameBody({ a: 1 }, { a: 1, b: 1 }), false);
  // Array order is content (nav item order matters).
  assert.equal(sameBody({ items: [1, 2] }, { items: [2, 1] }), false);
});

test('warningIds / blockerMessages flatten the grouped report', () => {
  const report = postT21Report('warning');
  assert.deepEqual(warningIds(report), ['nav_duplicates']);
  assert.deepEqual(blockerMessages(report), []);
});
