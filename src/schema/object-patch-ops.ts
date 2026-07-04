/**
 * Typed patch grammar — the C§2.0 op families (T0.6).
 *
 * Agents edit objects through these typed operations, never free-form body
 * writes (03-mapping-and-agent-contract §2.0). Every op is designed to be
 * invertible: application (src/lib/object-patch-apply.ts) captures a
 * `{before, after}` snapshot per op, and `derivePatchInverse` produces the
 * compensating op the human-review Discard action applies (C§2.4).
 *
 * Payload shapes (sections, nav items, terms, slots) are minimally pinned
 * here — an identity key plus loose passthrough — because deep per-type
 * validation is the T0.2 body schemas' + T0.7 validation pipeline's job.
 * This module owns the op *structure*; the apply engine owns the mechanics.
 *
 * Grammar rules that ops rely on:
 * - Inside `fields` payloads, `null` means "unset this key". Body schemas
 *   (D§3.2–3.8) have no null-valued fields, so null is unambiguous as the
 *   deletion/absence marker, and captures encode "key was absent" as null.
 * - Plain-object `fields` values merge recursively; arrays and scalars
 *   replace wholesale.
 * - `guard` carries the expected current state of the unit an op touches
 *   (the originating op's captured `after`); the engine refuses the op when
 *   the draft has moved — the C§2.4 blind-revert rule. Inverse derivation
 *   always populates it; hand-written ops normally omit it.
 *
 * Deliberate grammar additions beyond the C§2.0 sketch (each required for
 * inverse completeness, per C§2.4's "any future op must define its inverse"):
 * - `remove_term` — C§2.4 names term removal as `add_term`'s inverse.
 * - `reactivate_term` — the inverse of deprecating an active term.
 * - `set_section_visibility` accepts `null` — restores the unset default,
 *   so setting visibility on a section that had none is exactly reversible.
 * - `remove_item`/`remove_action` carry `prune_empty` — restores absence of
 *   an optional container (`children`/`actions`) the forward upsert created.
 * - `upsert_item` carries `parent_item_id` — nav items live in a depth-≤2
 *   tree (D§3.8); removals inside a dropdown must be restorable in place.
 * - `update_term` carries `alias_term_id`/`mint_alias`/`restore_alias`/
 *   `consume_alias_expected` for the slug-rename auto-alias rule
 *   (C§2.3-taxonomy) and its exact, guarded inverse.
 *   `mint_alias: false` is engine-gated: only honored when the rename
 *   reverts to a slug this term previously owned (evidenced by consuming its
 *   own deprecated alias), so a drift-reintroducing aliasless rename is
 *   mechanically impossible, not just validation-rejected.
 */
import { z } from 'zod';
import { SECTION_INSTANCE_ID_RE } from '../lib/object-ids.js';
import type { ObjectType } from './object-record-v1.js';

// Term ids are opaque and stable (D§3.7); the shape is repeated here rather
// than imported so the grammar stays dependency-light (T0.2 owns the body
// schema; T0.3 owns object-level ids — term ids are body-internal).
export const TERM_ID_RE = /^t_[a-z0-9]+$/;

// ——— shared primitives ———

export type PatchJsonValue = string | number | boolean | null | PatchJsonValue[] | { [key: string]: PatchJsonValue };

export const patchJsonValueSchema: z.ZodType<PatchJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(patchJsonValueSchema),
    z.record(z.string(), patchJsonValueSchema),
  ])
);

// Deep-partial `fields` payload: plain objects merge, arrays/scalars replace,
// null unsets. Key restrictions per op are applied via superRefine below.
const fieldsSchema = z.record(z.string(), patchJsonValueSchema);

const forbidKeys =
  (forbidden: readonly string[], where: string) => (value: Record<string, unknown>, ctx: z.RefinementCtx) => {
    for (const key of forbidden) {
      if (key in value) {
        ctx.addIssue({ code: 'custom', message: `'${key}' cannot be patched via ${where}.` });
      }
    }
  };

// Expected current state of the unit this op touches, encoded exactly like
// the apply engine's captured snapshots (see PatchOpCapture in
// object-patch-apply.ts). Deep-equality-checked before the op applies;
// mismatch → blind_revert_refused (C§2.4).
export const patchOpGuardSchema = z.strictObject({ expected: z.unknown() });
export type PatchOpGuard = z.infer<typeof patchOpGuardSchema>;

const guard = { guard: patchOpGuardSchema.optional() };

const positionSchema = z.number().int().min(0);

// ——— payload shapes: identity key pinned, remainder passthrough (T0.2/T0.7 validate deeply) ———

const sectionPayloadSchema = z.looseObject({
  id: z.string().regex(SECTION_INSTANCE_ID_RE, { message: 'Section ids must match s_<lowercase alphanumerics>' }),
});
const navItemPayloadSchema = z.looseObject({ id: z.string().min(1) });
const navGroupPayloadSchema = z.looseObject({ id: z.string().min(1) });
const linkActionPayloadSchema = z.looseObject({ label: z.string().min(1) });
const templateSlotPayloadSchema = z.looseObject({ slotId: z.string().min(1) });

const taxonomyKindSchema = z.enum(['category', 'tag']);
export type PatchTaxonomyKind = z.infer<typeof taxonomyKindSchema>;

// Full Term shape (D§3.7) — small, stable, and correctness-critical, so it is
// pinned strictly rather than passthrough. `status` defaults to 'active' at
// apply time (C§2.0's "add_term … (status 'active')"); explicit values exist
// so remove_term's inverse can restore a deprecated term exactly.
const termPayloadSchema = z.strictObject({
  term_id: z.string().regex(TERM_ID_RE, { message: 'Term ids must match t_<lowercase alphanumerics>' }),
  slug: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(['active', 'deprecated']).optional(),
  merged_into: z.string().regex(TERM_ID_RE).optional(),
});
export type TermPayload = z.infer<typeof termPayloadSchema>;

// ——— Pages / shared sections (C§2.0) ———

const setPageMetaSchema = z
  .strictObject({
    op: z.literal('set_page_meta'),
    fields: fieldsSchema.superRefine(forbidKeys(['sections'], 'set_page_meta (use the section ops)')),
    ...guard,
  })
  .describe('Merge page meta fields (title/route/seo/…); sections are edited only via section ops.');

const upsertSectionSchema = z.strictObject({
  op: z.literal('upsert_section'),
  section: sectionPayloadSchema,
  // Insert position; ignored when a section with the same id already exists
  // (replace happens in place). Clamped to the array bounds.
  position: positionSchema.optional(),
  ...guard,
});

const updateSectionDataSchema = z.strictObject({
  op: z.literal('update_section_data'),
  section_id: z.string().regex(SECTION_INSTANCE_ID_RE),
  fields: fieldsSchema,
  ...guard,
});

const moveSectionSchema = z.strictObject({
  op: z.literal('move_section'),
  section_id: z.string().regex(SECTION_INSTANCE_ID_RE),
  to_index: positionSchema,
  ...guard,
});

const setSectionVisibilitySchema = z.strictObject({
  op: z.literal('set_section_visibility'),
  section_id: z.string().regex(SECTION_INSTANCE_ID_RE),
  // null restores the unset default (D§3.5's optional visibility), so the
  // inverse of setting visibility on a bare section is exact.
  visibility: z.union([z.enum(['public', 'hidden']), z.null()]),
  ...guard,
});

const removeSectionSchema = z.strictObject({
  op: z.literal('remove_section'),
  section_id: z.string().regex(SECTION_INSTANCE_ID_RE),
  ...guard,
});

// ——— Navigation (C§2.0) ———

const setNavMetaSchema = z.strictObject({
  op: z.literal('set_nav_meta'),
  // Exactly the C§2.0 surface: brand and footNote. role/groups/actions are
  // structural and have their own ops. Nested nulls unset individual brand
  // keys (the grammar's null=unset rule), so inverses of partial brand
  // writes stay expressible.
  fields: z.strictObject({
    brand: z
      .union([
        z.strictObject({
          text: z.union([z.string(), z.null()]).optional(),
          descriptor: z.union([z.string(), z.null()]).optional(),
        }),
        z.null(),
      ])
      .optional(),
    footNote: z.union([z.string(), z.null()]).optional(),
  }),
  ...guard,
});

const upsertGroupSchema = z.strictObject({
  op: z.literal('upsert_group'),
  group: navGroupPayloadSchema,
  position: positionSchema.optional(),
  ...guard,
});

const moveGroupSchema = z.strictObject({
  op: z.literal('move_group'),
  group_id: z.string().min(1),
  to_index: positionSchema,
  ...guard,
});

const removeGroupSchema = z.strictObject({
  op: z.literal('remove_group'),
  group_id: z.string().min(1),
  ...guard,
});

const upsertItemSchema = z.strictObject({
  op: z.literal('upsert_item'),
  group_id: z.string().min(1),
  item: navItemPayloadSchema,
  // Insert position within the target list; ignored on replace.
  position: positionSchema.optional(),
  // When set, the item is inserted into this item's `children` (created if
  // absent) instead of the group's top-level items. Ignored on replace —
  // an existing item is replaced wherever it lives.
  parent_item_id: z.string().min(1).optional(),
  ...guard,
});

const updateItemSchema = z.strictObject({
  op: z.literal('update_item'),
  group_id: z.string().min(1),
  item_id: z.string().min(1),
  fields: fieldsSchema.superRefine(forbidKeys(['id'], 'update_item (ids are stable)')),
  ...guard,
});

const moveItemSchema = z.strictObject({
  op: z.literal('move_item'),
  group_id: z.string().min(1),
  item_id: z.string().min(1),
  // Target index within the item's current list (top-level items or its
  // parent's children); cross-list moves are remove + upsert.
  to_index: positionSchema,
  ...guard,
});

const removeItemSchema = z.strictObject({
  op: z.literal('remove_item'),
  group_id: z.string().min(1),
  item_id: z.string().min(1),
  // When removal empties an optional `children` array, also remove the key —
  // set by inverse derivation to restore container-absence exactly.
  prune_empty: z.boolean().optional(),
  ...guard,
});

const upsertActionSchema = z.strictObject({
  op: z.literal('upsert_action'),
  // Actions carry no id (D§3.8); they are keyed by label. Changing a label is
  // remove_action + upsert_action.
  action: linkActionPayloadSchema,
  position: positionSchema.optional(),
  ...guard,
});

const removeActionSchema = z.strictObject({
  op: z.literal('remove_action'),
  label: z.string().min(1),
  // As remove_item.prune_empty, for the optional body-level `actions` array.
  prune_empty: z.boolean().optional(),
  ...guard,
});

// ——— Taxonomy (C§2.0 + C§2.3-taxonomy) ———

const addTermSchema = z.strictObject({
  op: z.literal('add_term'),
  kind: taxonomyKindSchema,
  term: termPayloadSchema,
  // Insert position; set by inverse derivation so remove_term round-trips
  // exactly. Appends by default.
  position: positionSchema.optional(),
  ...guard,
});

const updateTermSchema = z.strictObject({
  op: z.literal('update_term'),
  kind: taxonomyKindSchema,
  term_id: z.string().regex(TERM_ID_RE),
  fields: z.strictObject({
    label: z.string().min(1).optional(),
    description: z.union([z.string(), z.null()]).optional(),
    slug: z.string().min(1).optional(),
  }),
  // Slug-rename auto-alias controls (C§2.3-taxonomy). A slug change mints a
  // deprecated alias term {slug: <old slug>, merged_into: <this term>} in
  // the same op. `alias_term_id` names the minted alias's id (deterministic
  // minting when omitted). `mint_alias: false` suppresses the mint and is
  // honored only when the rename provably reverts a prior rename (the apply
  // engine enforces this); `restore_alias` re-inserts a previously consumed
  // alias. Both are populated by inverse derivation, not written by hand.
  alias_term_id: z.string().regex(TERM_ID_RE).optional(),
  mint_alias: z.boolean().optional(),
  restore_alias: z.strictObject({ term: termPayloadSchema, position: positionSchema }).optional(),
  // Exact snapshot of the alias this revert expects to consume (the forward
  // op's minted/restored alias). The engine deep-equal-checks it before the
  // consume — an alias edited or removed since the forward op refuses as a
  // blind revert (C§2.4). Populated by inverse derivation.
  consume_alias_expected: termPayloadSchema.optional(),
  ...guard,
});

const deprecateTermSchema = z.strictObject({
  op: z.literal('deprecate_term'),
  kind: taxonomyKindSchema,
  term_id: z.string().regex(TERM_ID_RE),
  // Omitted = deprecate without a merge target (validation decides whether
  // live usage requires one, C§2.3); always overwrites the stored value.
  merged_into: z.string().regex(TERM_ID_RE).optional(),
  ...guard,
});

const reactivateTermSchema = z.strictObject({
  op: z.literal('reactivate_term'),
  kind: taxonomyKindSchema,
  term_id: z.string().regex(TERM_ID_RE),
  ...guard,
});

const removeTermSchema = z.strictObject({
  op: z.literal('remove_term'),
  kind: taxonomyKindSchema,
  term_id: z.string().regex(TERM_ID_RE),
  ...guard,
});

// ——— Site (C§2.0) ———

const setSiteFieldsSchema = z.strictObject({
  op: z.literal('set_site_fields'),
  // Deep-partial SiteBody; per-field validation is T0.7's job.
  fields: fieldsSchema,
  ...guard,
});

// ——— Template (C§2.0) ———

const setTemplateMetaSchema = z.strictObject({
  op: z.literal('set_template_meta'),
  fields: fieldsSchema.superRefine(forbidKeys(['slots'], 'set_template_meta (use the slot ops)')),
  ...guard,
});

const upsertSlotSchema = z.strictObject({
  op: z.literal('upsert_slot'),
  slot: templateSlotPayloadSchema,
  position: positionSchema.optional(),
  ...guard,
});

const moveSlotSchema = z.strictObject({
  op: z.literal('move_slot'),
  slot_id: z.string().min(1),
  to_index: positionSchema,
  ...guard,
});

const removeSlotSchema = z.strictObject({
  op: z.literal('remove_slot'),
  slot_id: z.string().min(1),
  ...guard,
});

// ——— The grammar ———

// Union members stay plain object schemas (a zod discriminated-union
// requirement); cross-field rules live in the top-level superRefine below.
const patchOpUnionSchema = z.discriminatedUnion('op', [
  setPageMetaSchema,
  upsertSectionSchema,
  updateSectionDataSchema,
  moveSectionSchema,
  setSectionVisibilitySchema,
  removeSectionSchema,
  setNavMetaSchema,
  upsertGroupSchema,
  moveGroupSchema,
  removeGroupSchema,
  upsertItemSchema,
  updateItemSchema,
  moveItemSchema,
  removeItemSchema,
  upsertActionSchema,
  removeActionSchema,
  addTermSchema,
  updateTermSchema,
  deprecateTermSchema,
  reactivateTermSchema,
  removeTermSchema,
  setSiteFieldsSchema,
  setTemplateMetaSchema,
  upsertSlotSchema,
  moveSlotSchema,
  removeSlotSchema,
]);

const requireMergedIntoOnlyWhenDeprecated = (term: TermPayload, ctx: z.RefinementCtx, path: (string | number)[]) => {
  if (term.merged_into !== undefined && (term.status ?? 'active') !== 'deprecated') {
    // An active term with a merge target is not a state the status ops can
    // reach or invert; keep it unmintable.
    ctx.addIssue({ code: 'custom', path, message: 'merged_into requires status deprecated.' });
  }
};

export const patchOpSchema = patchOpUnionSchema.superRefine((op, ctx) => {
  if (op.op === 'add_term') {
    requireMergedIntoOnlyWhenDeprecated(op.term, ctx, ['term']);
  }
  if (op.op === 'update_term' && op.restore_alias !== undefined) {
    requireMergedIntoOnlyWhenDeprecated(op.restore_alias.term, ctx, ['restore_alias', 'term']);
  }
  if (op.op === 'update_term') {
    if (
      op.fields.slug === undefined &&
      (op.alias_term_id !== undefined ||
        op.mint_alias !== undefined ||
        op.restore_alias !== undefined ||
        op.consume_alias_expected !== undefined)
    ) {
      ctx.addIssue({
        code: 'custom',
        message:
          'alias_term_id/mint_alias/restore_alias/consume_alias_expected are only meaningful when fields.slug is present.',
      });
    }
    if (op.restore_alias !== undefined && op.mint_alias !== false) {
      // Minting an alias for the vacated slug AND restoring one for the same
      // slug would double-claim it; restores only travel with mint_alias: false.
      ctx.addIssue({ code: 'custom', message: 'restore_alias requires mint_alias: false.' });
    }
    if (op.consume_alias_expected !== undefined && op.mint_alias !== false) {
      // Consumption expectations describe reverts; the organic (minting)
      // path consumes without an expectation by design.
      ctx.addIssue({ code: 'custom', message: 'consume_alias_expected requires mint_alias: false.' });
    }
  }
});

export type PatchOp = z.infer<typeof patchOpSchema>;
export type PatchOpName = PatchOp['op'];
export type PatchOpOfName<TName extends PatchOpName> = Extract<PatchOp, { op: TName }>;

export const patchOpsSchema = z.array(patchOpSchema);

// ——— Which object types accept which ops (C§2.0 families / C§2.2 matrix) ———
//
// A shared 'section' object is "a one-section page record in practice"
// (C§2.3-section): its body wraps exactly one SectionInstance, so it accepts
// the payload/visibility ops and whole-section replacement, but not
// move/remove (there is no list) and no page meta.
//
// content_item is deliberately empty: the article tool surface is unchanged
// (C§2.0); generic envelope-level access arrives with the adapter (D§1),
// which is out of T0.6's scope.
export const patchOpNamesByObjectType: Record<ObjectType, readonly PatchOpName[]> = {
  page: [
    'set_page_meta',
    'upsert_section',
    'update_section_data',
    'move_section',
    'set_section_visibility',
    'remove_section',
  ],
  section: ['upsert_section', 'update_section_data', 'set_section_visibility'],
  navigation: [
    'set_nav_meta',
    'upsert_group',
    'move_group',
    'remove_group',
    'upsert_item',
    'update_item',
    'move_item',
    'remove_item',
    'upsert_action',
    'remove_action',
  ],
  taxonomy: ['add_term', 'update_term', 'deprecate_term', 'reactivate_term', 'remove_term'],
  site: ['set_site_fields'],
  template: ['set_template_meta', 'upsert_slot', 'move_slot', 'remove_slot'],
  content_item: [],
};

export const isPatchOpAllowedForObjectType = (objectType: ObjectType, opName: PatchOpName): boolean =>
  (patchOpNamesByObjectType[objectType] as readonly string[]).includes(opName);
