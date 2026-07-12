/**
 * `%term%` interpolation for per-term listing surfaces (W6/T6.1).
 *
 * One listing page object serves a whole route family (page_category serves
 * every /category/<slug> page, page_tag every /tag/<slug> page, and
 * page_topic_detail every /learn/topics/<slug> page). The object's copy is
 * therefore PATTERN copy: any string field may carry the literal token
 * `%term%`, and the loader substitutes the concrete term's display label at
 * build time — so "Tag: %term%" is an agent-editable heading pattern, not a
 * hardcoded string, while the query machinery stays the audited build-time
 * derivation (A§2.5–2.7).
 *
 * The substitution walks every string VALUE in the body (keys untouched), so
 * the token works in headings, rich-text bodies, seo fields, and any section
 * an agent adds later. Kept pure and Astro-free so it is unit-testable
 * offline. Precedent for %-token pattern copy: the site object's
 * metadataDefaults title template ('%s — Dr. Lurié').
 */

export const LISTING_TERM_TOKEN = '%term%';

const substitute = (value: string, term: string): string => value.split(LISTING_TERM_TOKEN).join(term);

/**
 * Deep-clone `value` with every occurrence of `%term%` in string values
 * replaced by `term`. Arrays and plain objects are walked; every other type
 * passes through untouched.
 */
export const applyListingTerm = <T>(value: T, term: string): T => {
  if (typeof value === 'string') return substitute(value, term) as T;
  if (Array.isArray(value)) return value.map((entry) => applyListingTerm(entry, term)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, applyListingTerm(entry, term)])
    ) as T;
  }
  return value;
};
