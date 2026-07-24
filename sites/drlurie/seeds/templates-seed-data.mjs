/**
 * Seed data for the starter template recipes (W2.5 — "templates are recipes;
 * PageTypes are law", design-principles rule 5).
 *
 * Three recipes covering the page shapes the site actually grows by:
 *
 *   tpl_interior   standard   lede open + prose body + optional cta close —
 *                             the shape of every W1 interior page.
 *   tpl_landing    standard   hero open + curated card grid + cta close —
 *                             the campaign/landing shape.
 *   tpl_legal      system     a single required prose slot with NO blueprint —
 *                             deliberately exercises the documented fallback
 *                             (a required slot without a blueprint instantiates
 *                             from the registry defaultData of its first
 *                             allowed type).
 *
 * Recipes are DATA: agents evolve them freely with the template patch ops, and
 * every blueprint here is self-contained (no shared_refs, no content refs, no
 * asset refs) so an instantiated page validates with zero external targets.
 * Blueprint copy is neutral starter text an agent replaces before publishing —
 * a recipe supplies structure, never finished site content.
 *
 * Consumed by scripts/home-conversion-roundtrip.mjs via
 *   --seeds scripts/lib/templates-seed-data.mjs
 * which drills every template patch op (set_template_meta, upsert_slot,
 * move_slot, remove_slot) and proves instantiation with an
 * object_instantiate_template dry_run — nothing is persisted by the proof, so
 * production runs leave no probe pages behind.
 */

export const SEED_SITE = 'site_drlurie';

// ─── the three recipes ───────────────────────────────────────────────────────

export const templateInteriorBody = {
  name: 'Interior page',
  description:
    'The standard interior-page shape: a quiet lede opener, one or more prose body sections, and an optional closing CTA banner.',
  whenToUse:
    'The default recipe for any evergreen content page — guides, explainers, policies. Pick tpl_landing when the page must convert with a hero + highlight grid; tpl_legal for single-block system boilerplate.',
  scope: 'evergreen',
  appliesTo: ['standard'],
  slots: [
    {
      slotId: 'slot_lede',
      allowed: ['lede'],
      required: true,
      repeatable: false,
      blueprint: {
        id: 's_tplintlede',
        type: 'lede',
        data: { kicker: 'Overview', heading: 'New page heading', actions: [] },
      },
    },
    {
      slotId: 'slot_body',
      allowed: ['prose'],
      required: true,
      repeatable: true,
      blueprint: {
        id: 's_tplintbody',
        type: 'prose',
        data: { body: '<p></p>' },
      },
    },
    {
      slotId: 'slot_cta',
      allowed: ['cta_banner'],
      required: false,
      repeatable: false,
      blueprint: {
        id: 's_tplintcta',
        type: 'cta_banner',
        data: { heading: 'Keep exploring', actions: [] },
      },
    },
  ],
};

export const templateLandingBody = {
  name: 'Landing page',
  description: 'The campaign/landing shape: hero opener, optional curated highlight grid, closing CTA banner.',
  whenToUse:
    'Conversion-weight pages — launches, program and offer pages, campaign destinations. For ordinary informational pages use tpl_interior.',
  scope: 'evergreen',
  appliesTo: ['standard'],
  slots: [
    {
      slotId: 'slot_hero',
      allowed: ['hero'],
      required: true,
      repeatable: false,
      blueprint: {
        id: 's_tpllandhero',
        type: 'hero',
        data: { heading: 'New page heading', actions: [] },
      },
    },
    {
      slotId: 'slot_grid',
      allowed: ['content_grid'],
      required: false,
      repeatable: true,
      blueprint: {
        id: 's_tpllandgrid',
        type: 'content_grid',
        data: {
          heading: 'Highlights',
          source: {
            kind: 'cards',
            cards: [{ title: 'First highlight' }, { title: 'Second highlight' }],
          },
          limit: 4,
        },
      },
    },
    {
      slotId: 'slot_cta',
      allowed: ['cta_banner'],
      required: false,
      repeatable: false,
      blueprint: {
        id: 's_tpllandcta',
        type: 'cta_banner',
        data: { heading: 'Ready for the next step?', actions: [] },
      },
    },
  ],
};

export const templateLegalBody = {
  name: 'Legal page',
  description:
    'A minimal system-page recipe: one required prose slot with no blueprint — instantiation fills it from the prose registry defaultData (the standing proof of the fallback path).',
  whenToUse:
    'Legal and system boilerplate — privacy, terms, disclaimers — where the page is one run of prose and nothing else.',
  scope: 'evergreen',
  appliesTo: ['system'],
  slots: [
    // No blueprint on purpose: instantiation falls back to the prose registry
    // defaultData — the standing proof that the fallback path works end-to-end.
    { slotId: 'slot_body', allowed: ['prose'], required: true, repeatable: true },
  ],
};

// ─── driver contract ─────────────────────────────────────────────────────────

export const CONVERSION_SEEDS = [
  { objectType: 'template', objectId: 'tpl_interior', body: templateInteriorBody },
  { objectType: 'template', objectId: 'tpl_landing', body: templateLandingBody },
  { objectType: 'template', objectId: 'tpl_legal', body: templateLegalBody },
];
