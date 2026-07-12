/**
 * Edit-mode canvas — pure target/ops derivation (no DOM).
 *
 * The build annotates every rendered section with its identity
 * (src/lib/renderer/section-annotations.ts). These helpers turn that
 * annotation into the object the MCP verbs actually edit, and an Ask-AI
 * suggestion into the reviewable patch ops that persist it. Pure functions so
 * the routing rules are unit-tested without a browser:
 *
 * - An inline section is edited on its PAGE (`update_section_data` scoped by
 *   the page instance id).
 * - A shared_ref-derived section is edited on the SHARED OBJECT (sec_*) it
 *   dereferenced from — never on the referencing page. Its inner instance id
 *   comes back from the section-scoped Ask-AI response (or a record get),
 *   since the page annotation only knows the reference.
 */

export type EditTarget = {
  /** The object the verbs edit. */
  objectType: 'page' | 'section' | 'navigation';
  objectId: string;
  /** Page targets: the section instance the request scopes to. */
  sectionId?: string;
  sectionType: string;
  /** The page object the region renders on (context/labels). */
  hostObjectId: string;
  /** True when editing routes to a shared section object. */
  shared: boolean;
};

/** Camel-cased dataset keys of the data-cms-* annotation attributes. */
export type SectionAnnotationDataset = Partial<
  Record<'cmsObjectId' | 'cmsSectionId' | 'cmsSectionType' | 'cmsSharedObject', string>
>;

/** Camel-cased dataset keys of the data-cms-nav-* chrome annotation. */
export type NavAnnotationDataset = Partial<Record<'cmsNavObject' | 'cmsNavRole', string>>;

/**
 * Chrome (header/footer) regions target the NAVIGATION object they render
 * from. Marked shared: nav renders on every page, so an edit is site-wide —
 * the same "affects every page using it" banner shared sections get.
 */
export const deriveNavTarget = (dataset: NavAnnotationDataset): EditTarget | undefined => {
  const { cmsNavObject, cmsNavRole } = dataset;
  if (!cmsNavObject) return undefined;
  return {
    objectType: 'navigation',
    objectId: cmsNavObject,
    sectionType: `${cmsNavRole ?? 'site'} navigation`,
    hostObjectId: cmsNavObject,
    shared: true,
  };
};

export const deriveEditTarget = (dataset: SectionAnnotationDataset): EditTarget | undefined => {
  const { cmsObjectId, cmsSectionId, cmsSectionType, cmsSharedObject } = dataset;
  if (!cmsObjectId || !cmsSectionId || !cmsSectionType) return undefined;
  if (cmsSharedObject) {
    return {
      objectType: 'section',
      objectId: cmsSharedObject,
      sectionType: cmsSectionType,
      hostObjectId: cmsObjectId,
      shared: true,
    };
  }
  return {
    objectType: 'page',
    objectId: cmsObjectId,
    sectionId: cmsSectionId,
    sectionType: cmsSectionType,
    hostObjectId: cmsObjectId,
    shared: false,
  };
};

/**
 * The reviewable ops an accepted suggestion persists — always
 * `update_section_data`, scoped by the page instance id (page targets) or the
 * inner instance id the scoped Ask-AI response named (shared targets).
 */
export const suggestionToOps = (
  target: EditTarget,
  suggestion: Record<string, unknown>,
  respondedSectionId?: string
): Array<Record<string, unknown>> => {
  const sectionId = target.objectType === 'page' ? target.sectionId : respondedSectionId;
  if (!sectionId) {
    throw new Error('suggestionToOps: no section instance id to scope the patch to');
  }
  return [{ op: 'update_section_data', section_id: sectionId, fields: suggestion }];
};

export type FieldChange = {
  field: string;
  before: unknown;
  after: unknown;
  /** 'html' = a rich-text HTML string; 'string' = plain text; 'json' = anything else. */
  kind: 'html' | 'string' | 'json';
};

const LOOKS_LIKE_HTML = /<[a-z][\s\S]*>/i;

const changeKind = (before: unknown, after: unknown): FieldChange['kind'] => {
  if (typeof after === 'string' && typeof before !== 'object') {
    return LOOKS_LIKE_HTML.test(after) || (typeof before === 'string' && LOOKS_LIKE_HTML.test(before))
      ? 'html'
      : 'string';
  }
  return 'json';
};

const deepEqualJson = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => deepEqualJson(v, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a as Record<string, unknown>);
    const kb = Object.keys(b as Record<string, unknown>);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqualJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
};

/**
 * The per-field change list a suggestion proposes against the section's
 * CURRENT record data (the record, not the DOM — the draft may already be
 * ahead of the published page). Unchanged fields are dropped so the reviewer
 * sees only real edits; the suggestion the caller PATCHES should be the
 * filtered set too, keeping no-op writes out of history.
 */
export const summarizeFieldChanges = (
  currentData: Record<string, unknown>,
  suggestion: Record<string, unknown>
): FieldChange[] =>
  Object.entries(suggestion)
    .filter(([field, after]) => !deepEqualJson(currentData[field], after))
    .map(([field, after]) => ({
      field,
      before: currentData[field],
      after,
      kind: changeKind(currentData[field], after),
    }));

/** The filtered suggestion actually worth patching (only real changes). */
export const changedFieldsOnly = (changes: FieldChange[]): Record<string, unknown> =>
  Object.fromEntries(changes.map((change) => [change.field, change.after]));
