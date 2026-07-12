import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyNavChangesToBody,
  navChangesToOps,
  navEditFieldsFor,
} from '../../src/lib/edit-mode/nav-editor.js';
import { navigationBodySchema, type NavigationBody } from '../../src/schema/bodies/navigation-v1.js';
import { isPatchOpAllowedForObjectType } from '../../src/schema/object-patch-ops.js';

const body = (): NavigationBody =>
  navigationBodySchema.parse({
    role: 'footer',
    brand: { text: 'Dr. Lurie', descriptor: 'Skin science, plainly.' },
    groups: [
      {
        id: 'g_learn',
        title: 'Learn',
        items: [
          { id: 'i_library', label: 'Library', target: { kind: 'route', href: '/learn/library' } },
          {
            id: 'i_topics',
            label: 'Topics',
            target: { kind: 'route', href: '/learn/topics' },
            children: [{ id: 'i_barrier', label: 'Barrier', target: { kind: 'route', href: '/t/barrier' } }],
          },
        ],
      },
    ],
    actions: [{ label: 'Subscribe', target: { kind: 'route', href: '/newsletter' }, style: 'primary' }],
    footNote: 'Educational content only.',
  });

test('navEditFieldsFor flattens exactly the copy surface (labels/titles/brand/footNote)', () => {
  const fields = navEditFieldsFor(body());
  assert.deepEqual(
    fields.map((field) => field.key),
    [
      'brand.text',
      'brand.descriptor',
      'group.g_learn.title',
      'item.g_learn.i_library.label',
      'item.g_learn.i_topics.label',
      'item.g_learn.i_barrier.label',
      'action.0.label',
      'footNote',
    ]
  );
  // No field ever exposes a target/href/icon — retargeting is not a copy edit.
  assert.ok(fields.every((field) => !/target|href|icon/i.test(field.key)));
});

test('navChangesToOps maps each change to its own grammar op (meta writes coalesce)', () => {
  const ops = navChangesToOps(body(), {
    'brand.text': 'Dr. L.',
    footNote: 'Not medical advice.',
    'group.g_learn.title': 'Learning',
    'item.g_learn.i_barrier.label': 'Skin barrier',
    'action.0.label': 'Get letters',
  });

  const byOp = (name: string) => ops.filter((op) => op.op === name);
  assert.equal(byOp('set_nav_meta').length, 1, 'brand + footNote coalesce into ONE set_nav_meta');
  assert.deepEqual(byOp('set_nav_meta')[0].fields, {
    brand: { text: 'Dr. L.', descriptor: 'Skin science, plainly.' },
    footNote: 'Not medical advice.',
  });

  const groupOp = byOp('upsert_group')[0] as { group: { id: string; title: string; items: unknown[] } };
  assert.equal(groupOp.group.title, 'Learning');
  assert.equal(groupOp.group.items.length, 2, 'the whole current group rides along (replace-by-id semantics)');

  const itemOp = byOp('update_item')[0];
  assert.deepEqual(
    { group_id: itemOp.group_id, item_id: itemOp.item_id, fields: itemOp.fields },
    { group_id: 'g_learn', item_id: 'i_barrier', fields: { label: 'Skin barrier' } }
  );

  // Action rename = remove + re-insert at the same position (label-keyed).
  assert.deepEqual(byOp('remove_action')[0].label, 'Subscribe');
  const upsertAction = byOp('upsert_action')[0] as { action: { label: string; style?: string }; position: number };
  assert.equal(upsertAction.action.label, 'Get letters');
  assert.equal(upsertAction.action.style, 'primary', 'target/style ride along unchanged');
  assert.equal(upsertAction.position, 0);

  // Every emitted op is actually legal for navigation objects.
  for (const op of ops) {
    assert.equal(
      isPatchOpAllowedForObjectType('navigation', op.op as Parameters<typeof isPatchOpAllowedForObjectType>[1]),
      true,
      `op ${op.op} allowed`
    );
  }
});

test('navChangesToOps throws on unknown keys instead of dropping edits', () => {
  assert.throws(() => navChangesToOps(body(), { 'item.g_missing.i_x.label': 'x' }), /unknown group/i);
  assert.throws(() => navChangesToOps(body(), { bogus: 'x' }), /unknown field key/);
});

test('applyNavChangesToBody keeps the local body in step (deep item labels included)', () => {
  const next = applyNavChangesToBody(body(), {
    'item.g_learn.i_barrier.label': 'Skin barrier',
    'group.g_learn.title': 'Learning',
    'brand.descriptor': 'Plain skin science.',
    'action.0.label': 'Get letters',
    footNote: 'Updated.',
  });
  assert.equal(next.groups[0].title, 'Learning');
  assert.equal(next.groups[0].items[1].children?.[0].label, 'Skin barrier');
  assert.equal(next.brand?.descriptor, 'Plain skin science.');
  assert.equal(next.brand?.text, 'Dr. Lurie', 'untouched keys survive');
  assert.equal(next.actions?.[0].label, 'Get letters');
  assert.equal(next.footNote, 'Updated.');
  // Still a valid navigation body after the rewrite.
  navigationBodySchema.parse(next);
  // A follow-up title change now resends the UPDATED item label, not a stale one.
  const ops = navChangesToOps(next, { 'group.g_learn.title': 'Learn more' });
  const group = (ops[0] as { group: { items: Array<{ children?: Array<{ label: string }> }> } }).group;
  assert.equal(group.items[1].children?.[0].label, 'Skin barrier');
});
