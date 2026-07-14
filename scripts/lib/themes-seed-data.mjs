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
  tokens: structuredClone(siteBody.brandTokens),
};

export const CONVERSION_SEEDS = [{ objectType: 'theme', objectId: 'thm_drlurie_default', body: themeDefaultBody }];
