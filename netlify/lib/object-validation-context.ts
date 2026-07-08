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
import type { ObjectValidationContext, PageTypeConstraint } from './object-validate.js';
import type { ObjectVerbStore } from './object-verbs.js';
import { getPageTypeDefinition } from '../../src/lib/registry/page-types.js';
import { isRegisteredSectionType } from '../../src/lib/registry/components/registered-types.js';
import { objectTypes, type ObjectRecord, type ObjectType } from '../../src/schema/object-record-v1.js';
import type { SectionType } from '../../src/schema/bodies/section-v1.js';

type SelfRef = { selfObjectId?: string; selfObjectType?: ObjectType };

type TaxonomyTerm = { term_id: string; status?: string; merged_into?: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

export const buildStoreValidationContext = async (
  store: ObjectVerbStore,
  self: SelfRef = {}
): Promise<ObjectValidationContext> => {
  // key: `${objectType}:${objectId}` → record. content_item lives in a
  // different store (the article pipeline) and is never referenced here.
  const records = new Map<string, ObjectRecord>();
  for (const objectType of objectTypes) {
    if (objectType === 'content_item') continue;
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

  const resolveObject: ObjectValidationContext['resolveObject'] = (objectType, objectId) => {
    const record = records.get(`${objectType}:${objectId}`);
    if (!record) return { exists: false };
    return { exists: true, published: record.publication?.published_time != null };
  };

  const resolveSharedSectionType: ObjectValidationContext['resolveSharedSectionType'] = (objectId) => {
    const body = records.get(`section:${objectId}`)?.body;
    if (!isRecord(body) || !isRecord(body.section) || typeof body.section.type !== 'string') return undefined;
    return body.section.type as SectionType;
  };

  const isRouteTaken: ObjectValidationContext['isRouteTaken'] = (route) => {
    for (const [key, record] of records) {
      if (!key.startsWith('page:')) continue;
      if (record.object_id === self.selfObjectId) continue;
      if (isRecord(record.body) && record.body.route === route) return true;
    }
    return false;
  };

  const resolvePageType: ObjectValidationContext['resolvePageType'] = (pageTypeId) => {
    const lookup = getPageTypeDefinition(pageTypeId);
    if (!lookup.ok) return undefined;
    const { id, allowedSections, requiredSections } = lookup.definition;
    const constraint: PageTypeConstraint = { id, allowedSections };
    if (requiredSections) constraint.requiredSections = requiredSections;
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
          let term = terms.find((candidate) => candidate.term_id === termId);
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
    isRouteTaken,
    resolvePageType,
    componentTypeExists,
    ...(resolveTaxonomyTerm ? { resolveTaxonomyTerm } : {}),
  };
};
