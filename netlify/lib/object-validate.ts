/**
 * Generic object validation engine — the six C§2.0 safety checks as a
 * composable pipeline (03-mapping-and-agent-contract.md §2.0 item list).
 *
 * An agent write is "eligible for review" only if none of the checks report a
 * `missing` (hard-failure) criterion. The same report is produced two ways per
 * the contract: `object_patch` rejects the op when any criterion is `missing`;
 * `object_validate` returns the full grouped report as a dry-run. Both call
 * `validateObject`; the caller decides via `summarizeValidation`.
 *
 * The report reuses the exact readiness-report shape and status vocabulary from
 * src/lib/admin/readiness-criteria.ts (A§1.6) — grouped criteria, each
 * `complete | warning | missing | optional`, no numeric score.
 *
 * Reuse over reinvention (per the brief):
 *   - check 1 schema:        the T0.2 body schemas + the node-renderer RichText
 *                            allowlist (A§1.5).
 *   - check 2 id discipline: validateObjectIdForType / validateSectionInstanceId (T0.3).
 *   - check 4 reader safety: assertReaderSafe (A§1.1), generalized to any body.
 *   - check 5 artifact trust: MAJOR_KEY_ARTIFACT_REF_RE + the admin-patch-workflow
 *                            reject rules (A§2.12). admin-patch-workflow is not
 *                            imported from (its reject regexes are module-local);
 *                            the three rules are mirrored here with a citation.
 *
 * Purity: this module never touches the blob store. Reference-integrity and
 * structural checks that need to know what else exists (which pages/sections
 * are published, which taxonomy terms are active, the PageType definition) take
 * injected resolvers on ObjectValidationContext. When a resolver is absent the
 * dependent check is reported `optional` (not verifiable here) rather than
 * `missing` — T0.8 wires real resolvers; unit tests inject fakes.
 *
 * Nav *layout* rules (duplicate-target warnings, empty groups, depth ≤ 2,
 * nav-link-to-unpublished-page) were deliberately left out of T0.7 and land
 * here with T2.1 as `checkNavigationStructure`, dispatched through the same
 * structural-invariants group the page/taxonomy/template rules use.
 *
 * Candidate patches: `validateObject` validates a finished body. The
 * `object_validate {candidate_patch?}` dry-run is `validateCandidatePatch`,
 * which applies the proposed ops through T0.6's real `applyPatchOps` engine
 * (never a re-implementation) and validates the result — so a patch the engine
 * would refuse fails validation with T0.6's own error code, and the op grammar
 * has exactly one owner. T0.8 calls one or the other; this module still never
 * touches the blob store.
 */
import { assertReaderSafe } from '../../src/lib/article-content/assert-reader-safe.js';
import type { CriterionStatus, ReadinessCriterion, ReadinessGroup } from '../../src/lib/admin/readiness-criteria.js';
import { validateObjectIdForType, validateSectionInstanceId } from '../../src/lib/object-ids.js';
import { applyPatchOps, PatchApplyError } from '../../src/lib/object-patch-apply.js';
import { navigationBodySchema, type NavigationBody } from '../../src/schema/bodies/navigation-v1.js';
import { navActionCapacity, type CapacityRule } from '../../src/lib/registry/structural-capacity.js';
import { pageBodySchema } from '../../src/schema/bodies/page-v1.js';
import { sectionBodySchema, type SectionInstance, type SectionType } from '../../src/schema/bodies/section-v1.js';
import { siteBodySchema } from '../../src/schema/bodies/site-v1.js';
import { taxonomyBodySchema } from '../../src/schema/bodies/taxonomy-v1.js';
import { templateBodySchema } from '../../src/schema/bodies/template-v1.js';
import type { ObjectRecord, ObjectType, Principal } from '../../src/schema/object-record-v1.js';
import { MAJOR_KEY_ARTIFACT_REF_RE } from './artifact-trust.js';

export type { CriterionStatus, ReadinessCriterion, ReadinessGroup } from '../../src/lib/admin/readiness-criteria.js';

// ─── injected context ──────────────────────────────────────────────────────

export type ObjectResolution = { exists: boolean; published?: boolean };
export type TaxonomyResolution = { active: boolean };
export type TaxonomyUsage = { inUse: boolean };

export type PageTypeConstraint = {
  id?: string;
  allowedSections: readonly SectionType[] | 'any';
  requiredSections?: readonly SectionType[];
};

export type ObjectValidationContext = {
  /**
   * Resolve an object reference. Keys are type-namespaced, so a truthy `exists`
   * for objectType 'section' already means "exists and is a section". Return
   * undefined only if you cannot answer (treated the same as no resolver for
   * that lookup).
   */
  resolveObject?: (objectType: ObjectType, objectId: string) => ObjectResolution | undefined;
  /** Resolve a taxonomy term_id, following merged_into aliases (D§5.5). */
  resolveTaxonomyTerm?: (kind: 'category' | 'tag', termId: string) => TaxonomyResolution | undefined;
  /**
   * Whether a taxonomy term has live usage on published content (frontmatter
   * strings resolving to it). Used only to enforce "deprecating a term with
   * live usage requires merged_into" (§2.3-taxonomy). Absent → not verified.
   */
  resolveTaxonomyTermUsage?: (kind: 'category' | 'tag', termId: string) => TaxonomyUsage | undefined;
  /** Effective variant type of a shared 'section' object (for structural re-check). */
  resolveSharedSectionType?: (objectId: string) => SectionType | undefined;
  /**
   * Whether a component type exists in the code component registry (D§3.4/OQ-4).
   * Registry lands in P3; absent here → registry membership not verified.
   */
  componentTypeExists?: (type: string) => boolean;
  /**
   * Whether a page `route` is already taken by a DIFFERENT page (the resolver
   * excludes the object under validation). Absent → uniqueness not verified.
   */
  isRouteTaken?: (route: string) => boolean;
  /** Major-Key blobKeys trusted for this object's asset refs (A§2.12). */
  trustedAssetRefs?: Set<string>;
  /** The PageType definition for a page's `pageType` (registry is code, D§3.4/OQ-4). */
  pageType?: PageTypeConstraint;
  /**
   * Resolve a page's PageType constraint from its `pageType` id (the code
   * registry). Preferred over the static `pageType` field for the generic
   * write path, which validates whatever page arrives; `pageType` still wins
   * when set directly (tests). Absent → PageType rules not verified.
   */
  resolvePageType?: (pageTypeId: string) => PageTypeConstraint | undefined;
  /** True when validating a publish (or the record is already published). */
  publishIntent?: boolean;
};

export type ObjectValidationInput = {
  objectType: ObjectType;
  objectId: string;
  body: unknown;
  /** record.publication.published_time != null. */
  published?: boolean;
};

// ─── criterion helpers ───────────────────────────────────────────────────────

const crit = (id: string, label: string, status: CriterionStatus, message: string): ReadinessCriterion => ({
  id,
  label,
  status,
  message,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

/** Depth-first walk of every string leaf, tracking the key path to each. */
const walkStrings = (value: unknown, visit: (path: string[], value: string) => void, path: string[] = []): void => {
  if (typeof value === 'string') {
    visit(path, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkStrings(item, visit, [...path, String(index)]));
    return;
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) walkStrings(child, visit, [...path, key]);
  }
};

/** Deep walk of every object node (for reference-shape recognition). */
const walkObjects = (value: unknown, visit: (node: Record<string, unknown>) => void): void => {
  if (Array.isArray(value)) {
    for (const item of value) walkObjects(item, visit);
    return;
  }
  if (isRecord(value)) {
    visit(value);
    for (const child of Object.values(value)) walkObjects(child, visit);
  }
};

// ─── check 1: per-type zod + RichText allowlist ──────────────────────────────

// A body schema per object type. content_item is validated by the existing
// article pipeline (A§1.6/A§1.8), not re-implemented here.
const BODY_SCHEMAS: Partial<Record<ObjectType, { safeParse: (v: unknown) => { success: boolean; error?: unknown } }>> =
  {
    navigation: navigationBodySchema,
    page: pageBodySchema,
    section: sectionBodySchema,
    template: templateBodySchema,
    site: siteBodySchema,
    taxonomy: taxonomyBodySchema,
  };

// Mirrors node-renderer.ts TIPTAP_ALLOWED (A§1.5): the only tags TipTap emits.
const RICHTEXT_ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'em', 'a', 'ul', 'ol', 'li', 'h2', 'h3']);
const HTML_TAG_RE = /<\/?([a-z][a-z0-9-]*)\b[^>]*>/gi;
const ANCHOR_HREF_RE = /<a\b[^>]*?\bhref\s*=\s*["']([^"']*)["'][^>]*>/gi;
const LOOKS_LIKE_HTML_RE = /<[a-z!/]/i;
const SAFE_HREF_RE = /^https?:\/\//i;

const zodIssueSummary = (error: unknown): string => {
  const issues = isRecord(error) && Array.isArray(error.issues) ? error.issues : [];
  if (issues.length === 0) return 'Body failed per-type schema validation.';
  return issues
    .slice(0, 3)
    .map((issue) => {
      if (!isRecord(issue)) return 'invalid';
      const where = Array.isArray(issue.path) && issue.path.length ? issue.path.join('.') : '(root)';
      return `${where}: ${String(issue.message ?? 'invalid')}`;
    })
    .join('; ');
};

/** Collect RichText allowlist violations across every HTML-bearing string leaf. */
const scanRichText = (body: unknown): string[] => {
  const violations: string[] = [];
  walkStrings(body, (path, value) => {
    // `notes` is private-by-design and never rendered — not RichText.
    if (path.includes('notes')) return;
    if (!LOOKS_LIKE_HTML_RE.test(value)) return;
    const at = path.length ? path.join('.') : '(root)';

    for (const match of value.matchAll(HTML_TAG_RE)) {
      const tag = match[1].toLowerCase();
      if (!RICHTEXT_ALLOWED_TAGS.has(tag))
        violations.push(`${at}: disallowed tag <${tag}> (allowlist ${[...RICHTEXT_ALLOWED_TAGS].join(',')}).`);
    }
    for (const match of value.matchAll(ANCHOR_HREF_RE)) {
      if (!SAFE_HREF_RE.test(match[1])) violations.push(`${at}: link href "${match[1]}" must be http(s).`);
    }
  });
  return violations;
};

export const checkSchema = (objectType: ObjectType, body: unknown): ReadinessCriterion[] => {
  const criteria: ReadinessCriterion[] = [];
  const schema = BODY_SCHEMAS[objectType];

  if (!schema) {
    criteria.push(
      crit(
        'schema_zod',
        'Per-type schema',
        'optional',
        `${objectType} bodies are validated by the existing pipeline, not this engine.`
      )
    );
    return criteria;
  }

  const parsed = schema.safeParse(body);
  criteria.push(
    parsed.success
      ? crit('schema_zod', 'Per-type schema', 'complete', '')
      : crit('schema_zod', 'Per-type schema', 'missing', zodIssueSummary(parsed.error))
  );

  const richTextViolations = scanRichText(body);
  criteria.push(
    richTextViolations.length === 0
      ? crit('schema_richtext', 'RichText allowlist', 'complete', '')
      : crit('schema_richtext', 'RichText allowlist', 'missing', richTextViolations.slice(0, 3).join(' '))
  );

  return criteria;
};

// ─── check 2: ID discipline ──────────────────────────────────────────────────

export const checkIdDiscipline = (objectType: ObjectType, objectId: string, body: unknown): ReadinessCriterion[] => {
  const criteria: ReadinessCriterion[] = [];

  const idResult = validateObjectIdForType(objectType, objectId);
  criteria.push(
    idResult.ok
      ? crit('id_object', 'Object id', 'complete', '')
      : crit('id_object', 'Object id', 'missing', idResult.error ?? 'Invalid object id.')
  );

  // Section instance ids (s_*) inside page/section bodies.
  const badSectionIds: string[] = [];
  walkObjects(body, (node) => {
    if (typeof node.type === 'string' && typeof node.id === 'string' && 'data' in node) {
      // A section instance: { id, type, data, ... }.
      const result = validateSectionInstanceId(node.id);
      if (!result.ok) badSectionIds.push(node.id);
    }
  });
  if (badSectionIds.length > 0) {
    criteria.push(
      crit('id_sections', 'Section instance ids', 'missing', `Invalid section ids: ${badSectionIds.join(', ')}.`)
    );
  } else {
    criteria.push(crit('id_sections', 'Section instance ids', 'complete', ''));
  }

  return criteria;
};

// ─── check 3: reference integrity ────────────────────────────────────────────

const NAV_TARGET_KINDS = new Set(['page', 'taxonomy', 'listing', 'external', 'asset', 'route']);

export const checkReferenceIntegrity = (
  objectType: ObjectType,
  body: unknown,
  context: ObjectValidationContext
): ReadinessCriterion[] => {
  const criteria: ReadinessCriterion[] = [];
  const problems: string[] = [];
  let checkedAnyResolvable = false;
  let sawUnresolvableResolver = false;

  const requireObject = (refType: ObjectType, id: string, label: string) => {
    if (!context.resolveObject) return; // not verifiable here (T0.8 wires it)
    checkedAnyResolvable = true;
    const resolution = context.resolveObject(refType, id);
    if (!resolution || !resolution.exists) {
      sawUnresolvableResolver = true;
      problems.push(`${label} "${id}" does not resolve to an existing ${refType}.`);
    }
  };

  const requireTerm = (kind: 'category' | 'tag', termId: string, label: string) => {
    if (!context.resolveTaxonomyTerm) return;
    checkedAnyResolvable = true;
    const resolution = context.resolveTaxonomyTerm(kind, termId);
    if (!resolution || !resolution.active) {
      sawUnresolvableResolver = true;
      problems.push(`${label} term "${termId}" does not resolve to an active ${kind} term.`);
    }
  };

  walkObjects(body, (node) => {
    // NavTarget (in nav items/groups/actions and page-body LinkActions).
    if (typeof node.kind === 'string' && NAV_TARGET_KINDS.has(node.kind)) {
      if (node.kind === 'page' && typeof node.page === 'string') {
        requireObject('page', node.page, 'NavTarget.page');
      }
      // route-kind is the Gap-Note-2 transitional variant: explicitly ALLOWED,
      // never rejected here. It is removed from the validators in P6 cleanup.
      if (
        node.kind === 'taxonomy' &&
        typeof node.term_id === 'string' &&
        (node.termKind === 'category' || node.termKind === 'tag')
      ) {
        requireTerm(node.termKind, node.term_id, 'NavTarget.taxonomy');
      }
    }

    // Section variants carrying references.
    if (typeof node.type === 'string' && isRecord(node.data)) {
      const data = node.data;
      if (node.type === 'shared_ref' && typeof data.section === 'string') {
        requireObject('section', data.section, 'shared_ref.section');
        // Reference-chain policy (DECISION, previously left implicit — the
        // section-v1 schema comment defers it here): a shared section must
        // NOT itself be a `shared_ref`. The renderer dereferences shared_ref
        // to the target's current variant in a single hop (D§3.5); chains
        // would require multi-hop deref and admit cycles. Enforced whenever
        // the effective target type is resolvable.
        const targetType = context.resolveSharedSectionType?.(data.section);
        if (targetType === 'shared_ref') {
          checkedAnyResolvable = true;
          sawUnresolvableResolver = true;
          problems.push(
            `shared_ref.section "${data.section}" points at another shared_ref — reference chains are not allowed (single-hop only).`
          );
        }
      }
      if (node.type === 'content_embed' && typeof data.contentItem === 'string') {
        requireObject('content_item', data.contentItem, 'content_embed.contentItem');
      }
      if (node.type === 'content_grid' && isRecord(data.source)) {
        const source = data.source;
        const requireQueryTerms = (query: unknown, label: string) => {
          if (!isRecord(query)) return;
          if (typeof query.category === 'string') requireTerm('category', query.category, `${label}.category`);
          if (Array.isArray(query.tags)) {
            for (const tag of query.tags) if (typeof tag === 'string') requireTerm('tag', tag, `${label}.tags`);
          }
        };
        if (source.kind === 'manual' && Array.isArray(source.items)) {
          for (const item of source.items) {
            if (typeof item === 'string') requireObject('content_item', item, 'content_grid manual item');
          }
          // M-8: the fallback query's terms are validated exactly like a
          // primary query's — an unknown term in the backfill is as wrong
          // as one in the main source.
          if (isRecord(source.fallback)) requireQueryTerms(source.fallback.query, 'content_grid fallback query');
        }
        if (source.kind === 'query') requireQueryTerms(source.query, 'content_grid query');
      }
    }
  });

  // Page-level references outside sections.
  if (objectType === 'page' && isRecord(body)) {
    if (isRecord(body.template) && typeof body.template.ref === 'string') {
      requireObject('template', body.template.ref, 'page.template.ref');
    }
    if (isRecord(body.navigationOverrides)) {
      for (const role of ['header', 'footer'] as const) {
        const ref = body.navigationOverrides[role];
        if (typeof ref === 'string') requireObject('navigation', ref, `navigationOverrides.${role}`);
      }
    }
  }

  // Site-level references (existence only; the "right role" nuance is §2.3-site).
  if (objectType === 'site' && isRecord(body)) {
    const defaultNavigation = body.defaultNavigation;
    if (isRecord(defaultNavigation)) {
      for (const role of ['header', 'footer', 'secondary', 'social'] as const) {
        const ref = defaultNavigation[role];
        if (typeof ref === 'string') requireObject('navigation', ref, `defaultNavigation.${role}`);
      }
    }
    if (isRecord(body.chrome) && isRecord(body.chrome.announcement)) {
      const sectionRef = body.chrome.announcement.sectionRef;
      if (typeof sectionRef === 'string') requireObject('section', sectionRef, 'chrome.announcement.sectionRef');
    }
  }

  if (problems.length > 0) {
    criteria.push(crit('references', 'Reference integrity', 'missing', problems.slice(0, 5).join(' ')));
  } else if (!checkedAnyResolvable) {
    criteria.push(
      crit('references', 'Reference integrity', 'optional', 'No resolvers supplied — references not verified here.')
    );
  } else {
    void sawUnresolvableResolver;
    criteria.push(crit('references', 'Reference integrity', 'complete', ''));
  }

  return criteria;
};

// ─── check 4: reader safety ──────────────────────────────────────────────────

/** Deep clone stripping every `notes` field (private-by-design, never rendered). */
const stripNotes = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripNotes);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === 'notes') continue;
      out[key] = stripNotes(child);
    }
    return out;
  }
  return value;
};

export const checkReaderSafety = (body: unknown): ReadinessCriterion[] => {
  // Generalizes assert-reader-safe (A§1.1): private/internal markers must never
  // appear in RENDERABLE fields. `notes` is excluded — it is the private field.
  const renderable = stripNotes(body);
  try {
    assertReaderSafe(renderable);
    return [crit('reader_safety', 'Reader-safe content', 'complete', '')];
  } catch (error) {
    return [crit('reader_safety', 'Reader-safe content', 'missing', (error as Error).message)];
  }
};

// ─── check 5: media / artifact trust ─────────────────────────────────────────

// Mirrors admin-patch-workflow.ts validateImageRef reject rules (A§2.12). That
// module's regexes are not exported; they are reproduced here with citation
// rather than importing (or modifying) it.
const BASE64_DATA_URI_RE = /^data:/i;
const LEGACY_REPO_PATH_RE = /^src\/assets\//;
const REMOTE_URL_RE = /^https?:\/\//i;

const validateAssetRef = (path: string, value: string, trusted: Set<string> | undefined): string | undefined => {
  if (BASE64_DATA_URI_RE.test(value)) return `${path} must not be a data URI.`;
  if (LEGACY_REPO_PATH_RE.test(value)) return `${path} is a legacy repo path. Provide a Major Key artifact reference.`;
  if (REMOTE_URL_RE.test(value))
    return `${path} is an arbitrary remote URL. Provide a Major Key artifact reference instead.`;
  if (!MAJOR_KEY_ARTIFACT_REF_RE.test(value))
    return `${path} must be a Major Key artifact reference ({image|pdf}/{id}/{sha256}.{ext}).`;
  if (trusted && !trusted.has(value)) return `${path} "${value}" is not an index-trusted artifact reference.`;
  return undefined;
};

const ASSET_REF_KEY_RE = /assetref$/i; // imageAssetRef, portraitAssetRef, … (the *AssetRef convention)

export const checkArtifactTrust = (body: unknown, context: ObjectValidationContext): ReadinessCriterion[] => {
  const problems: string[] = [];
  let sawAssetRef = false;

  walkStrings(body, (path, value) => {
    const key = path[path.length - 1] ?? '';
    if (!ASSET_REF_KEY_RE.test(key) || !value) return;
    sawAssetRef = true;
    const err = validateAssetRef(path.join('.'), value, context.trustedAssetRefs);
    if (err) problems.push(err);
  });

  if (problems.length > 0)
    return [crit('artifact_trust', 'Media / artifact trust', 'missing', problems.slice(0, 5).join(' '))];
  if (!sawAssetRef)
    return [crit('artifact_trust', 'Media / artifact trust', 'optional', 'No asset references present.')];
  return [crit('artifact_trust', 'Media / artifact trust', 'complete', '')];
};

// ─── check 6: structural invariants ──────────────────────────────────────────

const collectSections = (body: unknown): SectionInstance[] => {
  if (!isRecord(body) || !Array.isArray(body.sections)) return [];
  return body.sections.filter(
    (section): section is SectionInstance => isRecord(section) && typeof section.type === 'string'
  );
};

const effectiveSectionType = (section: SectionInstance, context: ObjectValidationContext): SectionType | undefined => {
  if (section.type === 'shared_ref') {
    return context.resolveSharedSectionType?.(section.data.section);
  }
  return section.type;
};

// ─── check 6a: taxonomy registry integrity (body-only + optional usage) ──────

// The slug shape shared with the article pipeline (A§1.6) and D§3.7.
const TAXONOMY_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Registry-level taxonomy rules the section/taxonomy-v1 schema explicitly
 * defers here (§2.3-taxonomy): slug shape, per-kind slug uniqueness,
 * `merged_into` targets exist + are active + form no cycle, and (when a usage
 * resolver is supplied) a deprecated term with live usage must carry
 * `merged_into` so references don't strand.
 *
 * This validates registry STATE only. It never re-derives how a *usage*
 * resolves through aliases — that resolution stays with the injected
 * `resolveTaxonomyTerm` resolver (D§5.5), so this engine and T0.6/T0.8 can
 * never disagree on which aliases are live.
 */
export const checkTaxonomyRegistry = (body: unknown, context: ObjectValidationContext): ReadinessCriterion[] => {
  if (!isRecord(body) || !isRecord(body.kinds)) {
    return [
      crit(
        'taxonomy_registry',
        'Taxonomy registry',
        'optional',
        'Taxonomy body shape not recognized (see schema check).'
      ),
    ];
  }

  const slugProblems: string[] = [];
  const mergeProblems: string[] = [];
  const usageProblems: string[] = [];
  let usageChecked = false;

  for (const kind of ['category', 'tag'] as const) {
    const registry = (body.kinds as Record<string, unknown>)[kind];
    const terms = isRecord(registry) && Array.isArray(registry.terms) ? registry.terms : [];
    const byId = new Map<string, Record<string, unknown>>();
    const slugCounts = new Map<string, number>();

    for (const term of terms) {
      if (!isRecord(term)) continue;
      const termId = typeof term.term_id === 'string' ? term.term_id : '';
      const slug = typeof term.slug === 'string' ? term.slug : '';
      if (termId) byId.set(termId, term);
      if (slug) {
        if (!TAXONOMY_SLUG_RE.test(slug))
          slugProblems.push(
            `${kind} term ${termId || '(no id)'}: slug "${slug}" must match ^[a-z0-9]+(?:-[a-z0-9]+)*$.`
          );
        slugCounts.set(slug, (slugCounts.get(slug) ?? 0) + 1);
      }
    }
    for (const [slug, count] of slugCounts) {
      if (count > 1) slugProblems.push(`${kind}: slug "${slug}" is used by ${count} terms (must be unique per kind).`);
    }

    for (const term of terms) {
      if (!isRecord(term)) continue;
      const termId = typeof term.term_id === 'string' ? term.term_id : '(no id)';
      const mergedInto = typeof term.merged_into === 'string' ? term.merged_into : undefined;

      if (mergedInto !== undefined) {
        const target = byId.get(mergedInto);
        if (!target)
          mergeProblems.push(`${kind} term ${termId}: merged_into "${mergedInto}" does not exist in this kind.`);
        else if (target.status !== 'active')
          mergeProblems.push(`${kind} term ${termId}: merged_into "${mergedInto}" is not an active term.`);
      }

      if (term.status === 'deprecated' && mergedInto === undefined && context.resolveTaxonomyTermUsage) {
        usageChecked = true;
        const usage = context.resolveTaxonomyTermUsage(kind, termId);
        if (usage?.inUse)
          usageProblems.push(
            `${kind} term ${termId} is deprecated with live usage but has no merged_into (would strand references).`
          );
      } else if (context.resolveTaxonomyTermUsage) {
        usageChecked = true;
      }
    }

    // Cycle detection over the merged_into graph.
    for (const term of terms) {
      if (!isRecord(term) || typeof term.term_id !== 'string') continue;
      const start = term.term_id;
      const seen = new Set<string>();
      let cursor: string | undefined = start;
      while (cursor !== undefined) {
        if (seen.has(cursor)) {
          mergeProblems.push(`${kind}: merged_into chain starting at ${start} forms a cycle.`);
          break;
        }
        seen.add(cursor);
        const node = byId.get(cursor);
        cursor = node && typeof node.merged_into === 'string' ? node.merged_into : undefined;
      }
    }
  }

  const criteria: ReadinessCriterion[] = [
    slugProblems.length === 0
      ? crit('taxonomy_slugs', 'Taxonomy slugs', 'complete', '')
      : crit('taxonomy_slugs', 'Taxonomy slugs', 'missing', [...new Set(slugProblems)].slice(0, 5).join(' ')),
    mergeProblems.length === 0
      ? crit('taxonomy_merges', 'Taxonomy merge integrity', 'complete', '')
      : crit(
          'taxonomy_merges',
          'Taxonomy merge integrity',
          'missing',
          [...new Set(mergeProblems)].slice(0, 5).join(' ')
        ),
  ];
  if (usageProblems.length > 0) {
    criteria.push(
      crit('taxonomy_usage', 'Deprecation without stranding', 'missing', usageProblems.slice(0, 5).join(' '))
    );
  } else if (!usageChecked) {
    criteria.push(
      crit('taxonomy_usage', 'Deprecation without stranding', 'optional', 'No usage resolver — not verified here.')
    );
  } else {
    criteria.push(crit('taxonomy_usage', 'Deprecation without stranding', 'complete', ''));
  }
  return criteria;
};

// ─── check 6b: template slot integrity ───────────────────────────────────────

/**
 * Template slot rules the template-v1 schema defers here (§2.3-template):
 * a blueprint's type must be in its slot's `allowed` set; a required slot
 * should carry a blueprint; and `allowed` types must exist in the component
 * registry (code, injected via `componentTypeExists` — the registry lands in
 * P3, so this is `optional` until wired). `appliesTo` PageType existence is
 * already enforced by the body zod (a fixed enum), so it isn't re-checked.
 */
export const checkTemplate = (body: unknown, context: ObjectValidationContext): ReadinessCriterion[] => {
  if (!isRecord(body) || !Array.isArray(body.slots)) {
    return [
      crit('template_slots', 'Template slots', 'optional', 'Template body shape not recognized (see schema check).'),
    ];
  }

  const blueprintProblems: string[] = [];
  const requiredProblems: string[] = [];
  const registryProblems: string[] = [];
  let registryChecked = false;

  for (const slot of body.slots) {
    if (!isRecord(slot)) continue;
    const slotId = typeof slot.slotId === 'string' ? slot.slotId : '(no id)';
    const allowed = Array.isArray(slot.allowed) ? slot.allowed.filter((t): t is string => typeof t === 'string') : [];

    if (context.componentTypeExists) {
      registryChecked = true;
      for (const type of allowed) {
        if (!context.componentTypeExists(type))
          registryProblems.push(`slot ${slotId}: allowed type "${type}" is not a registered component.`);
      }
    }

    if (isRecord(slot.blueprint) && typeof slot.blueprint.type === 'string') {
      if (allowed.length > 0 && !allowed.includes(slot.blueprint.type))
        blueprintProblems.push(
          `slot ${slotId}: blueprint type "${slot.blueprint.type}" is not in the slot's allowed set.`
        );
    }

    if (slot.required === true && !isRecord(slot.blueprint)) requiredProblems.push(slotId);
  }

  const criteria: ReadinessCriterion[] = [
    blueprintProblems.length === 0
      ? crit('template_blueprints', 'Blueprint types', 'complete', '')
      : crit('template_blueprints', 'Blueprint types', 'missing', blueprintProblems.slice(0, 5).join(' ')),
    // Required-without-blueprint is a warning, not a hard failure: registry
    // defaultData may supply the section at instantiation (D§3.6) — but flag it.
    requiredProblems.length === 0
      ? crit('template_required', 'Required slots have blueprints', 'complete', '')
      : crit(
          'template_required',
          'Required slots have blueprints',
          'warning',
          `Required slot(s) without a blueprint: ${requiredProblems.join(', ')}.`
        ),
  ];
  if (registryProblems.length > 0) {
    criteria.push(
      crit('template_registry', 'Allowed types registered', 'missing', registryProblems.slice(0, 5).join(' '))
    );
  } else if (!registryChecked) {
    criteria.push(
      crit('template_registry', 'Allowed types registered', 'optional', 'No component registry supplied (lands in P3).')
    );
  } else {
    criteria.push(crit('template_registry', 'Allowed types registered', 'complete', ''));
  }
  return criteria;
};

// ─── check 6c: navigation layout rules (T2.1, C§2.3-Navigation) ──────────────

/** Canonical identity of a NavTarget for duplicate detection (key-order-free). */
const targetKey = (target: Record<string, unknown>): string =>
  JSON.stringify(
    Object.keys(target)
      .sort()
      .map((key) => [key, target[key]])
  );

type NavItemish = Record<string, unknown>;

const navItems = (value: unknown): NavItemish[] => (Array.isArray(value) ? value.filter(isRecord) : []);

/**
 * Navigation structural rules (C§2.3-Navigation, finalized by T2.1):
 *
 * - empty groups rejected;
 * - depth ≤ 2 (a top-level item may carry children — one dropdown level, the
 *   only depth Header.astro renders, A§2.2 — but children may not nest);
 * - duplicate item targets *within a group* warn, never reject: the audited
 *   real nav ships 'Early Access' + 'Join Early Access' → the same route
 *   (C§1.7-4) and the contract must not declare the current site invalid.
 *   Deliberately scoped to item targets: an M-5 group target mirroring one of
 *   its own items is the audited dropdown-parent pattern ('Start Here' → '/'
 *   with item 'Home' → '/', C§1.2), and the action↔item duplication is the
 *   editorial T2.9 checkpoint — flagging either here would bury the one
 *   warning the seed verification pins ("exactly one warning class").
 * - `page`-kind targets must point at *published* pages at publish time (a
 *   nav link to an unpublished page 404s — hard failure), warn-only while
 *   drafting. Existence itself is check 3's job; `route`-kind passes through
 *   (Gap Note 2). Without a resolver the criterion reports `optional`.
 */
/**
 * Structural-capacity criterion for a role's `actions[]` slot (T-guardrail).
 * Reads the fixed bounds from the structural-capacity registry so the rule
 * lives as inspectable data, not logic buried here. Within bounds → complete;
 * out of bounds → the rule's level ('warning' always advises; 'missing' warns
 * while drafting and hard-blocks at publish, the established nav idiom). No
 * `min` is configured today, so emptying the slot never trips this.
 */
const navActionsCapacityCriterion = (
  role: string | undefined,
  actionsCount: number,
  atPublish: boolean
): ReadinessCriterion => {
  const label = 'Header action capacity';
  const rule: CapacityRule | undefined = role ? navActionCapacity[role as NavigationBody['role']] : undefined;
  if (!rule) return crit('nav_actions_capacity', label, 'complete', '');

  const blockLevel = rule.level === 'missing' && atPublish ? 'missing' : 'warning';
  if (rule.max !== undefined && actionsCount > rule.max) {
    return crit(
      'nav_actions_capacity',
      label,
      blockLevel,
      `${actionsCount} ${role} action(s) exceed the ${rule.max} this navigation renders comfortably — extra CTAs crowd the menu's shared header width. Remove or consolidate one.`
    );
  }
  if (rule.min !== undefined && actionsCount < rule.min) {
    return crit(
      'nav_actions_capacity',
      label,
      blockLevel,
      `${actionsCount} ${role} action(s) is below the ${rule.min} this navigation expects.`
    );
  }
  return crit('nav_actions_capacity', label, 'complete', '');
};

export const checkNavigationStructure = (
  body: unknown,
  context: ObjectValidationContext,
  atPublish: boolean
): ReadinessCriterion[] => {
  if (!isRecord(body) || !Array.isArray(body.groups)) {
    return [
      crit(
        'nav_structure',
        'Navigation structure',
        'optional',
        'Navigation body shape not recognized (see schema check).'
      ),
    ];
  }

  const emptyGroups: string[] = [];
  const depthProblems: string[] = [];
  const duplicateWarnings: string[] = [];

  for (const group of body.groups) {
    if (!isRecord(group)) continue;
    const groupLabel = typeof group.title === 'string' && group.title ? group.title : String(group.id ?? '(no id)');
    const items = navItems(group.items);

    if (items.length === 0) emptyGroups.push(groupLabel);

    // Depth: group → item (1) → children (2); a child with children is depth 3.
    for (const item of items) {
      for (const child of navItems(item.children)) {
        if (navItems(child.children).length > 0) {
          depthProblems.push(`group "${groupLabel}" item "${String(item.label ?? item.id)}" nests beyond depth 2.`);
        }
      }
    }

    // Duplicate item targets within this group (items + their children).
    const seenTargets = new Map<string, string[]>();
    const collect = (item: NavItemish) => {
      if (isRecord(item.target)) {
        const key = targetKey(item.target);
        seenTargets.set(key, [...(seenTargets.get(key) ?? []), String(item.label ?? item.id ?? '(item)')]);
      }
      for (const child of navItems(item.children)) collect(child);
    };
    for (const item of items) collect(item);
    for (const labels of seenTargets.values()) {
      if (labels.length > 1) {
        duplicateWarnings.push(
          `group "${groupLabel}": ${labels.map((label) => `"${label}"`).join(' and ')} share one target.`
        );
      }
    }
  }

  const criteria: ReadinessCriterion[] = [
    emptyGroups.length === 0
      ? crit('nav_groups', 'No empty groups', 'complete', '')
      : crit('nav_groups', 'No empty groups', 'missing', `Empty group(s): ${emptyGroups.join(', ')}.`),
    depthProblems.length === 0
      ? crit('nav_depth', 'Depth ≤ 2', 'complete', '')
      : crit('nav_depth', 'Depth ≤ 2', 'missing', depthProblems.slice(0, 5).join(' ')),
    duplicateWarnings.length === 0
      ? crit('nav_duplicates', 'Duplicate targets within a group', 'complete', '')
      : crit('nav_duplicates', 'Duplicate targets within a group', 'warning', duplicateWarnings.slice(0, 5).join(' ')),
    navActionsCapacityCriterion(
      typeof body.role === 'string' ? body.role : undefined,
      Array.isArray(body.actions) ? body.actions.length : 0,
      atPublish
    ),
  ];

  // Published-page requirement for page-kind targets (anywhere in the body:
  // items, children, M-5 group targets, actions).
  if (!context.resolveObject) {
    criteria.push(
      crit('nav_published_targets', 'Page targets published', 'optional', 'No object resolver — not verified here.')
    );
    return criteria;
  }
  const unpublished: string[] = [];
  walkObjects(body, (node) => {
    if (node.kind === 'page' && typeof node.page === 'string') {
      const resolution = context.resolveObject?.('page', node.page);
      // Non-existence is check 3's hard failure; only "exists but unpublished" is ours.
      if (resolution?.exists && !resolution.published) unpublished.push(node.page);
    }
  });
  if (unpublished.length === 0) {
    criteria.push(crit('nav_published_targets', 'Page targets published', 'complete', ''));
  } else {
    criteria.push(
      crit(
        'nav_published_targets',
        'Page targets published',
        atPublish ? 'missing' : 'warning',
        `Nav links target unpublished page(s): ${[...new Set(unpublished)].join(', ')} — a published nav must not 404.`
      )
    );
  }
  return criteria;
};

export const checkStructuralInvariants = (
  objectType: ObjectType,
  objectId: string,
  body: unknown,
  context: ObjectValidationContext,
  atPublish: boolean
): ReadinessCriterion[] => {
  // Structural invariants are type-specific. Pages carry the ≥1-visible-section
  // + PageType rules below; taxonomy, template, and navigation carry their own
  // rules (dispatched here so the pipeline keeps its single 'structure' group).
  // content_item keeps its own ≥1-public-node rule on the article side (A§1.1).
  if (objectType === 'taxonomy') return checkTaxonomyRegistry(body, context);
  if (objectType === 'template') return checkTemplate(body, context);
  if (objectType === 'navigation') return checkNavigationStructure(body, context, atPublish);
  if (objectType !== 'page') {
    return [crit('structure', 'Structural invariants', 'optional', 'No structural invariants for this type.')];
  }

  const criteria: ReadinessCriterion[] = [];
  const sections = collectSections(body);
  const visibleCount = sections.filter((section) => section.visibility !== 'hidden').length;

  // Route shape + uniqueness (§2.3-page). Shape is checked here because the
  // body schema only pins `route` to a non-empty string; uniqueness needs the
  // injected resolver (T0.8 supplies it, excluding this page).
  const route = isRecord(body) && typeof body.route === 'string' ? body.route : '';
  if (route && !route.startsWith('/')) {
    criteria.push(crit('structure_route', 'Route shape', 'missing', `route "${route}" must start with "/".`));
  } else if (!route) {
    criteria.push(crit('structure_route', 'Route shape', 'missing', 'route is required.'));
  } else if (context.isRouteTaken) {
    criteria.push(
      context.isRouteTaken(route)
        ? crit('structure_route', 'Route uniqueness', 'missing', `route "${route}" is already used by another page.`)
        : crit('structure_route', 'Route uniqueness', 'complete', '')
    );
  } else {
    criteria.push(
      crit('structure_route', 'Route uniqueness', 'optional', 'No route resolver — uniqueness not verified here.')
    );
  }

  // ≥1 visible section — the analogue of article_body's "≥1 public node"
  // (A§1.1). Publish-gated: a hard failure at publish, a warning while drafting.
  if (visibleCount >= 1) {
    criteria.push(crit('structure_visible', 'At least one visible section', 'complete', ''));
  } else {
    criteria.push(
      crit(
        'structure_visible',
        'At least one visible section',
        atPublish ? 'missing' : 'warning',
        atPublish
          ? 'A published page must keep at least one visible section.'
          : 'No visible sections yet — required before this page can publish.'
      )
    );
  }

  // The homepage renderer (src/pages/index.astro) hardcodes loading object id
  // `page_home` and unconditionally throws if navigationOverrides.footer is
  // absent (the homepage uses the nav_footer_home variant, never the site
  // default) — a build-time crash that takes down the ENTIRE static build, not
  // just this page, since Astro's build is all-or-nothing. That coupling is
  // keyed on the literal object id, NOT on pageType — index.astro never reads
  // pageType at all — so this gate checks id first; pageType 'home' is checked
  // too (below) as the general, declared-intent case. Schema-wise
  // `navigationOverrides` is optional (most pages have none), so nothing before
  // this blocked an agent from validly patching/publishing page_home with it
  // missing — discovered for real on 2026-07-10 when four production publishes
  // progressively stripped page_home down to a single section with no
  // navigationOverrides (and, midway, changed its OWN pageType away from
  // 'home' too — which did nothing to stop the crash, proving the id-based
  // gate is the one that matters), passing validation the whole way and only
  // surfacing as an opaque site-wide Netlify build failure. This closes that
  // gap at the layer it belongs in — validation, not a runtime throw
  // discovered on deploy. (Existence-if-present is already checked above via
  // requireObject 'navigationOverrides.footer'; this only adds that presence
  // is REQUIRED.)
  if (objectId === 'page_home' || (isRecord(body) && body.pageType === 'home')) {
    const hasFooterOverride =
      isRecord(body) && isRecord(body.navigationOverrides) && typeof body.navigationOverrides.footer === 'string';
    criteria.push(
      hasFooterOverride
        ? crit('structure_home_footer', 'Home footer override', 'complete', '')
        : crit(
            'structure_home_footer',
            'Home footer override',
            atPublish ? 'missing' : 'warning',
            "The object id 'page_home' (or a page declaring pageType 'home') must set " +
              'navigationOverrides.footer — the renderer requires it unconditionally, and its absence ' +
              'crashes the ENTIRE site build, not just this page.'
          )
    );
  }

  // PageType allowed/required sections (D§3.4). The registry is code, resolved
  // via context.resolvePageType from the body's pageType (or a directly-injected
  // context.pageType, which wins). Without either, not verifiable here.
  const pageTypeConstraint =
    context.pageType ??
    (isRecord(body) && typeof body.pageType === 'string' ? context.resolvePageType?.(body.pageType) : undefined);
  if (!pageTypeConstraint) {
    criteria.push(crit('structure_pagetype', 'PageType section rules', 'optional', 'No PageType definition supplied.'));
    return criteria;
  }

  const { allowedSections, requiredSections } = pageTypeConstraint;
  if (allowedSections !== 'any') {
    const allowed = new Set(allowedSections);
    const disallowed: string[] = [];
    for (const section of sections) {
      const type = effectiveSectionType(section, context);
      // A shared_ref whose target type can't be resolved is left to §2.3-section
      // re-validation; don't reject on an unknown effective type here.
      if (type && !allowed.has(type)) disallowed.push(type);
    }
    criteria.push(
      disallowed.length === 0
        ? crit('structure_allowed', 'Allowed section types', 'complete', '')
        : crit(
            'structure_allowed',
            'Allowed section types',
            'missing',
            `Section types not allowed on PageType ${pageTypeConstraint.id ?? ''}: ${[...new Set(disallowed)].join(', ')}.`
          )
    );
  }

  if (requiredSections && requiredSections.length > 0) {
    const present = new Set(sections.map((section) => effectiveSectionType(section, context)).filter(Boolean));
    const missing = requiredSections.filter((type) => !present.has(type));
    if (missing.length === 0) {
      criteria.push(crit('structure_required', 'Required section types', 'complete', ''));
    } else {
      // Publish-gated, like ≥1 visible: reject at publish, warn while drafting.
      criteria.push(
        crit(
          'structure_required',
          'Required section types',
          atPublish ? 'missing' : 'warning',
          `Missing required section types: ${missing.join(', ')}.`
        )
      );
    }
  }

  return criteria;
};

// ─── pipeline composition ────────────────────────────────────────────────────

export const validateObject = (
  input: ObjectValidationInput,
  context: ObjectValidationContext = {}
): ReadinessGroup[] => {
  const atPublish = Boolean(context.publishIntent || input.published);

  return [
    { id: 'schema', label: 'Schema validity', criteria: checkSchema(input.objectType, input.body) },
    {
      id: 'identifiers',
      label: 'ID discipline',
      criteria: checkIdDiscipline(input.objectType, input.objectId, input.body),
    },
    {
      id: 'references',
      label: 'Reference integrity',
      criteria: checkReferenceIntegrity(input.objectType, input.body, context),
    },
    { id: 'reader_safety', label: 'Reader safety', criteria: checkReaderSafety(input.body) },
    { id: 'artifact_trust', label: 'Media / artifact trust', criteria: checkArtifactTrust(input.body, context) },
    {
      id: 'structure',
      label: 'Structural invariants',
      criteria: checkStructuralInvariants(input.objectType, input.objectId, input.body, context, atPublish),
    },
  ];
};

export type ValidationSummary = {
  level: 'missing' | 'warning' | 'ready';
  /** eligible for review = no hard failures (C§2.0). */
  eligible: boolean;
  blockers: ReadinessCriterion[];
  warnings: ReadinessCriterion[];
};

export const summarizeValidation = (groups: ReadinessGroup[]): ValidationSummary => {
  const all = groups.flatMap((group) => group.criteria);
  const blockers = all.filter((criterion) => criterion.status === 'missing');
  const warnings = all.filter((criterion) => criterion.status === 'warning');
  const level: ValidationSummary['level'] = blockers.length > 0 ? 'missing' : warnings.length > 0 ? 'warning' : 'ready';
  return { level, eligible: blockers.length === 0, blockers, warnings };
};

// ─── candidate-patch dry-run (object_validate {candidate_patch?}, C§2.0) ──────

// A fixed timestamp: the dry-run discards the produced record and validates
// only its body, so the history stamp is irrelevant (and Date.now() is avoided
// to keep validation deterministic).
const DRY_RUN_AT = '1970-01-01T00:00:00.000Z';
const DRY_RUN_ACTOR: Principal = { kind: 'agent', agent_name: 'object_validate', auth: 'publish_key' };

export type CandidatePatchValidation = {
  /** True only when the ops applied AND the resulting body is eligible. */
  eligible: boolean;
  groups: ReadinessGroup[];
  /** Present iff T0.6's engine refused the patch (the ops never applied). */
  applyError?: { code: PatchApplyError['code']; message: string };
};

/**
 * The `object_validate {candidate_patch?}` dry-run (C§2.0): apply the proposed
 * ops through **T0.6's real engine** (`applyPatchOps`) — never a hand-rolled
 * simulation — then run the resulting body through the same six-check pipeline.
 *
 * A patch T0.6 refuses (an unknown/typo'd op discriminant → `invalid_op`, a
 * blind revert → `blind_revert_refused`, a slug-rename alias conflict →
 * `alias_required`/`alias_conflict`, etc.) surfaces LOUDLY as a hard `missing`
 * criterion carrying T0.6's real error code — it is never silently dropped.
 * Because the engine owns the op discriminants (its `patchOpSchema.parse`
 * rejects any unknown `op`), this validator inherits exhaustiveness for free
 * and cannot drift from the grammar's member names.
 */
export const validateCandidatePatch = (
  record: ObjectRecord<unknown>,
  ops: readonly unknown[],
  context: ObjectValidationContext = {}
): CandidatePatchValidation => {
  let appliedBody: unknown;
  try {
    const result = applyPatchOps(record, ops, { actor: DRY_RUN_ACTOR, at: DRY_RUN_AT });
    appliedBody = result.record.body;
  } catch (error) {
    if (error instanceof PatchApplyError) {
      const groups: ReadinessGroup[] = [
        {
          id: 'patch',
          label: 'Candidate patch',
          criteria: [crit('patch_apply', 'Candidate patch applies', 'missing', `${error.code}: ${error.message}`)],
        },
      ];
      return { eligible: false, groups, applyError: { code: error.code, message: error.message } };
    }
    throw error;
  }

  const bodyGroups = validateObject(
    {
      objectType: record.object_type,
      objectId: record.object_id,
      body: appliedBody,
      published: record.publication.published_time != null,
    },
    context
  );
  const groups: ReadinessGroup[] = [
    {
      id: 'patch',
      label: 'Candidate patch',
      criteria: [crit('patch_apply', 'Candidate patch applies', 'complete', '')],
    },
    ...bodyGroups,
  ];
  return { eligible: summarizeValidation(groups).eligible, groups };
};
