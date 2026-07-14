/**
 * Store-backed validation context (the "make the advertised boundaries bite"
 * half of the object-contract work). The generic object write path
 * (object-store.ts / admin-object.ts) previously called `handleObjectVerb` with
 * NO validation context, so every resolver-dependent criterion — reference
 * integrity, PageType allowed/required sections, route uniqueness, template
 * registry membership, taxonomy-term resolution — degraded to `optional` and
 * did not actually gate a write. This builds a real `ObjectValidationContext`
 * from the site-objects store so those rules are enforced live.
 *
 * The T0.7 resolvers are SYNCHRONOUS (validation runs synchronously), but the
 * store is async — so this pre-loads every object record once (the site-objects
 * store is small: a handful of pages/navs/sections) and the returned resolvers
 * are sync closures over that in-memory snapshot. One list+get sweep per write;
 * revisit if the store grows large.
 *
 * `isRouteTaken` excludes the object under validation (`selfObjectId`) so a page
 * re-saving its own route is not a false conflict.
 */
import { collectBlobListItems } from './blob-list.js';
import { loadContentItemIds } from './content-item-index.js';
import type { ObjectValidationContext, PageTypeConstraint } from './object-validate.js';
import type { ObjectVerbStore } from './object-verbs.js';
import { getPageTypeDefinition } from '../../src/lib/registry/page-types.js';
import { isRegisteredSectionType } from '../../src/lib/registry/components/registered-types.js';
import { objectTypes, type ObjectRecord, type ObjectType } from '../../src/schema/object-record-v1.js';
import type { SectionType } from '../../src/schema/bodies/section-v1.js';

type SelfRef = { selfObjectId?: string; selfObjectType?: ObjectType };

type TaxonomyTerm = { term_id: string; slug?: string; status?: string; merged_into?: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

export const buildStoreValidationContext = async (
  store: ObjectVerbStore,
  self: SelfRef = {}
): Promise<ObjectValidationContext> => {
  // key: `${objectType}:${objectId}` → record. content_item records live in
  // this store since W7.3 (articles as governed objects); the COMMITTED legacy
  // posts additionally resolve via the content-item index below (trap 4) —
  // both families answer content_item references and share the slug space.
  const records = new Map<string, ObjectRecord>();
  for (const objectType of objectTypes) {
    const listResult = await store.list({ prefix: `objects/${objectType}/by-id/`, directories: false, paginate: true });
    for (const item of await collectBlobListItems(listResult)) {
      const raw = await store.get(item.key);
      if (!raw) continue;
      try {
        const record = JSON.parse(raw) as ObjectRecord;
        records.set(`${objectType}:${record.object_id}`, record);
      } catch {
        // A corrupt record shouldn't crash validation; treat it as absent.
      }
    }
  }

  // Committed article ids (filenames under src/data/post, via the GitHub
  // contents API — the W3 source of truth). `undefined` when the lookup is
  // unavailable (no GitHub env locally / transient error): the resolver then
  // answers "cannot verify" for content_item refs instead of failing them.
  const contentItemIds = await loadContentItemIds();

  const resolveObject: ObjectValidationContext['resolveObject'] = (objectType, objectId) => {
    if (objectType === 'content_item') {
      // A store record (W7.3 article object) or a committed legacy post id.
      const record = records.get(`content_item:${objectId}`);
      if (record) return { exists: true, published: record.publication?.published_time != null };
      if (contentItemIds?.has(objectId)) return { exists: true };
      return contentItemIds ? { exists: false } : undefined;
    }
    const record = records.get(`${objectType}:${objectId}`);
    if (!record) return { exists: false };
    return { exists: true, published: record.publication?.published_time != null };
  };

  const resolveSharedSectionType: ObjectValidationContext['resolveSharedSectionType'] = (objectId) => {
    const body = records.get(`section:${objectId}`)?.body;
    if (!isRecord(body) || !isRecord(body.section) || typeof body.section.type !== 'string') return undefined;
    return body.section.type as SectionType;
  };

  // The resolveSharedSectionType sibling for template slot blueprintRefs
  // (W8.2): the blueprint type of a section_template record.
  const resolveSectionTemplateType: ObjectValidationContext['resolveSectionTemplateType'] = (objectId) => {
    const body = records.get(`section_template:${objectId}`)?.body;
    if (!isRecord(body) || !isRecord(body.blueprint) || typeof body.blueprint.type !== 'string') return undefined;
    return body.blueprint.type as SectionType;
  };

  const isRouteTaken: ObjectValidationContext['isRouteTaken'] = (route) => {
    for (const [key, record] of records) {
      if (!key.startsWith('page:')) continue;
      if (record.object_id === self.selfObjectId) continue;
      if (isRecord(record.body) && record.body.route === route) return true;
    }
    return false;
  };

  // The /shop/<slug> analogue of isRouteTaken (06-shop-module-plan §1),
  // scanning product records instead of page routes.
  const isSlugTaken: ObjectValidationContext['isSlugTaken'] = (slug) => {
    for (const [key, record] of records) {
      if (!key.startsWith('product:')) continue;
      if (record.object_id === self.selfObjectId) continue;
      if (isRecord(record.body) && record.body.slug === slug) return true;
    }
    return false;
  };

  // Article slugs share ONE permalink space across content_item objects and
  // the committed legacy posts (their filename stems ARE their slugs). W7.3.
  const isArticleSlugTaken: ObjectValidationContext['isArticleSlugTaken'] = (slug) => {
    for (const [key, record] of records) {
      if (!key.startsWith('content_item:')) continue;
      if (record.object_id === self.selfObjectId) continue;
      if (isRecord(record.body) && record.body.slug === slug) return true;
    }
    return contentItemIds?.has(slug) ?? false;
  };

  const resolvePageType: ObjectValidationContext['resolvePageType'] = (pageTypeId) => {
    const lookup = getPageTypeDefinition(pageTypeId);
    if (!lookup.ok) return undefined;
    const { id, allowedSections, requiredSections, minVisibleSections } = lookup.definition;
    const constraint: PageTypeConstraint = { id, allowedSections };
    if (requiredSections) constraint.requiredSections = requiredSections;
    if (minVisibleSections !== undefined) constraint.minVisibleSections = minVisibleSections;
    return constraint;
  };

  const componentTypeExists: ObjectValidationContext['componentTypeExists'] = (type) => isRegisteredSectionType(type);

  // Only supply the taxonomy resolver when at least one taxonomy object exists —
  // otherwise every term reference would read as unresolvable (a false positive)
  // rather than "not verified".
  const taxonomyRecords = [...records].filter(([key]) => key.startsWith('taxonomy:')).map(([, record]) => record);
  const resolveTaxonomyTerm: ObjectValidationContext['resolveTaxonomyTerm'] | undefined = taxonomyRecords.length
    ? (kind, termId) => {
        for (const record of taxonomyRecords) {
          const body = record.body;
          const kinds = isRecord(body) && isRecord(body.kinds) ? body.kinds : undefined;
          const kindNode = kinds && isRecord(kinds[kind]) ? (kinds[kind] as Record<string, unknown>) : undefined;
          const terms = (Array.isArray(kindNode?.terms) ? kindNode.terms : []) as TaxonomyTerm[];
          const seen = new Set<string>();
          // Match by term_id OR slug (the shapes cannot collide: ids carry
          // underscores, slugs are hyphen-only) — nav targets pass ids,
          // article taxonomy passes the W3 frontmatter slugs (W7.3).
          let term = terms.find((candidate) => candidate.term_id === termId || candidate.slug === termId);
          // Follow merged_into aliases to the canonical term (D§5.5).
          while (term?.merged_into && !seen.has(term.term_id)) {
            seen.add(term.term_id);
            term = terms.find((candidate) => candidate.term_id === term!.merged_into);
          }
          if (term) return { active: term.status === 'active' };
        }
        return undefined;
      }
    : undefined;

  return {
    resolveObject,
    resolveSharedSectionType,
    resolveSectionTemplateType,
    isRouteTaken,
    isSlugTaken,
    isArticleSlugTaken,
    resolvePageType,
    componentTypeExists,
    ...(resolveTaxonomyTerm ? { resolveTaxonomyTerm } : {}),
  };
};
