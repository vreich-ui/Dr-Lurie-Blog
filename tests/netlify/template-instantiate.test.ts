import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPageBodyFromTemplate } from '../../src/lib/template-instantiate.js';
import { pageBodySchema } from '../../src/schema/bodies/page-v1.js';
import type { TemplateBody } from '../../src/schema/bodies/template-v1.js';

// The pure half of the `instantiate` verb (W2.5): template slots → page body.
// The verb-level flow (load template → build → create) is covered in
// object-instantiate.test.ts; this suite pins the slot-fill semantics.

const REQUEST = {
  route: '/probe',
  title: 'Probe page',
  templateRef: 'tpl_probe',
  instantiatedAt: '2026-07-11T00:00:00.000Z',
};

const template = (overrides: Partial<TemplateBody> = {}): TemplateBody => ({
  name: 'Probe template',
  appliesTo: ['standard'],
  slots: [
    {
      slotId: 'slot_lede',
      allowed: ['lede'],
      required: true,
      repeatable: false,
      blueprint: {
        id: 's_bplede',
        type: 'lede',
        data: { heading: 'Starter heading', actions: [] },
      },
    },
    { slotId: 'slot_body', allowed: ['prose'], required: false, repeatable: true },
  ],
  ...overrides,
});

test('copies blueprints in slot order with fresh deterministic ids and stamps provenance', () => {
  const result = buildPageBodyFromTemplate(template(), REQUEST);
  assert.ok(result.ok, result.ok ? '' : result.error);
  const body = result.body;

  // Blueprint copied; optional slot without blueprint skipped.
  assert.equal(body.sections.length, 1);
  const section = body.sections[0]!;
  assert.equal(section.type, 'lede');
  assert.deepEqual(section.data, { heading: 'Starter heading', actions: [] });

  // Fresh id (never the blueprint's own), stable across runs.
  assert.notEqual(section.id, 's_bplede');
  assert.match(section.id, /^s_[a-z0-9]+$/);
  const again = buildPageBodyFromTemplate(template(), REQUEST);
  assert.ok(again.ok);
  assert.deepEqual(again.body, body);

  // Provenance + defaults.
  assert.deepEqual(body.template, { ref: 'tpl_probe', instantiated_at: REQUEST.instantiatedAt });
  assert.equal(body.pageType, 'standard'); // appliesTo[0]
  assert.deepEqual(body.seo, {});
  assert.ok(pageBodySchema.safeParse(body).success);
});

test('deep-copies the blueprint — mutating the template afterwards does not touch the built body', () => {
  const source = template();
  const result = buildPageBodyFromTemplate(source, REQUEST);
  assert.ok(result.ok);
  (source.slots[0]!.blueprint!.data as { heading: string }).heading = 'MUTATED';
  assert.equal((result.body.sections[0]!.data as { heading: string }).heading, 'Starter heading');
});

test('required slot without a blueprint falls back to the registry defaultData of its first allowed type', () => {
  const result = buildPageBodyFromTemplate(
    template({ slots: [{ slotId: 'slot_body', allowed: ['prose'], required: true, repeatable: false }] }),
    REQUEST
  );
  assert.ok(result.ok, result.ok ? '' : result.error);
  const section = result.body.sections[0]!;
  assert.equal(section.type, 'prose');
  assert.deepEqual(section.data, { body: '<p></p>' }); // proseDefinition.editor.defaultData
  assert.ok(pageBodySchema.safeParse(result.body).success);
});

test('blueprint visibility and notes survive the copy', () => {
  const withExtras = template();
  withExtras.slots[0]!.blueprint = {
    ...withExtras.slots[0]!.blueprint!,
    visibility: 'hidden',
    notes: 'agent note',
  };
  const result = buildPageBodyFromTemplate(withExtras, REQUEST);
  assert.ok(result.ok);
  assert.equal(result.body.sections[0]!.visibility, 'hidden');
  assert.equal(result.body.sections[0]!.notes, 'agent note');
});

test('explicit page_type must be within a non-empty appliesTo', () => {
  const rejected = buildPageBodyFromTemplate(template(), { ...REQUEST, pageType: 'system' });
  assert.ok(!rejected.ok);
  assert.match(rejected.error, /does not apply to pageType "system"/);

  const accepted = buildPageBodyFromTemplate(template({ appliesTo: [] }), { ...REQUEST, pageType: 'system' });
  assert.ok(accepted.ok, accepted.ok ? '' : accepted.error);
  assert.equal(accepted.body.pageType, 'system');
});

test('empty appliesTo with no explicit page_type is an error', () => {
  const result = buildPageBodyFromTemplate(template({ appliesTo: [] }), REQUEST);
  assert.ok(!result.ok);
  assert.match(result.error, /pass page_type explicitly/);
});

test('required slot whose first allowed type has no registry defaultData is an error naming the slot', () => {
  const result = buildPageBodyFromTemplate(
    template({ slots: [{ slotId: 'slot_shared', allowed: ['shared_ref'], required: true, repeatable: false }] }),
    REQUEST
  );
  assert.ok(!result.ok);
  assert.match(result.error, /slot "slot_shared".*"shared_ref" has no registry defaultData/);
});

test('required slot with no allowed types is an error', () => {
  const result = buildPageBodyFromTemplate(
    template({ slots: [{ slotId: 'slot_empty', allowed: [], required: true, repeatable: false }] }),
    REQUEST
  );
  assert.ok(!result.ok);
  assert.match(result.error, /no allowed types/);
});

test('two slots sharing one blueprint id still yield unique section ids', () => {
  const blueprint = {
    id: 's_same',
    type: 'prose' as const,
    data: { body: '<p>Copy.</p>' },
  };
  const result = buildPageBodyFromTemplate(
    template({
      slots: [
        { slotId: 'slot_a', allowed: ['prose'], required: true, repeatable: false, blueprint },
        { slotId: 'slot_b', allowed: ['prose'], required: true, repeatable: false, blueprint },
      ],
    }),
    REQUEST
  );
  assert.ok(result.ok, result.ok ? '' : result.error);
  const ids = result.body.sections.map((section) => section.id);
  assert.equal(new Set(ids).size, 2);
});

test('caller-supplied seo is used verbatim', () => {
  const result = buildPageBodyFromTemplate(template(), {
    ...REQUEST,
    seo: { description: 'A probe.', robots: { index: false, follow: true } },
  });
  assert.ok(result.ok);
  assert.deepEqual(result.body.seo, { description: 'A probe.', robots: { index: false, follow: true } });
});

test('blueprintRef slots copy from the pre-resolved map with a fresh id (W8.2)', () => {
  const composed = template({
    slots: [{ slotId: 'slot_hero', allowed: ['hero'], required: true, repeatable: false, blueprintRef: 'stpl_hero' }],
  });
  const blueprint = {
    id: 's_stplhero',
    type: 'hero' as const,
    data: { heading: 'Recipe heading', actions: [] },
  };
  const result = buildPageBodyFromTemplate(composed, { ...REQUEST, resolvedBlueprints: { stpl_hero: blueprint } });
  assert.ok(result.ok, result.ok ? '' : result.error);
  assert.equal(result.body.sections.length, 1);
  assert.equal(result.body.sections[0]!.type, 'hero');
  assert.deepEqual(result.body.sections[0]!.data, blueprint.data);
  assert.notEqual(result.body.sections[0]!.id, 's_stplhero', 'fresh minted id, never the placeholder');
  assert.ok(pageBodySchema.safeParse(result.body).success);
});

test('a blueprintRef missing from the resolved map is an error naming the slot and the ref (W8.2)', () => {
  const composed = template({
    slots: [{ slotId: 'slot_hero', allowed: ['hero'], required: true, repeatable: false, blueprintRef: 'stpl_ghost' }],
  });
  const result = buildPageBodyFromTemplate(composed, REQUEST);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /slot_hero.*stpl_ghost/);
});
