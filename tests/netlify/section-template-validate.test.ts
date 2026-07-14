/**
 * W8.1 validation rules: the section_template blueprint placeability check
 * (checkSectionTemplate) and the page/shared-section standalone-placeability
 * fix for the Session-K gap — a `card` section that parses under the zod
 * union but has no standalone component killed the production build
 * ("No component registered for section type 'card'", 2026-07-13) after
 * validation admitted it as a top-level page section.
 *
 * One predicate serves every enforcement site (isStandalonePlaceableSectionType,
 * src/lib/registry/components/registered-types.ts), so these rules cannot
 * drift from each other or from the renderer's dispatch registry.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  checkSectionTemplate,
  checkStructuralInvariants,
  summarizeValidation,
  validateObject,
  type ReadinessCriterion,
} from '../../netlify/lib/object-validate.js';

const statusOf = (criteria: ReadinessCriterion[], id: string): string | undefined =>
  criteria.find((criterion) => criterion.id === id)?.status;

const heroBlueprint = () => ({
  id: 's_bp',
  type: 'hero',
  data: { heading: 'A heading', actions: [] },
});

// ═══ checkSectionTemplate (dispatched for object type section_template) ══════

test('a component-bound blueprint type passes', () => {
  const body = { name: 'Hero recipe', blueprint: heroBlueprint() };
  assert.equal(
    statusOf(checkStructuralInvariants('section_template', 'stpl_x', body, {}, false), 'blueprint_standalone_renderable'),
    'complete'
  );
});

test('REJECTION: a card blueprint is a blocker — a leaf has no standalone component', () => {
  const body = { name: 'Card recipe', blueprint: { id: 's_bp', type: 'card', data: { title: 'One card' } } };
  const criteria = checkSectionTemplate(body);
  assert.equal(statusOf(criteria, 'blueprint_standalone_renderable'), 'missing');
  assert.match(criteria[0]!.message, /content_grid cards source/);
});

test('REJECTION: a shared_ref blueprint is a blocker — a pointer is not a recipe', () => {
  const body = { name: 'Pointer recipe', blueprint: { id: 's_bp', type: 'shared_ref', data: { section: 'sec_x' } } };
  const criteria = checkSectionTemplate(body);
  assert.equal(statusOf(criteria, 'blueprint_standalone_renderable'), 'missing');
  assert.match(criteria[0]!.message, /copies, never aliases/);
});

test('an unrecognized body shape reports optional (the schema check owns it)', () => {
  assert.equal(statusOf(checkSectionTemplate({ name: 'x' }), 'blueprint_standalone_renderable'), 'optional');
});

test('full pipeline: a valid recipe validates clean; renderability runs the REAL splitters over the blueprint', () => {
  const clean = summarizeValidation(
    validateObject(
      {
        objectType: 'section_template',
        objectId: 'stpl_probe',
        body: { name: 'Hero recipe', blueprint: heroBlueprint() },
      },
      {}
    )
  );
  assert.deepEqual(clean.blockers, []);

  // A heading-bearing hero body (h2 is in the global allowlist but hero is
  // paragraph-only) would kill the build — the splitter check must catch it.
  const buildBreaker = summarizeValidation(
    validateObject(
      {
        objectType: 'section_template',
        objectId: 'stpl_probe',
        body: {
          name: 'Hero recipe',
          blueprint: { id: 's_bp', type: 'hero', data: { heading: 'H', body: '<h2>Not allowed here</h2>', actions: [] } },
        },
      },
      {}
    )
  );
  assert.ok(
    buildBreaker.blockers.some((blocker) => blocker.id === 'render_splitters'),
    JSON.stringify(buildBreaker.blockers)
  );
});

// ═══ the Session-K leaf fix: pages ═══════════════════════════════════════════

const pageWith = (sections: unknown[]) => ({
  route: '/probe',
  pageType: 'standard',
  title: 'Probe',
  seo: { description: 'Probe.' },
  sections,
});

test('REJECTION: a standalone card section on a page is a blocker at WRITE time', () => {
  const body = pageWith([{ id: 's_card', type: 'card', data: { title: 'One card' } }]);
  const criteria = checkStructuralInvariants('page', 'page_probe', body, {}, false);
  assert.equal(statusOf(criteria, 'structure_placeable'), 'missing');
  assert.match(criteria.find((c) => c.id === 'structure_placeable')!.message, /card/);
});

test('shared_ref stays legal on pages; cards-source grid CELLS are untouched by the rule', () => {
  const body = pageWith([
    { id: 's_ref', type: 'shared_ref', data: { section: 'sec_newsletter_signup' } },
    {
      id: 's_grid',
      type: 'content_grid',
      data: { heading: 'Grid', limit: 4, source: { kind: 'cards', cards: [{ title: 'Cell one' }, { title: 'Cell two' }] } },
    },
  ]);
  assert.equal(statusOf(checkStructuralInvariants('page', 'page_probe', body, {}, false), 'structure_placeable'), 'complete');
});

// ═══ the Session-K leaf fix: shared-section wrappers ═════════════════════════

test('REJECTION: a shared section wrapping a card is a blocker', () => {
  const body = { section: { id: 's_x', type: 'card', data: { title: 'One card' } } };
  const criteria = checkStructuralInvariants('section', 'sec_probe', body, {}, false);
  assert.equal(statusOf(criteria, 'structure_placeable'), 'missing');
});

test('REJECTION: a shared section wrapping a shared_ref is a blocker (no reference chains)', () => {
  const body = { section: { id: 's_x', type: 'shared_ref', data: { section: 'sec_other' } } };
  const criteria = checkStructuralInvariants('section', 'sec_probe', body, {}, false);
  assert.equal(statusOf(criteria, 'structure_placeable'), 'missing');
  assert.match(criteria.find((c) => c.id === 'structure_placeable')!.message, /reference chains/);
});

test('a component-bound wrapped instance passes; grid warnings still surface alongside', () => {
  const body = {
    section: {
      id: 's_x',
      type: 'content_grid',
      data: { heading: 'Grid', limit: 1, source: { kind: 'cards', cards: [{ title: 'A' }, { title: 'B' }] } },
    },
  };
  const criteria = checkStructuralInvariants('section', 'sec_probe', body, {}, false);
  assert.equal(statusOf(criteria, 'structure_placeable'), 'complete');
  assert.equal(statusOf(criteria, 'content_grid_card_limit'), 'warning');
});

// ═══ regression pin: the committed showcase page (21 sections) stays valid ═══

// Session K fixed /object-showcase by replacing its standalone `card` with a
// `cards`-source content_grid. The committed export must keep validating now
// that the engine enforces what that fix assumed — if this fails, the rule is
// over-broad (e.g. it started rejecting grid cells or shared_refs).
test('the committed /object-showcase export passes the new placeability rule', () => {
  // The CI harness compiles into .tmp/ci-test and runs from there — walk up to
  // the repo root (the seed-objects-enforcement idiom).
  let dir = process.cwd();
  for (let i = 0; i < 10 && !existsSync(join(dir, 'src', 'data', 'site')); i += 1) dir = dirname(dir);
  const exportPath = join(dir, 'src/data/site/pages/page_object_showcase.json');
  const raw = JSON.parse(readFileSync(exportPath, 'utf8')) as Record<string, unknown>;
  const { __generated: _marker, ...body } = raw;
  void _marker;
  const criteria = checkStructuralInvariants('page', 'page_object_showcase', body, {}, false);
  assert.equal(statusOf(criteria, 'structure_placeable'), 'complete');
});
