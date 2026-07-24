/**
 * Site singleton loader (W4) — the one place renderers read the published
 * site export (src/data/site/site.json, materialized from `site_drlurie`).
 *
 * Absent export → undefined: every consumer falls back to the value it
 * hardcoded before the conversion (design rule 3 — the site object is chrome
 * and branding; a pre-conversion checkout must still build). A PRESENT export
 * that fails site.v1 throws at module load instead: that is a half-fed
 * surface (a drifted or hand-edited export), and hiding it behind the
 * fallback would mask real drift — same loud-failure stance PageLayout takes
 * for missing navigation.
 *
 * Deliberately SYNCHRONOUS (eager static glob, not getEntry): consumers like
 * Logo/CustomStyles had synchronous frontmatter before W4, and an `await` —
 * even on a resolved memoized promise — changes Astro's concurrent sibling
 * evaluation order, which flips where astro-icon places each `<symbol>` vs
 * `<use>` and breaks the byte-identical cutover gate. The glob matches zero
 * or one file, so a missing export is an empty object, not a build error.
 */
import { siteBodySchema, type SiteBody } from '../../packages/core/schema/bodies/site-v1';

const exports = import.meta.glob('../data/site/site.json', { eager: true, import: 'default' }) as Record<
  string,
  unknown
>;

const load = (): SiteBody | undefined => {
  const [exported] = Object.values(exports);
  if (!exported) return undefined;
  const record = { ...(exported as Record<string, unknown>) };
  delete record.__generated;
  return siteBodySchema.parse(record);
};

const siteObject = load();

export const getSiteObject = (): SiteBody | undefined => siteObject;
