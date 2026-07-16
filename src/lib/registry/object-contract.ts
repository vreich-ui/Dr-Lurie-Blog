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
import { activeCreationPolicy, creationRuleFor, type CreationPolicy } from '../creation-policy.js';
import { activeMediaPolicy, type MediaPolicy } from '../media-policy.js';
import type { PatchApplyErrorCode } from '../object-patch-apply.js';
import { childRuleFor } from './block-tree.js';
import { bioDefinition } from './components/bio.js';
import { checklistDefinition } from './components/checklist.js';
import { contactFormDefinition } from './components/contact-form.js';
import { contentEmbedDefinition } from './components/content-embed.js';
import { contentGridDefinition } from './components/content-grid.js';
import { contentSplitDefinition } from './components/content-split.js';
import { ctaBannerDefinition } from './components/cta-banner.js';
import { faqDefinition } from './components/faq.js';
import { heroDefinition } from './components/hero.js';
import { ledeDefinition } from './components/lede.js';
import { linkListDefinition } from './components/link-list.js';
import { newsletterSignupDefinition } from './components/newsletter-signup.js';
import { pricingTableDefinition } from './components/pricing-table.js';
import { productPreviewDefinition } from './components/product-preview.js';
import { proseDefinition } from './components/prose.js';
import { isRegisteredSectionType } from './components/registered-types.js';
import { formConfirmationDefinition } from './components/form-confirmation.js';
import { searchDefinition } from './components/search.js';
import { stepsDefinition } from './components/steps.js';
import { testimonialDefinition } from './components/testimonial.js';
import { sectionVariantDataSchema } from './components/types.js';
import { listPageTypeDefinitions } from './page-types.js';
import { navActionCapacity } from './structural-capacity.js';
import { contentItemBodySchema } from '../../schema/bodies/content-item-v1.js';
import { pageBodySchema } from '../../schema/bodies/page-v1.js';
import { productBodySchema } from '../../schema/bodies/product-v1.js';
import { sectionBodySchema, sectionTypes, type SectionType } from '../../schema/bodies/section-v1.js';
import { sectionTemplateBodySchema } from '../../schema/bodies/section-template-v1.js';
import { themeBodySchema } from '../../schema/bodies/theme-v1.js';
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

// ─── body schema per governed object type (all nine since W7.3) ──────────────

const BODY_SCHEMA: Partial<Record<ObjectType, z.ZodType>> = {
  page: pageBodySchema,
  section: sectionBodySchema,
  navigation: navigationBodySchema,
  site: siteBodySchema,
  taxonomy: taxonomyBodySchema,
  template: templateBodySchema,
  section_template: sectionTemplateBodySchema,
  theme: themeBodySchema,
  product: productBodySchema,
  content_item: contentItemBodySchema,
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
  steps: stepsDefinition.editor,
  content_split: contentSplitDefinition.editor,
  pricing_table: pricingTableDefinition.editor,
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
  upsert_node: 'node.id',
  replace_blueprint: 'blueprint.id',
};

// Ops (or op fields) that exist only for inverse/Discard derivation — agents
// should not hand-author them; the engine emits them when reverting.
const INTERNAL_OPS = new Set<PatchOpName>(['reactivate_term', 'set_product_price']);

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

// Shared by the three recipe types (template / section_template / theme) —
// the W8.3b self-description rule, enforced by checkRecipeMetadata.
const RECIPE_METADATA_CONSTRAINT: Constraint = {
  id: 'recipe_metadata',
  severity: 'blocks_publish',
  enforced_live: true,
  description:
    'Every recipe must be explainable before it publishes: description (what it is), whenToUse (when to pick it ' +
    'over sibling recipes), and scope ("evergreen" = a standing recipe with a strategy behind it; "one_off" = ' +
    'built for a single project) are required to publish and warn while drafting. Schema-optional (older records ' +
    'parse); editable via this type’s meta/fields op. These fields feed the object_inventory recipe summaries — ' +
    'the reuse-first index.',
};

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
      'The object id must match its type’s id pattern (page_ / sec_ / nav_ / tax_ / site_ / tpl_ / prod_ + lowercase; content_item keeps the article req_<flow>_<topic>_<yyyymmdd>_<nn> shape). Omit requested_id on create to have it minted.',
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
    id: 'render_image_ref',
    severity: 'blocks_write',
    enforced_live: true,
    description:
      'A raw Major-Key artifact key (image|pdf/{id}/{sha256}.{ext}) is NOT servable and breaks the build (Astro getImage throws) if it lands in a rendered field. Renderable image fields (src, ogImage, portrait.src, …) must carry the PUBLIC path — /img/{id}/{sha256}.{ext} for images, /pdf/… for pdfs. Only *AssetRef fields hold the raw ref.',
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
          description:
            'At least one non-hidden section is required to publish (warns while drafting). A PageType may ' +
            'lower the minimum: "content_detail" publishes with zero sections — the article is its content, ' +
            'and any sections are optional extras rendered after it.',
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
        {
          id: 'structure_placeable',
          severity: 'blocks_write',
          enforced_live: true,
          description:
            'Every inline section must be a component-bound (standalone-placeable) type or a shared_ref pointer. ' +
            'Leaf-only types (card) compose ONLY inside a content_grid cards source — placed directly they parse ' +
            'but break the site build (W8, closes the Session-K gap).',
        },
      ];
    case 'section':
      return [
        {
          id: 'structure_placeable',
          severity: 'blocks_write',
          enforced_live: true,
          description:
            'A shared section wraps one concrete component-bound instance — never a card leaf (no standalone ' +
            'component) and never another shared_ref (no reference chains).',
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
    case 'product':
      return [
        {
          id: 'product_slug',
          severity: 'blocks_write',
          enforced_live: true,
          description:
            'slug must be lowercase-hyphen ([a-z0-9-]) and unique across products — it becomes /shop/<slug>.',
        },
        {
          id: 'product_commerce',
          severity: 'blocks_write',
          enforced_live: true,
          description:
            "mode↔fields coherence: 'fixed' requires the price display cache and forbids pwyw; 'pwyw' requires " +
            "the pwyw block and has no price cache or Stripe price_id; 'free' requires provider 'none' and " +
            'forbids price/pwyw/Stripe linkage.',
        },
        {
          id: 'product_price_funnel',
          severity: 'blocks_write',
          enforced_live: true,
          description:
            'commerce.price, commerce.stripe, and commerce.stripe_test cannot be patched via set_product_fields — ' +
            'Stripe is canonical for charge amounts; the only price-edit path is the product_set_price tool, ' +
            'which creates the new Stripe Price, archives the old one, and writes linkage + cache in one ' +
            'governed set_product_price patch (that op is tool-authored — do not hand-author it).',
        },
        {
          id: 'product_linkage',
          severity: 'blocks_publish',
          enforced_live: true,
          description:
            "An 'available' fixed-price product must carry stripe.price_id (or the pre-launch stripe_test mirror) " +
            'to publish (warns while drafting); coming_soon/retired products publish without linkage.',
        },
        {
          id: 'product_artifact',
          severity: 'blocks_write',
          enforced_live: true,
          description:
            'fulfillment.artifact_ref (kind download) must be a trusted Major-Key artifact ref in the PRIVATE ' +
            'artifacts store ({image|pdf}/{id}/{sha256}.{ext}); URLs, data: URIs, and repo paths are rejected.',
        },
        {
          id: 'commerce_price_sync',
          severity: 'blocks_publish',
          enforced_live: false,
          description:
            'The price display cache is compared to the live Stripe Price at publish (the backstop for direct ' +
            'dashboard edits). Not enforced live yet — the resolver arrives with the Stripe server surface.',
        },
      ];
    case 'content_item':
      return [
        {
          id: 'article_slug',
          severity: 'blocks_write',
          enforced_live: true,
          description:
            'slug must be lowercase-hyphen and unique across article objects AND the committed legacy posts ' +
            '(src/data/post) — it becomes the article URL through the blog permalink pattern.',
        },
        {
          id: 'article_node_ids',
          severity: 'blocks_write',
          enforced_live: true,
          description:
            'Node ids are opaque n_* ids, unique within the article, and must never contain strategy or ' +
            'commercial vocabulary (hook, agitation, cta, …) — reader-visible ids must not leak intent. Omit ' +
            'node.id on upsert_node to have one minted.',
        },
        {
          id: 'article_visible_nodes',
          severity: 'blocks_publish',
          enforced_live: true,
          description:
            'At least one public (non-internal, non-hidden) content node is required to publish (warns while drafting).',
        },
        {
          id: 'article_rich_text',
          severity: 'blocks_write',
          enforced_live: true,
          description:
            'A rich_text.v1 node body must satisfy the ARTICLE_BODY grammar (p, h2, h3, lists, quotes, embeds; ' +
            'bold/italic marks; https hyperlinks). String node bodies are PLAIN TEXT — escaped at render, blank ' +
            'lines split paragraphs; use a rich_text document for formatting.',
        },
        {
          id: 'article_taxonomy',
          severity: 'blocks_write',
          enforced_live: true,
          description:
            'taxonomy.category and taxonomy.tags resolve against the tax_drlurie registry when it exists ' +
            '(merged_into aliases followed); unknown terms are blockers.',
        },
        {
          id: 'article_annotation_privacy',
          severity: 'blocks_write',
          enforced_live: true,
          description:
            'node.private (strategy/intent/agentNotes), node.commercial internals, and every envelope-level ' +
            'judge/score field (emotional_strategy, claims, scores, editorial, …) are NEVER serialized into ' +
            'reader HTML — the renderer emits public fields only. Annotate freely; readers cannot see it.',
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
            'A required slot without a blueprint or blueprintRef warns (registry defaultData may supply it) — never a hard fail.',
        },
        {
          id: 'template_blueprint_refs',
          severity: 'blocks_write',
          enforced_live: true,
          description:
            'A slot may carry an inline blueprint OR a blueprintRef naming a section_template (never both — ' +
            'schema-enforced). The ref must resolve to an existing section_template whose blueprint type is in ' +
            'the slot’s allowed set. It is dereferenced and deep-copied at instantiation ONLY — editing a recipe ' +
            'changes future instantiations, never existing pages.',
        },
        {
          id: 'template_registry',
          severity: 'blocks_write',
          enforced_live: true,
          description: 'A slot’s allowed types must be registered components (see section_types.component_bound).',
        },
        RECIPE_METADATA_CONSTRAINT,
      ];
    case 'theme':
      return [
        {
          id: 'theme_token_keys',
          severity: 'blocks_publish',
          enforced_live: true,
          description:
            'A published theme must carry every color key the renderer consumes (primary, secondary, accent, gold, ' +
            'text-heading, text-default, text-muted, bg-page, bg-surface, bg-page-dark) so applying it is total — ' +
            'exact-replace leaves no stale fallbacks (warns while drafting). dark:-prefixed overrides are optional ' +
            '(a missing dark key falls back to the light value); unknown keys warn (inert).',
        },
        {
          id: 'brand_token_values',
          severity: 'blocks_write',
          enforced_live: true,
          description:
            'Token values are interpolated RAW into an inline <style> tag, so every color/font value must pass the ' +
            'safe-CSS grammar (hex / rgb()/rgba()/hsl()/hsla()/oklch()/color() / bare keyword; plain font stacks); ' +
            'values carrying ;, {, }, <, >, url(, or @import are rejected. The SAME rule gates site.brandTokens.',
        },
        RECIPE_METADATA_CONSTRAINT,
      ];
    case 'site':
      return [
        {
          id: 'brand_token_values',
          severity: 'blocks_write',
          enforced_live: true,
          description:
            'brandTokens values are interpolated RAW into an inline <style> tag (CustomStyles) — every color/font ' +
            'value must pass the safe-CSS grammar; values carrying ;, {, }, <, >, url(, or @import are rejected ' +
            '(W8.3 — the same rule gates theme tokens).',
        },
        {
          id: 'palette_theme_only',
          severity: 'blocks_write',
          enforced_live: true,
          description:
            'brandTokens cannot be patched via set_site_fields — the palette changes ONLY through the ' +
            'site_apply_theme tool, which copies a theme object’s tokens in one governed set_site_brand_tokens ' +
            'patch (that op is tool-authored — do not hand-author it). So every color edit goes through an ' +
            'auditable, revertible theme, and theme creation is restrictable to a maker agent via the creation ' +
            'policy (Wolf 2026-07-15).',
        },
      ];
    case 'section_template':
      return [
        {
          id: 'blueprint_standalone_renderable',
          severity: 'blocks_write',
          enforced_live: true,
          description:
            'The blueprint must be a component-bound section type placeable standalone on a page (see ' +
            'section_types.component_bound) — never a card leaf (no standalone component; composes only inside a ' +
            'content_grid cards source) and never a shared_ref (a pointer is not a recipe: instantiation copies, ' +
            'never aliases). The blueprint’s s_* id is a placeholder — instantiation always re-mints a fresh one.',
        },
        RECIPE_METADATA_CONSTRAINT,
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
  content_item_not_gated: 'Defensive only since W7.3 (every type is governed): the type is outside the gate.',
  approval_required: 'The type requires approval and none is current/approved.',
  changes_requested: 'A reviewer requested changes; resubmit before publishing.',
  approval_stale: 'The approval was pinned to an older content_revision; re-approve.',
  publish_role_required: 'A human executing a publish needs the admin or publisher role.',
  publish_action_not_pinned:
    'An agent-executed publish of a gated type needs the approval to pin the exact action (M-6).',
  publish_action_mismatch: 'The requested publish action differs from the approved (pinned) one.',
};

/**
 * Who may CREATE this type (W8.3b) — computed from the committed creation
 * policy (src/config/creation-policy.ts), never hardcoded. Humans always
 * create; the policy constrains agents. ⚠️ agent_name is self-declared until
 * OQ-3 — a coordination seam, not a security boundary.
 */
export type CreationPolicyContract = {
  humans: 'always_allowed';
  agents: 'open' | { allowlist: string[] };
  note: string;
};

const creationPolicyContract = (objectType: ObjectType, policy: CreationPolicy): CreationPolicyContract => {
  const rule = isGovernedObjectType(objectType) ? creationRuleFor(objectType, policy) : 'open';
  return {
    humans: 'always_allowed',
    agents: rule === 'open' ? 'open' : { allowlist: rule.agents },
    note:
      'Resolution: per-type override → master (src/config/creation-policy.ts; currently ' +
      (rule === 'open' ? 'open for this type' : 'ALLOWLISTED for this type — a denial is a 403 creation_restricted') +
      '). The policy keys on the type BEING CREATED: object_instantiate_template creates a page; a standalone ' +
      'section stamp creates a section; page-mode stamping and site_apply_theme are patches, never gated. ' +
      'agent_name is self-declared until per-agent credentials (OQ-3) land — treat as coordination, not security.',
  };
};

export type PublishPolicyContract = {
  gated: boolean;
  requires_approval: boolean;
  note: string;
  denial_codes?: Record<string, string>;
  pin_rules?: string;
};

const publishPolicy = (objectType: ObjectType, policy: ApprovalPolicy): PublishPolicyContract => {
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

/**
 * media_policy — the per-site image budget, echoed from src/config/media-policy.ts
 * so any agent reading the contract discovers it even without touching pdf-tool
 * (where it also rides the storage grant as `limits`). Site-wide, not per-type.
 */
export type MediaPolicyContract = {
  max_image_bytes: number;
  preferred_image_format: string;
  over_budget: 'warn' | 'block';
  note: string;
};

const mediaPolicyContract = (policy: MediaPolicy): MediaPolicyContract => ({
  max_image_bytes: policy.maxImageBytes,
  preferred_image_format: policy.preferredImageFormat,
  over_budget: policy.overBudget,
  note:
    'Per-site image budget (src/config/media-policy.ts), also carried on the pdf-tool storage grant as `limits`. ' +
    'Encode images to preferred_image_format and keep each within max_image_bytes. over_budget=warn stores an ' +
    'over-limit image but flags it (abide unless a human/admin explicitly asks for a larger one); block rejects it. ' +
    'To fix an already-stored oversize image, ask pdf-tool to shrink it under the budget.',
});

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
    // W8.3b, Wolf: agents reuse existing recipes before minting new ones —
    // the inventory summary is the cheap index; fetch bodies only after it.
    ...(objectType === 'template' || objectType === 'section_template' || objectType === 'theme'
      ? [
          `REUSE FIRST: object_inventory({object_type: "${objectType}"}) lists every existing ${objectType} with a self-describing recipe summary (description, whenToUse, scope) — pick one and object_get it; create a NEW recipe only when none fits, and give it description/whenToUse/scope so the next agent can reuse yours.`,
        ]
      : []),
    'object_contract (this call) → read the schema, ops, constraints',
    'object_create (omit requested_id to mint one) — for a new object',
    ...(objectType === 'content_item'
      ? [
          'object_create_variant (source_object_id [+ requested_id]) — alternative create: clone an article as a draft variant (lineage.parent_content_id set, node ids re-minted, annotations carried) for judge/score/A-B work',
        ]
      : []),
    // W2.5, design-principles rule 5: templates are recipes — instantiation
    // copies slot blueprints into a NEW page via the standard create path.
    ...(objectType === 'page'
      ? [
          'object_instantiate_template (template_id + route + title) — alternative create: start the page from a template recipe',
        ]
      : []),
    ...(objectType === 'template'
      ? [
          'object_instantiate_template (template_id + route + title [+ page_type/seo]) → creates a NEW page from this recipe through the standard page create validation; dry_run: true previews the built body without persisting. Pages copy the blueprints at creation and never live-inherit from the template. A slot may reference a section_template via blueprintRef — dereferenced and deep-copied at instantiation.',
        ]
      : []),
    // W8.2, 09-plan §3: section recipes stamp through the standard write paths.
    ...(objectType === 'section_template'
      ? [
          'object_instantiate_section_template (section_template_id + target {kind:"page", page_id, position?, lock_token, expected_record_version} | {kind:"standalone", requested_id?}) → deep-copies this blueprint with a fresh minted s_* id into a page YOU have checked out (one upsert_section through the standard patch path — the verb never auto-checkouts) or mints a standalone shared sec_* object via the standard create path; dry_run: true previews without persisting. Stamped sections never live-inherit from the recipe. Escape hatch: object_get the recipe and hand-copy its blueprint into a plain upsert_section.',
        ]
      : []),
    ...(objectType === 'section'
      ? [
          'object_instantiate_section_template (target kind "standalone") — alternative create: mint this shared section from a section_template recipe.',
        ]
      : []),
    // W8.3, 09-plan §6.4: applying a theme is a SITE write, not a theme op.
    ...(objectType === 'theme'
      ? [
          'site_apply_theme (theme_id + site_id + lock_token + expected_record_version) → computes ONE exact-replace set_site_fields op (every color key the theme lacks is unset — no stale palette) and applies it through the standard patch path under YOUR site checkout; dry_run: true previews the computed op + validation without persisting. The site copies the tokens — nothing live-binds to a theme; publish the site separately to go live.',
        ]
      : []),
    ...(objectType === 'site'
      ? [
          'site_apply_theme (theme_id + this site id + lock_token + expected_record_version) — alternative brandTokens edit: replace the token set with a theme preset in one atomic op (dry_run previews).',
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
  inputs.push({ input: 'site', when: 'object_create', how: 'The owning site object id, e.g. site_drlurie.' });
  if (objectType === 'content_item') {
    inputs.push(
      {
        input: 'taxonomy terms',
        when: 'taxonomy.category / taxonomy.tags',
        how: 'Slugs from the tax_drlurie registry (registry_get / object_contract("taxonomy")); merged_into aliases resolve, unknown terms block.',
      },
      {
        input: 'strategy annotations',
        when: 'every node (strongly recommended)',
        how: 'Set node.private.strategy (hook/agitation/context/explanation/proof/example/comparison/myth/step/recommendation/resolution/summary) and node.private.intent (educate/persuade/reassure/convert/navigate) so agents can judge, score, and build variants. Never rendered to readers.',
      }
    );
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
  if (objectType === 'product') {
    inputs.push(
      {
        input: 'fulfillment artifact ref',
        when: 'fulfillment.kind "download"',
        how: 'Upload the deliverable to the PRIVATE artifacts store first (create_artifact_upload_intent), then use the returned Major-Key ref. It is delivered only through token-gated purchase links, never a public URL.',
      },
      {
        input: 'long-form page',
        when: 'presentation.page_ref (optional)',
        how: 'Create an ordinary Page object (object_create or object_instantiate_template) carrying the long-form sections; the product page renders them after the buy box. Omit for a thin card+buy-box page.',
      }
    );
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
  creation_policy: CreationPolicyContract;
  media_policy: MediaPolicyContract;
  workflow: ReturnType<typeof workflow>;
  auxiliary_inputs: AuxiliaryInput[];
};

export const OBJECT_CONTRACT_TYPES = objectTypes;

export const buildObjectContract = (
  objectType: ObjectType,
  options: { approvalPolicy?: ApprovalPolicy; creationPolicy?: CreationPolicy; mediaPolicy?: MediaPolicy } = {}
): ObjectContract => {
  const policy = options.approvalPolicy ?? activeApprovalPolicy();
  const creationPolicy = options.creationPolicy ?? activeCreationPolicy();
  const mediaPolicy = options.mediaPolicy ?? activeMediaPolicy();
  const schema = BODY_SCHEMA[objectType];
  const includesSections = objectType === 'page' || objectType === 'section' || objectType === 'section_template';
  return {
    object_type: objectType,
    governed: isGovernedObjectType(objectType),
    creatable: true,
    summary:
      objectType === 'content_item'
        ? 'Articles as governed objects (W7.3): an annotated node list (private.strategy/intent per block — the behavioral framework) with rich_text.v1 or plain-text bodies, plus the envelope-level judge/score substrate (claims/sources/compliance/emotional_strategy/scores/lineage). Committed legacy posts stay on their own pipeline.'
        : objectType === 'section_template'
          ? 'A section recipe (W8, design-principles rule 5): one named, pre-configured section blueprint agents create and evolve freely, then stamp into pages or mint as standalone shared sections. Instantiation deep-copies the blueprint and re-mints its id — nothing live-binds to a recipe, and a recipe renders nothing itself.'
          : objectType === 'theme'
            ? 'A brandTokens preset (W8.3, design-principles rule 5 — NOT taxonomy): named color/font token values agents draft and validate, then apply to the site singleton via site_apply_theme (exact-replace; stale keys unset). Applied by COPY — the site never live-inherits from a theme, and a theme renders nothing itself.'
            : `Everything an agent needs to create and edit a ${objectType} object: body schema, patch ops, constraints, publish policy, and required side-data.`,
    body_schema: schema ? toJson(schema) : { note: `${objectType} has no generic body schema.` },
    ...(includesSections ? { section_types: listSectionTypeContracts() } : {}),
    ...(objectType === 'page' ? { page_types: listPageTypeDefinitions() } : {}),
    patch_ops: patchOpContracts(objectType),
    constraints: [...COMMON_CONSTRAINTS, ...perTypeConstraints(objectType)],
    publish_policy: publishPolicy(objectType, policy),
    creation_policy: creationPolicyContract(objectType, creationPolicy),
    media_policy: mediaPolicyContract(mediaPolicy),
    workflow: workflow(objectType, policy),
    auxiliary_inputs: auxiliaryInputs(objectType),
  };
};
