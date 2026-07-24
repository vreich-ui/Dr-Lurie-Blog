/**
 * Publish-time taxonomy enforcement (W3 step 2 — the sanctioned bounded
 * exception to the publish-article off-limits rule; Wolf, 2026-07-11).
 *
 * Implements §5.5/§5.6-step-2 of the architecture doc for articles: when the
 * tax_drlurie registry EXISTS in the site-objects store, every category/tag
 * string on a publish is resolved against it — BY SLUG (the string is
 * slugified first, so labels like "Skin Health" and slugs like "skin-health"
 * both resolve), following `merged_into` aliases so a deprecated term resolves
 * to its successor rather than failing. Strings resolving to no active term
 * (even via aliases) REJECT the publish. Resolved terms come back as their
 * current canonical slugs, which the caller materializes into frontmatter
 * (§5.5 step 3: "stale strings are normalized on every republish").
 *
 * Graceful degradation is structural: no registry record (or an unreadable /
 * unparseable one) → `skipped`, and the publish behaves exactly as before this
 * module existed. Every pre-existing publish-article test runs storeless of
 * taxonomy and therefore takes the skip path — zero behavior change until the
 * registry is adopted (it was converted to production 2026-07-11).
 *
 * The record's own free strings stay lossy input (§3.10 protects the article
 * agent contract) — only the COMMITTED frontmatter is normalized.
 */
import { getSiteIdentity } from '../../lib/site-identity.js';

// W11 T11.5: derived from the site identity seam (tax_<siteShortId>, env-overridable
// via SITE_TAXONOMY_ID) — byte-identical to the old 'tax_drlurie' literal for
// Dr-Lurie. Module-load resolution is safe: every entry that can reach this
// module (incl. the frozen publish-article path, via its netlify/lib shim)
// registers the site providers first.
export const TAXONOMY_RECORD_KEY = `objects/taxonomy/by-id/${getSiteIdentity().taxonomyId}.json`;

type Term = {
  term_id?: string;
  slug?: string;
  label?: string;
  status?: string;
  merged_into?: string;
};

type Kind = 'category' | 'tag';

export type TaxonomyEnforcementResult =
  | { status: 'skipped'; reason: 'registry_unavailable' }
  | { status: 'ok'; category?: string; tags: string[]; term_ids: string[] }
  | { status: 'rejected'; unresolved: string[] };

/**
 * ASCII slugification sufficient for registry slugs (which taxonomy_slugs
 * validation pins to lowercase-hyphen). A string this can't reduce to a
 * registry slug simply fails resolution — the correct outcome.
 */
const slugifyTerm = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Resolve one raw string within a kind: slug match, then merged_into chase. */
const resolveTerm = (terms: Term[], raw: string): Term | undefined => {
  let term = terms.find((candidate) => candidate.slug === slugifyTerm(raw));
  const seen = new Set<string>();
  while (term && term.status !== 'active' && term.merged_into && term.term_id && !seen.has(term.term_id)) {
    seen.add(term.term_id);
    term = terms.find((candidate) => candidate.term_id === term!.merged_into);
  }
  return term && term.status === 'active' ? term : undefined;
};

/**
 * Enforce the registry against a publish's category/tags. `loadRegistry`
 * returns the raw taxonomy ObjectRecord JSON (or null when absent) — injected
 * so the resolution logic is unit-testable without a blob store.
 */
export const enforceTaxonomy = async (
  loadRegistry: () => Promise<string | null>,
  category: string | undefined,
  tags: string[]
): Promise<TaxonomyEnforcementResult> => {
  let termsByKind: Record<Kind, Term[]>;
  try {
    const raw = await loadRegistry();
    if (!raw) return { status: 'skipped', reason: 'registry_unavailable' };
    const record = JSON.parse(raw) as { body?: { kinds?: Record<Kind, { terms?: Term[] }> } };
    const kinds = record.body?.kinds;
    if (!kinds?.category?.terms || !kinds?.tag?.terms) {
      return { status: 'skipped', reason: 'registry_unavailable' };
    }
    termsByKind = { category: kinds.category.terms, tag: kinds.tag.terms };
  } catch {
    // An unreadable/unparseable registry must not brick article publishing.
    return { status: 'skipped', reason: 'registry_unavailable' };
  }

  const unresolved: string[] = [];
  const termIds: string[] = [];

  let canonicalCategory: string | undefined;
  if (category !== undefined && category !== '') {
    const term = resolveTerm(termsByKind.category, category);
    if (term?.slug && term.term_id) {
      canonicalCategory = term.slug;
      termIds.push(term.term_id);
    } else {
      unresolved.push(`category "${category}"`);
    }
  }

  const canonicalTags: string[] = [];
  for (const tag of tags) {
    const term = resolveTerm(termsByKind.tag, tag);
    if (term?.slug && term.term_id) {
      if (!canonicalTags.includes(term.slug)) {
        canonicalTags.push(term.slug);
        termIds.push(term.term_id);
      }
    } else {
      unresolved.push(`tag "${tag}"`);
    }
  }

  if (unresolved.length > 0) return { status: 'rejected', unresolved };
  return { status: 'ok', category: canonicalCategory, tags: canonicalTags, term_ids: termIds };
};
