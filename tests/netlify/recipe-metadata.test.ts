/**
 * W8.3b — the recipe self-description rule: every recipe (template /
 * section_template / theme) must carry description, whenToUse, and scope
 * ('evergreen' | 'one_off') to PUBLISH; drafts warn. Schema-optional — the
 * additive guarantee that keeps pre-W8.3b records (the 3 production tpl_*)
 * parsing.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { checkRecipeMetadata, summarizeValidation, validateObject } from '../../netlify/lib/object-validate.js';
import { sectionTemplateBodySchema } from '../../src/schema/bodies/section-template-v1.js';
import { templateBodySchema } from '../../src/schema/bodies/template-v1.js';
import { themeBodySchema } from '../../src/schema/bodies/theme-v1.js';
import type { ObjectType } from '../../src/schema/object-record-v1.js';

const META = {
  description: 'A probe recipe.',
  whenToUse: 'Never — test fixture.',
  scope: 'one_off' as const,
};

const templateBody = (extra: Record<string, unknown> = {}) => ({
  name: 'Probe',
  appliesTo: ['standard'],
  slots: [],
  ...extra,
});
const stplBody = (extra: Record<string, unknown> = {}) => ({
  name: 'Probe',
  blueprint: { id: 's_bp', type: 'cta_banner', data: { heading: 'Go', actions: [] } },
  ...extra,
});
const themeBody = (extra: Record<string, unknown> = {}) => ({
  name: 'Probe',
  tokens: {
    colors: {
      primary: '#112233',
      secondary: '#223344',
      accent: '#334455',
      gold: '#c2a878',
      'text-heading': '#0b0d0f',
      'text-default': '#24292e',
      'text-muted': '#3a4149',
      'bg-page': '#fcfbf8',
      'bg-surface': '#f7f5f0',
      'bg-page-dark': '#030620',
    },
    fonts: { sans: 'Inter', serif: 'Georgia', heading: 'Inter' },
  },
  ...extra,
});

// ═══ the additive schema guarantee ════════════════════════════════════════════

test('all three bodies parse WITH the trio, WITHOUT it (pre-W8.3b records), and reject a bad scope', () => {
  assert.ok(templateBodySchema.safeParse(templateBody(META)).success);
  assert.ok(templateBodySchema.safeParse(templateBody()).success, 'the 3 production tpl_* bodies keep parsing');
  assert.ok(sectionTemplateBodySchema.safeParse(stplBody(META)).success);
  assert.ok(sectionTemplateBodySchema.safeParse(stplBody()).success);
  assert.ok(themeBodySchema.safeParse(themeBody(META)).success);
  assert.ok(themeBodySchema.safeParse(themeBody()).success);
  assert.equal(templateBodySchema.safeParse(templateBody({ ...META, scope: 'strategic' })).success, false);
});

// ═══ the criterion itself ═════════════════════════════════════════════════════

test('checkRecipeMetadata: complete when all three are present; each absence is named; empty-after-trim counts missing', () => {
  assert.equal(checkRecipeMetadata({ ...META }, true)[0]!.status, 'complete');
  for (const drop of ['description', 'whenToUse', 'scope'] as const) {
    const body: Record<string, unknown> = { ...META };
    delete body[drop];
    const atPublish = checkRecipeMetadata(body, true)[0]!;
    assert.equal(atPublish.status, 'missing');
    assert.match(atPublish.message, new RegExp(drop));
    assert.equal(checkRecipeMetadata(body, false)[0]!.status, 'warning', 'drafts warn, never block');
  }
  assert.equal(checkRecipeMetadata({ ...META, description: '   ' }, true)[0]!.status, 'missing');
});

// ═══ dispatched through the full pipeline, per type ═══════════════════════════

const cases: Array<[ObjectType, string, Record<string, unknown>, Record<string, unknown>]> = [
  ['template', 'tpl_probe', templateBody(META), templateBody()],
  ['section_template', 'stpl_probe', stplBody(META), stplBody()],
  ['theme', 'thm_probe', themeBody(META), themeBody()],
];

for (const [objectType, objectId, complete, incomplete] of cases) {
  test(`${objectType}: metadata-complete publishes clean; metadata-less drafts pass but publishing blocks`, () => {
    const publishComplete = summarizeValidation(
      validateObject({ objectType, objectId, body: complete }, { publishIntent: true })
    );
    assert.deepEqual(publishComplete.blockers, [], JSON.stringify(publishComplete.blockers));

    const draftIncomplete = summarizeValidation(validateObject({ objectType, objectId, body: incomplete }, {}));
    assert.deepEqual(draftIncomplete.blockers, [], 'a draft without metadata is legal (warns)');

    const publishIncomplete = summarizeValidation(
      validateObject({ objectType, objectId, body: incomplete }, { publishIntent: true })
    );
    assert.ok(
      publishIncomplete.blockers.some((blocker) => blocker.id === 'recipe_metadata'),
      JSON.stringify(publishIncomplete.blockers)
    );
  });
}
