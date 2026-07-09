/**
 * Component registry contracts (T3.2, D§3.5/D§4.2).
 *
 * The single field-level source of truth for every section type stays in
 * `src/schema/bodies/section-v1.ts` — the exact schemas the T0.7 validator
 * runs. Registry modules do not redeclare fields; they LOOK UP their
 * variant's `data` schema from the live discriminated union via
 * `sectionVariantDataSchema`, so the registry cannot drift from validation.
 *
 * Testability split (deliberate, documented deviation from the D§3.5
 * interface listing `component` on the per-type module): per-type modules
 * are pure TypeScript ({type, schema, editor, resolveRefs?}) so the repo's
 * tsc + node--test harness can execute them; the `.astro` component binding
 * happens once in `index.ts` (which only Astro's vite pipeline loads).
 * Growth cost stays "one registry module + one union member" plus a
 * one-line binding.
 */
import { z } from 'zod';

import { sectionInstanceSchema, type SectionInstance } from '../../../schema/bodies/section-v1.js';

export type SectionType = SectionInstance['type'];

/** The variant's `data` payload type for a given section type. */
export type SectionDataOf<TType extends SectionType> = Extract<SectionInstance, { type: TType }>['data'];

/**
 * The variant's `data` zod schema, extracted from the live union — identity
 * with the validator by construction.
 */
export const sectionVariantDataSchema = (type: SectionType): z.ZodType<unknown> => {
  const option = sectionInstanceSchema.options.find((candidate) => candidate.shape.type.value === type);
  if (!option) throw new Error(`No section variant '${type}' in sectionInstanceSchema`);
  return option.shape.data;
};

/**
 * Editor affordances (replaces input-bank.ts's template role for pages,
 * D§3.5). Consumed by the page editor at T3.12; `defaultData` is the
 * "insert new section" blueprint and must parse under the type's schema
 * (pinned by tests).
 */
export type FieldHint = {
  label: string;
  help?: string;
  widget?: 'text' | 'richtext' | 'text_list' | 'link_actions' | 'select' | 'number' | 'cards' | 'hidden';
};

export type ComponentEditorHints<TType extends SectionType> = {
  label: string;
  icon: string;
  fieldHints: Partial<Record<keyof SectionDataOf<TType> & string, FieldHint>>;
  defaultData: SectionDataOf<TType>;
};

/**
 * D§4.2: dereferenced pointers computed by the Renderer at build time. Each
 * type declares its own resolved shape; types with no references resolve to
 * an empty object. The resolver machinery itself arrives with T3.6
 * (`src/lib/renderer/resolve.ts`) — the shapes are the contract it fills.
 */
export type HeroResolved = {
  /** hrefs for data.actions, aligned by index (page/route targets → urls). */
  actionHrefs: string[];
};
/** link_list: hrefs for data.links, aligned by index (same policy as actions). */
export type LinkListResolved = {
  linkHrefs: string[];
};
/**
 * product_preview: one action href per product, aligned by index (undefined
 * where a product carries no action). `imageAssetRef` is deliberately NOT
 * resolved here — asset refs render only once a trusted-artifact resolver
 * exists on the render path (same posture as bio's portraitAssetRef).
 */
export type ProductPreviewResolved = {
  productActionHrefs: Array<string | undefined>;
};
/**
 * content_embed: the referenced content_item resolved to a link card. `card` is
 * absent when the article is missing or unpublished — an embed of a
 * not-yet-published item simply renders nothing rather than failing the page.
 */
export type ContentEmbedCard = { title: string; href: string; excerpt?: string };
export type ContentEmbedResolved = { card?: ContentEmbedCard };
export type EmptyResolved = Record<string, never>;

/**
 * content_grid (M-8, T3.9): `manual`/`query` sources resolve to cards here;
 * `static` needs none (the component renders data.source.cards verbatim), so
 * `cards` is optional — absent/undefined is exactly the static case.
 */
export type ContentGridCard = { title: string; description?: string };
export type ContentGridResolved = { cards?: ContentGridCard[] };

/** Read-only site context (D§4.2). Populated from the Site export in P5; opaque until then. */
export type RenderCtx = Record<string, unknown>;

export type SectionRenderProps<TData, TResolved> = {
  data: TData;
  resolved: TResolved;
  ctx: RenderCtx;
};

/** The pure (node-testable) part of a per-type registry module. */
export type SectionComponentDefinition<TType extends SectionType, TResolved> = {
  type: TType;
  schema: z.ZodType<unknown>;
  editor: ComponentEditorHints<TType>;
  /** Renderer hook (T3.6): computes TResolved from data. Absent = no references. */
  resolveRefs?: (data: SectionDataOf<TType>, ctx: RenderCtx) => Promise<TResolved>;
  /**
   * Block-tree bounds (docs/cms-architecture/block-tree.md): the child block
   * types this type may contain, and how many. Absent = a **leaf** (no children).
   * Validation walks the tree and enforces these at every node; `object_contract`
   * surfaces them so an agent knows the legal tree grammar before acting. This
   * generalizes `PageType.allowedSections` / `Template.slots.allowed` to every
   * container block.
   */
  allowedChildren?: SectionType[];
  childCount?: { min?: number; max?: number };
};
