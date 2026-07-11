/**
 * Combined seed module — every object SEEDED-at-RENDERS and still awaiting its
 * one credentialed production run (2026-07-11). Lets the whole backlog convert
 * in a SINGLE driver invocation with a SINGLE production deploy, instead of one
 * command per family:
 *
 *   node scripts/home-conversion-roundtrip.mjs --production --release \
 *     --seeds scripts/lib/pending-conversion-seeds.mjs
 *
 * (scripts/convert-pending-production.sh wraps exactly this with a preflight.)
 *
 * Aggregates, in order (families are independent — none references another, and
 * their shared nav targets are already converted in production, so any order is
 * safe):
 *   - W1   pages-interior-seed-data.mjs   5 lede + 3 system pages
 *   - W2.5 templates-seed-data.mjs        tpl_interior / tpl_landing / tpl_legal
 *   - W2   pages-forms-seed-data.mjs      page_contact + page_thank_you
 *
 * The driver drills page + template objects and, for each template, proves
 * instantiation with a dry_run (persists nothing). As each family converts for
 * real, drop it from this list (or retire the file once the backlog is empty).
 *
 * Already-converted families (home, about, nav) are deliberately EXCLUDED —
 * re-running them would only risk needless reconcile churn against their live
 * store records.
 */
import { CONVERSION_SEEDS as INTERIOR_SEEDS, SEED_SITE as INTERIOR_SITE } from './pages-interior-seed-data.mjs';
import { CONVERSION_SEEDS as TEMPLATE_SEEDS, SEED_SITE as TEMPLATE_SITE } from './templates-seed-data.mjs';
import { CONVERSION_SEEDS as FORM_SEEDS, SEED_SITE as FORM_SITE } from './pages-forms-seed-data.mjs';

const SITES = [INTERIOR_SITE, TEMPLATE_SITE, FORM_SITE];
if (new Set(SITES).size !== 1) {
  throw new Error(`pending-conversion-seeds: families disagree on SEED_SITE: ${SITES.join(', ')}`);
}

export const SEED_SITE = INTERIOR_SITE;

export const CONVERSION_SEEDS = [...INTERIOR_SEEDS, ...TEMPLATE_SEEDS, ...FORM_SEEDS];
