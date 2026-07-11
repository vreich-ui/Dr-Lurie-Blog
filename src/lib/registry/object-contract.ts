/**
 * Object contract serializer — the machine-readable "what can I do to this
 * object, and what data does each move need" surface an agent reads BEFORE
 * acting, so it never has to guess (the owner's efficiency principle: guessing
 * costs compute). Served read-only by the `object_contract` MCP tool.
 *
 * DERIVE, NEVER HAND-AUTHOR. Every field here is generated from the same code
 * that ENFORCES it — the live zod body schemas (`z.toJSONSchema`), the section
 * discriminated union, the exported `patchOpNamesByObjectType` allowlist, the
 * component registry's editor hints, the structural-capacity table, and
 * `activeApprovalPolicy()`. So the contract cannot drift from enforcement (the
 * opposite of the article tools' hand-maintained `contentSourceV1JsonSchema`).
 * Adding a section type, patch op, or object type flows through automatically;
 * the coverage test fails until the derivation picks it up.
 *
 * Client-safe (no `.astro`, no `netlify/lib` imports) so the Netlify function
 * bundle can import it. A few catalogs that live in `netlify/lib` (the publish
 * gate's denial codes, the richtext allowlist) are mirrored here as documented
 * DESCRIPTION data — the authoritative machine schemas (body / patch args) stay
 * fully derived; only human-readable boundary notes are restated.
 */
import { z } from 'zod';

import {
  activeApprovalPolicy,
  isGovernedObjectType,
  publishRequiresApproval,
  type ApprovalPolicy,
} from '../approval-policy.js';
import type { PatchApplyErrorCode } from '../object-patch-apply.js';
import { childRuleFor } from './block-tree.js';
import { bioDefinition } from './components/bio.js';
import { checklistDefinition } from './components/checklist.js';
import { contactFormDefinition } from './components/contact-form.js';
import { contentEmbedDefinition } from './components/content-embed.js';
import { contentGridDefinition } from './components/content-grid.js';
import { ctaBannerDefinition } from './components/cta-banner.js';
import { faqDefinition } from './components/faq.js';
import { heroDefinition } from './components/hero.js';
import { ledeDefinition } from './components/lede.js';
import { linkListDefinition } from './components/link-list.js';
import { newsletterSignupDefinition } from './components/newsletter-signup.js';
import { productPreviewDefinition } from './components/product-preview.js';
import { proseDefinition } from './components/prose.js';
import { isRegisteredSectionType } from './components/registered-types.js';
import { formConfirmationDefinition } from './components/form-confirmation.js';
import { searchDefinition } from './components/search.js';
import { testimonialDefinition } from './components/testimonial.js';
import { sectionVariantDataSchema } from './components/types.js';
import { listPageTypeDefinitions } from './page-types.js';
import { navActionCapacity } from './structural-capacity.js';
import { pageBodySchema } from '../../schema/bodies/page-v1.js';
import { sectionBodySchema, sectionTypes, type SectionType } from '../../schema/bodies/section-v1.js';
import { navigationBodySchema } from '../../schema/bodies/navigation-v1.js';
import { siteBodySchema } from '../../schema/bodies/site-v1.js';
import { taxonomyBodySchema } from '../../schema/bodies/taxonomy-v1.js';
import { templateBodySchema } from '../../schema/bodies/template-v1.js';
import { objectTypes, type ObjectType } from '../../schema/object-record-v1.js';
import { patchOpNamesByObjectType, patchOpUnionSchema, type PatchOpName } from '../../schema/object-patch-ops.js';

// A rendered JSON-schema is a plain object; typing it as such avoids the
// z.toJSONSchema overload ambiguity (schema-vs-registry) and serializes as-is.
type JsonSchema = Record<string, unknown>;

// `unrepresentable: 'any'` keeps refinements (e.g. the forbid-keys guards on
// `fields`) from throwing — those rules are restated in `constraints`, and the
// structural shape is what an agent needs from the schema.
const toJson = (schema: z.ZodType): JsonSchema => z.toJSONSchema(schema, { unrepresentable: 'any' }) as JsonSchema;

// ─── body schema per governed object type (content_item is out of scope) ─────

const BODY_SCHEMA: Partial<Record<ObjectType, z.ZodType>> = {
  page: pageBodySchema,
  section: sectionBodySchema,
  navigation: navigationBodySchema,
  site: siteBodySchema,
  taxonomy: taxonomyBodySchema,
  template: templateBodySchema,
};

// ─── section-type editor hints (only the component-bound types carry them) ───

const SECTION_EDITORS = {
  hero: heroDefinition.editor,
  lede: ledeDefinition.editor,
  prose: proseDefinition.editor,
  checklist: checklistDefinition.editor,
  content_grid: contentGridDefinition.editor,
  bio: bioDefinition.editor,
  newsletter_signup: newsletterSignupDefinition.editor,
  testimonial: testimonialDefinition.editor,
  cta_banner: ctaBannerDefinition.editor,
  faq: faqDefinition.editor,
  link_list: linkListDefinition.editor,
  product_preview: productPreviewDefinition.editor,
  contact_form: contactFormDefinition.editor,
  search: searchDefinition.editor,
  content_embed: contentEmbedDefinition.editor,
  form_confirmation: formConfirmationDefinition.editor,
} as const;

/**
 * The registry editor's `defaultData` for a component-bound section type
 * (undefined for `shared_ref`, which has no component or editor). Exported for
 * template instantiation: a required slot without a blueprint falls back to its
 * first allowed type's defaultData — the exact promise the `template_required`
 * warning makes ("registry defaultData may supply it").
 */
export const sectionEditorDefaultData = (type: SectionType): Record<string, unknown> | undefined =>
  type in SECTION_EDITORS
    ? (SECTION_EDITORS[type as keyof typeof SECTION_EDITORS].defaultData as Record<string, unknown>)
    : undefined;

export type SectionTypeContract = {
  type: SectionType;
  component_bound: boolean;
  data_schema: JsonSchema;
  editor?: (typeof SECTION_EDITORS)[keyof typeof SECTION_EDITORS];
  /**
   * Block-tree bounds (docs/cms-architecture/block-tree.md): which child block
   * types this type may contain, and how many. Present only on container types;
   * a type without `allowed_children` is a leaf. Lets an agent read the legal
   * tree grammar before composing.
   */
  allowed_children?: SectionType[];
  child_count?: { min?: number; max?: number };
};

export const listSectionTypeContracts = (): SectionTypeContract[] =>
  (sectionTypes as SectionType[]).map((type) => {
    const childRule = childRuleFor(type);
    return {
      type,
      component_bound: isRegisteredSectionType(type),
      data_schema: toJson(sectionVariantDataSchema(type)),
      ...(type in SECTION_EDITORS ? { editor: SECTION_EDITORS[type as keyof typeof SECTION_EDITORS] } : {}),
      ...(childRule
        ? {
            allowed_children: childRule.allowedChildren,
            ...(childRule.childCount ? { child_count: childRule.childCount } : {}),
          }
        : {}),
    };
  });

// ─── patch ops: the moves per type, with argument schemas ────────────────────

// Which ops carry a server-minted id the agent MAY omit (endpoint mints it).
const MINTED_ID_FIELD: Partial<Record<PatchOpName, string>> = {
  add_term: 'term.term_id',
  upsert_section: 'section.id',
  upsert_item: 'item.id',
  upsert_group: 'group.id',
  upsert_slot: 'slot.slotId',
};

// Ops (or op fields) that exist only for inverse/Discard derivation — agents
// should not hand-author them; the engine emits them when reverting.
const INTERNAL_OPS = new Set<PatchOpName>(['reactivate_term']);

const opArgSchema = (opName: PatchOpName): JsonSchema | undefined => {
  const option = patchOpUnionSchema.options.find(
    (candidate) => (candidate.shape.op as z.ZodLiteral<string>).value === opName
  );
  return option ? toJson(option) : undefined;
};

export type PatchOpContract = {
  op: PatchOpName;
  agent_authored: boolean;
  minted_id_field?: string;
  arg_schema?: JsonSchema;
};

const patchOpContracts = (objectType: ObjectType): PatchOpContract[] =>
  patchOpNamesByObjectType[objectType].map((op) => ({
    op,
    agent_authored: !INTERNAL_OPS.has(op),
    ...(MINTED_ID_FIELD[op] ? { minted_id_field: MINTED_ID_FIELD[op] } : {}),
    ...(opArgSchema(op) ? { arg_schema: opArgSchema(op) } : {}),
  }));

// ─── constraints (declarative boundaries; severity + whether enforced live) ──

export type ConstraintSeverity = 'blocks_write' | 'blocks_publish' | 'warns';
export type Constraint = {
  id: string;
  severity: ConstraintSeverity;
  enforced_live: boolean;
  description: string;
};

const RICHTEXT_ALLOWLIST = 'p, br, strong, em, a, ul, ol, li, h2, h3';

// Boundaries every governed type shares.
const COMMON_CONSTRAINTS: Constraint[] = [
  {
    id: 'schema_zod',
    severity: 'blocks_write',
    enforced_live: true,
    description:
      'The body must parse against this type’s zod schema (see body_schema). Unknown keys are rejected (strict).',
  },
  {
    id: 'id_object',
    severity: 'blocks_write',
    enforced_live: true,
    description:
      'The object id must match its type’s id pattern (page_ / sec_ / nav_ / tax_ / site_ / tpl_ + lowercase). Omit requested_id on create to have it minted.',
  },
  {
    id: 'reader_safety',
    severity: 'blocks_write',
    enforced_live: true,
    description:
      'Reader-visible strings must be reader-safe (no internal/strategy leakage). `notes` fields are private and exempt.',
  },
  {
    id: 'artifact_trust',
    severity: 'blocks_write',
    enforced_live: true,
    description:
      'Any *AssetRef must be a trusted Major-Key artifact ref (image|pdf/{id}/{sha256}.{ext}); URLs, data: URIs, and src/assets paths are rejected.',
  },
  {
    id: 'schema_richtext',
    severity: 'blocks_write',
    enforced_live: true,
    description: `RichText fields accept only the TipTap allowlist tags (${RICHTEXT_ALLOWLIST}); <a href> must be https://.`,
  },
];

const perTypeConstraints = (objectType: ObjectType): Constraint[] => {
  switch (objectType) {
    case 'page':
      return [
        {
          id: 'structure_route',
          severity: 'blocks_write',
          enforced_live: true,
          description: 'route must start with "/" and be unique across pages (uniqueness enforced live).',
        },
        {
          id: 'structure_visible',
          severity: 'blocks_publish',
          enforced_live: true,
          description: 'At least one non-hidden section is required to publish (warns while drafting).',
        },
        {
          id: 'structure_allowed',
          severity: 'blocks_write',
          enforced_live: true,
          description:
            'When the PageType restricts sections (allowedSections !== "any"), every section type must be allowed. See section_types + the PageType rules.',
        },
        {
          id: 'structure_required',
          severity: 'blocks_publish',
          enforced_live: true,
          description: 'The PageType’s requiredSections must all be present to publish (warns while drafting).',
        },
        {
          id: 'structure_home_footer',
          severity: 'blocks_publish',
          enforced_live: true,
          description:
            'The object id "page_home" (or any page with pageType "home") must set navigationOverrides.footer — the ' +
            'renderer (src/pages/index.astro) hardcodes this and unconditionally throws without it, crashing the ' +
            'ENTIRE site build, not just this page (warns while drafting, blocks publish).',
        },
        {
          id: 'references',
          severity: 'blocks_write',
          enforced_live: true,
          description:
            'template.ref, navigationOverrides.{header,footer}, shared_ref targets and content_grid manual items must resolve to existing (and, for published nav targets, published) objects.',
        },
      ];
    case 'navigation':
      return [
        { id: 'nav_groups', severity: 'blocks_write', enforced_live: true, description: 'No empty groups.' },
        {
          id: 'nav_depth',
          severity: 'blocks_write',
          enforced_live: true,
          description: 'Menu depth ≤ 2 (a dropdown item may not itself have children).',
        },
        {
          id: 'nav_duplicates',
          severity: 'warns',
          enforced_live: true,
          description:
            'Two items in the same group pointing at the same target warn (never block) — the audited nav legitimately does this.',
        },
        { id: 'nav_actions_capacity', severity: 'warns', enforced_live: true, description: capacityDescription() },
        {
          id: 'nav_published_targets',
          severity: 'blocks_publish',
          enforced_live: true,
          description: 'A published nav must not point at an unpublished page (warns while drafting).',
        },
        {
          id: 'references',
          severity: 'blocks_write',
          enforced_live: true,
          description: 'page/taxonomy nav targets must resolve to existing objects/terms.',
        },
      ];
    case 'taxonomy':
      return [
        {
          id: 'taxonomy_slugs',
          severity: 'blocks_write',
          enforced_live: true,
          description: 'Term slugs must be lowercase-hyphen and unique per kind.',
        },
        {
          id: 'taxonomy_merges',
          severity: 'blocks_write',
          enforced_live: true,
          description: 'merged_into must point at an active in-kind term and form no cycle.',
        },
        {
          id: 'taxonomy_usage',
          severity: 'blocks_write',
          enforced_live: false,
          description:
            'Deprecating a term with live usage requires merged_into. NOT enforced live yet (needs an article-usage scan).',
        },
      ];
    case 'template':
      return [
        {
          id: 'template_blueprints',
          severity: 'blocks_write',
          enforced_live: true,
          description: 'A slot’s blueprint type must be in that slot’s allowed set.',
        },
        {
          id: 'template_required',
          severity: 'warns',
          enforced_live: true,
          description:
            'A required slot without a blueprint warns (registry defaultData may supply it) — never a hard fail.',
        },
        {
          id: 'template_registry',
          severity: 'blocks_write',
          enforced_live: true,
          description: 'A slot’s allowed types must be registered components (see section_types.component_bound).',
        },
      ];
    default:
      return [];
  }
};

const capacityDescription = (): string => {
  const header = navActionCapacity.header;
  return header
    ? `Header actions[] warns above ${header.max} (crowds the menu’s shared width); content removal is always legal.`
    : 'No configured capacity limit.';
};

// ─── publish policy (the security boundary; computed, never hardcoded) ───────

// Mirrors netlify/lib/publish-gate.ts PublishGateDenialCode (that union lives in
// netlify/lib and can't be imported here; this is a documentation catalog).
const PUBLISH_DENIAL_CODES: Record<string, string> = {
  content_item_not_gated: 'content_item publishes via the article pipeline, not this gate.',
  approval_required: 'The type requires approval and none is current/approved.',
  changes_requested: 'A reviewer requested changes; resubmit before publishing.',
  approval_stale: 'The approval was pinned to an older content_revision; re-approve.',
  publish_role_required: 'A human executing a publish needs the admin or publisher role.',
  publish_action_not_pinned:
    'An agent-executed publish of a gated type needs the approval to pin the exact action (M-6).',
  publish_action_mismatch: 'The requested publish action differs from the approved (pinned) one.',
};

export type PublishPolicyContract = {
  gated: boolean;
  requires_approval: boolean;
  note: string;
  denial_codes?: Record<string, string>;
  pin_rules?: string;
};

const publishPolicy = (objectType: ObjectType, policy: ApprovalPolicy): PublishPolicyContract => {
  if (objectType === 'content_item') {
    return {
      gated: false,
      requires_approval: false,
      note: 'Articles use the save_json_blob_* tools and their own publish flow.',
    };
  }
  if (!isGovernedObjectType(objectType)) {
    return { gated: false, requires_approval: false, note: 'Not governed by the approval gate.' };
  }
  const requiresApproval = publishRequiresApproval(objectType, policy);
  return {
    gated: true,
    requires_approval: requiresApproval,
    note: requiresApproval
      ? 'Publishing requires a current human approval (via object_review_decide) pinned to the exact publish action; the agent then executes object_publish.'
      : 'Autonomous: an agent may object_publish directly (no approval). A HUMAN executing a publish still needs the admin/publisher role.',
    denial_codes: PUBLISH_DENIAL_CODES,
    pin_rules:
      'M-6: pin "immediate" ⇔ omit published_time; pin <ISO> ⇔ same instant; pin null ⇔ request null (unpublish). Any other action needs re-approval.',
  };
};

// ─── workflow (sequence, lock discipline, error catalog) ─────────────────────

// Type-linked to PatchApplyErrorCode so a new engine error code forces an entry.
const PATCH_ERROR_CODES: Record<PatchApplyErrorCode, { http: number; meaning: string }> = {
  invalid_op: { http: 400, meaning: 'The op is malformed (bad shape, null array element, non-derivable inverse).' },
  op_not_applicable: { http: 422, meaning: 'The op is valid but not allowed for this object_type (see patch_ops).' },
  invalid_body: { http: 422, meaning: 'The record body lacks the container the op needs.' },
  target_not_found: {
    http: 422,
    meaning: 'The addressed element (section/group/item/action/slot/term) does not exist.',
  },
  duplicate_target: { http: 409, meaning: 'add_term for a term_id that already exists.' },
  blind_revert_refused: {
    http: 409,
    meaning: 'A guard.expected mismatch — the state moved under you; re-read and retry.',
  },
  alias_required: { http: 422, meaning: 'A slug rename with mint_alias:false that is not a provable revert.' },
  alias_conflict: { http: 422, meaning: 'The minted/restored alias term_id already exists.' },
};

const workflow = (objectType: ObjectType, policy: ApprovalPolicy) => ({
  sequence: [
    'object_contract (this call) → read the schema, ops, constraints',
    ...(objectType === 'content_item' ? [] : ['object_create (omit requested_id to mint one) — for a new object']),
    // W2.5, design-principles rule 5: templates are recipes — instantiation
    // copies slot blueprints into a NEW page via the standard create path.
    ...(objectType === 'page'
      ? [
          'object_instantiate_template (template_id + route + title) — alternative create: start the page from a template recipe',
        ]
      : []),
    ...(objectType === 'template'
      ? [
          'object_instantiate_template (template_id + route + title [+ page_type/seo]) → creates a NEW page from this recipe through the standard page create validation; dry_run: true previews the built body without persisting. Pages copy the blueprints at creation and never live-inherit from the template.',
        ]
      : []),
    'object_checkout → lock_token + record_version',
    'object_validate (dry-run the candidate_patch) then object_patch (with lock_token + expected_record_version)',
    ...(publishPolicy(objectType, policy).requires_approval
      ? ['object_submit_review → object_review_decide (approve, pinned) → object_publish']
      : ['object_publish (autonomous)']),
    'object_checkin (release the lock)',
    'release_to_production (separate, deliberate go-live — publishes commit with [skip netlify])',
  ],
  lock_discipline:
    '423 = no/expired/other-held lock (checkout again); 409 = your expected_record_version is stale (re-read). Publishing bumps version, never content_revision (approvals survive it); any body write bumps content_revision (and invalidates a pinned approval).',
  patch_error_codes: PATCH_ERROR_CODES,
});

// ─── auxiliary inputs (side-data a move requires) ────────────────────────────

export type AuxiliaryInput = { input: string; when: string; how: string };

const auxiliaryInputs = (objectType: ObjectType): AuxiliaryInput[] => {
  const inputs: AuxiliaryInput[] = [
    {
      input: 'lock_token',
      when: 'every patch/publish',
      how: 'From object_checkout; also gives record_version for expected_record_version.',
    },
  ];
  if (objectType !== 'content_item') {
    inputs.push({ input: 'site', when: 'object_create', how: 'The owning site object id, e.g. site_drlurie.' });
  }
  const schema = BODY_SCHEMA[objectType];
  if (schema && JSON.stringify(toJson(schema)).includes('AssetRef')) {
    inputs.push({
      input: 'artifact ref',
      when: 'any *AssetRef field',
      how: 'Upload via create_artifact_upload_intent first, then use the returned Major-Key ref (image|pdf/{id}/{sha256}.{ext}). URLs/data:/src/assets are rejected.',
    });
  }
  if (objectType === 'page' || objectType === 'navigation' || objectType === 'site') {
    inputs.push({
      input: 'nav/reference targets',
      when: 'links, navigationOverrides, defaultNavigation',
      how: 'Reference existing published objects by id; a route-kind target is the transitional escape hatch until the target page object exists.',
    });
  }
  return inputs;
};

// ─── the assembled contract ──────────────────────────────────────────────────

export type ObjectContract = {
  object_type: ObjectType;
  governed: boolean;
  creatable: boolean;
  summary: string;
  body_schema: JsonSchema | { note: string };
  section_types?: SectionTypeContract[];
  page_types?: ReturnType<typeof listPageTypeDefinitions>;
  patch_ops: PatchOpContract[];
  constraints: Constraint[];
  publish_policy: PublishPolicyContract;
  workflow: ReturnType<typeof workflow>;
  auxiliary_inputs: AuxiliaryInput[];
};

export const OBJECT_CONTRACT_TYPES = objectTypes;

export const buildObjectContract = (
  objectType: ObjectType,
  options: { approvalPolicy?: ApprovalPolicy } = {}
): ObjectContract => {
  const policy = options.approvalPolicy ?? activeApprovalPolicy();
  const schema = BODY_SCHEMA[objectType];
  const includesSections = objectType === 'page' || objectType === 'section';
  return {
    object_type: objectType,
    governed: isGovernedObjectType(objectType),
    creatable: objectType !== 'content_item',
    summary:
      objectType === 'content_item'
        ? 'Articles are outside the generic object verbs — use the save_json_blob_* tools.'
        : `Everything an agent needs to create and edit a ${objectType} object: body schema, patch ops, constraints, publish policy, and required side-data.`,
    body_schema: schema
      ? toJson(schema)
      : { note: 'content_item has no generic body schema; use the save_json_blob_* article tools.' },
    ...(includesSections ? { section_types: listSectionTypeContracts() } : {}),
    ...(objectType === 'page' ? { page_types: listPageTypeDefinitions() } : {}),
    patch_ops: patchOpContracts(objectType),
    constraints: [...COMMON_CONSTRAINTS, ...perTypeConstraints(objectType)].filter(
      // content_item has no governed body; only the workflow/publish notes apply.
      () => objectType !== 'content_item'
    ),
    publish_policy: publishPolicy(objectType, policy),
    workflow: workflow(objectType, policy),
    auxiliary_inputs: auxiliaryInputs(objectType),
  };
};
