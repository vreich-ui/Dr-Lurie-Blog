/**
 * Seed data for the default theme preset (W8.3 — 09-template-system-plan §6.5).
 *
 * ONE seed only (design-principles rule 1 — agents mint variants on demand):
 * `thm_drlurie_default`, whose tokens are IMPORTED from the site seed so the
 * default theme is byte-identical to the production palette — applying it to
 * the untouched site is a provable no-op (the W8.4 zero-risk end-to-end
 * proof), and the two sources cannot drift.
 *
 * Consumed by scripts/home-conversion-roundtrip.mjs via
 *   --seeds scripts/lib/themes-seed-data.mjs
 * which drills the one theme op (set_theme_fields) ending byte-identical to
 * the seed. (site_apply_theme is a verb, not a patch op — the driver proves
 * it with a dry_run, the instantiate precedent.)
 */
import { siteBody } from './site-seed-data.mjs';

export const SEED_SITE = 'site_drlurie';

export const themeDefaultBody = {
  name: 'Dr. Lurié default',
  description: 'The production palette, verbatim from the site seed — applying it to the untouched site is a no-op.',
  whenToUse:
    'Apply to restore the canonical production palette after theme experiments, or copy as the starting point when drafting a new palette variant.',
  scope: 'evergreen',
  tokens: structuredClone(siteBody.brandTokens),
};

// W10 T10.8: a variant preset exercising the T10.1 token axes — the same
// canonical palette (colors/fonts untouched) with a narrow, airy, editorial
// posture. Applying it is the axis demonstration: palette identical, feel
// shifts. thm_drlurie_default stays byte-identical to production (the
// sync/drift-guard posture is untouched).
export const themeEditorialAiryBody = {
  name: 'Editorial airy',
  description:
    'The canonical palette with the reading posture shifted: narrow container, airy section rhythm, editorial type scale, soft radii. A token-axis demonstration preset.',
  whenToUse:
    'Apply to preview the T10.1 design axes on the live palette \u2014 a demonstration preset, not a rebrand. Revert with thm_drlurie_default.',
  scope: 'evergreen',
  tokens: {
    ...structuredClone(siteBody.brandTokens),
    layout: { containerWidth: 'narrow', sectionRhythm: 'airy' },
    shape: { radius: 'soft' },
    type: { scale: 'editorial' },
  },
};

export const CONVERSION_SEEDS = [
  { objectType: 'theme', objectId: 'thm_drlurie_default', body: themeDefaultBody },
  { objectType: 'theme', objectId: 'thm_editorial_airy', body: themeEditorialAiryBody },
];
