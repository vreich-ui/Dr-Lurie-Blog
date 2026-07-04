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
 * Scope boundary: nav *layout* rules (duplicate-target warnings, empty groups,
 * depth ≤ 2, nav-link-to-unpublished-page) are deliberately NOT here — they are
 * T2.1, which extends this pipeline. This file implements only the six global
 * checks. The duplicate-nav-target warn-only case the brief cites as the
 * canonical warn-vs-reject example therefore lands in T2.1; T0.7 demonstrates
 * the same warn-vs-reject mechanism through the publish-gated structural
 * invariant (≥1 visible section warns in draft, rejects at publish).
 */
import { assertReaderSafe } from '../../src/lib/article-content/assert-reader-safe.js';
import type { CriterionStatus, ReadinessCriterion, ReadinessGroup } from '../../src/lib/admin/readiness-criteria.js';
import { validateObjectIdForType, validateSectionInstanceId } from '../../src/lib/object-ids.js';
import { navigationBodySchema } from '../../src/schema/bodies/navigation-v1.js';
import { pageBodySchema } from '../../src/schema/bodies/page-v1.js';
import { sectionBodySchema, type SectionInstance, type SectionType } from '../../src/schema/bodies/section-v1.js';
import { siteBodySchema } from '../../src/schema/bodies/site-v1.js';
import { taxonomyBodySchema } from '../../src/schema/bodies/taxonomy-v1.js';
import { templateBodySchema } from '../../src/schema/bodies/template-v1.js';
import type { ObjectType } from '../../src/schema/object-record-v1.js';
import { MAJOR_KEY_ARTIFACT_REF_RE } from './artifact-trust.js';

export type { CriterionStatus, ReadinessCriterion, ReadinessGroup } from '../../src/lib/admin/readiness-criteria.js';

// ─── injected context ──────────────────────────────────────────────────────

export type ObjectResolution = { exists: boolean; published?: boolean };
export type TaxonomyResolution = { active: boolean };

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
  /** Effective variant type of a shared 'section' object (for structural re-check). */
  resolveSharedSectionType?: (objectId: string) => SectionType | undefined;
  /** Major-Key blobKeys trusted for this object's asset refs (A§2.12). */
  trustedAssetRefs?: Set<string>;
  /** The PageType definition for a page's `pageType` (registry is code, D§3.4/OQ-4). */
  pageType?: PageTypeConstraint;
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
      }
      if (node.type === 'content_embed' && typeof data.contentItem === 'string') {
        requireObject('content_item', data.contentItem, 'content_embed.contentItem');
      }
      if (node.type === 'content_grid' && isRecord(data.source)) {
        const source = data.source;
        if (source.kind === 'manual' && Array.isArray(source.items)) {
          for (const item of source.items) {
            if (typeof item === 'string') requireObject('content_item', item, 'content_grid manual item');
          }
        }
        if (source.kind === 'query' && isRecord(source.query)) {
          const query = source.query;
          if (typeof query.category === 'string')
            requireTerm('category', query.category, 'content_grid query.category');
          if (Array.isArray(query.tags)) {
            for (const tag of query.tags)
              if (typeof tag === 'string') requireTerm('tag', tag, 'content_grid query.tags');
          }
        }
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

export const checkStructuralInvariants = (
  objectType: ObjectType,
  body: unknown,
  context: ObjectValidationContext,
  atPublish: boolean
): ReadinessCriterion[] => {
  // Structural invariants apply to pages. content_item keeps its own
  // ≥1-public-node rule on the article side (A§1.1); other types have none here.
  if (objectType !== 'page') {
    return [crit('structure', 'Structural invariants', 'optional', 'No structural invariants for this type.')];
  }

  const criteria: ReadinessCriterion[] = [];
  const sections = collectSections(body);
  const visibleCount = sections.filter((section) => section.visibility !== 'hidden').length;

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

  // PageType allowed/required sections (D§3.4). The registry is code and injected
  // via context.pageType; without it these constraints are not verifiable here.
  if (!context.pageType) {
    criteria.push(crit('structure_pagetype', 'PageType section rules', 'optional', 'No PageType definition supplied.'));
    return criteria;
  }

  const { allowedSections, requiredSections } = context.pageType;
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
            `Section types not allowed on PageType ${context.pageType.id ?? ''}: ${[...new Set(disallowed)].join(', ')}.`
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
      criteria: checkStructuralInvariants(input.objectType, input.body, context, atPublish),
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
