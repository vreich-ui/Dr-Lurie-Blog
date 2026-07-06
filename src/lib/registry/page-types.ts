/**
 * PageType registry v1 (T3.1) — the D§3.4 code registry.
 *
 * Lives in code, not Blobs (OQ-4): PageTypes bind to Astro route files and
 * loaders that are necessarily code. Exposed read-only through the MCP
 * `registry_get` tool (replacing the T0.9 stub); shared across sites.
 *
 * v1 ships the three types Phase 3 needs — `home`, `standard`, `system` —
 * fully defined. `listing` and `content_detail` are TYPED here (the
 * PageTypeId enum in page-v1.ts has carried all five since T0.2) but their
 * definitions are deliberately absent until P6 formalizes the blog listing
 * loaders (A§2.5–2.6): an unimplemented type failing registry lookup loudly
 * beats a guessed definition silently constraining validation.
 *
 * Review policy (D§3.9): pages are review-required across the board —
 * `page` is Tier 2, so publish is agent-executable but only after an
 * approval pinned to the reviewed content_revision (+ M-6 publish action).
 * `publishRoles` names the HUMAN roles allowed to execute a publish; the
 * agent capability class is governed by the tier gate, not listed here.
 */
import { z } from 'zod';

import { pageTypeIdSchema, type PageTypeId } from '../../schema/bodies/page-v1.js';
import { contentQuerySchema, sectionTypeSchema, type SectionInstance } from '../../schema/bodies/section-v1.js';

type SectionType = SectionInstance['type'];

/** Mirrors netlify/lib/roles.ts `Role` (D§3.9) — src code must not import netlify/lib. */
export type PublishRole = 'admin' | 'publisher' | 'editor';

export type ReviewPolicy = {
  required: boolean;
  minApprovals: number;
  publishRoles: PublishRole[];
};

export type PageTypeListing = {
  source: 'content_items';
  defaultQuery: z.infer<typeof contentQuerySchema>;
  paginate: boolean;
};

export type PageTypeDefinition = {
  id: PageTypeId;
  routePattern: string;
  allowedSections: SectionType[] | 'any';
  requiredSections?: SectionType[];
  listing?: PageTypeListing;
  reviewPolicy: ReviewPolicy;
};

/** D§3.9: pages are review-required; one approval; humans with publish capability execute. */
const PAGE_REVIEW_POLICY: ReviewPolicy = {
  required: true,
  minApprovals: 1,
  publishRoles: ['admin', 'publisher'],
};

/**
 * The definitions, keyed by id. `listing` / `content_detail` are absent by
 * design until P6 — `getPageTypeDefinition` distinguishes "unknown id" from
 * "known but not yet implemented" so validators and editors can say which.
 */
export const pageTypeDefinitions: Partial<Record<PageTypeId, PageTypeDefinition>> = {
  home: {
    id: 'home',
    routePattern: '/',
    // The C§1.1 homepage record uses hero, checklist, content_grid, bio, and
    // a shared_ref to the newsletter section; the allowlist pins exactly that
    // family so a stray contact_form or product_preview on the homepage is a
    // validation failure, not a surprise.
    allowedSections: ['hero', 'checklist', 'content_grid', 'bio', 'newsletter_signup', 'shared_ref'],
    requiredSections: ['hero'],
    reviewPolicy: PAGE_REVIEW_POLICY,
  },
  standard: {
    id: 'standard',
    routePattern: '/[slug]',
    // The general-purpose type: any registered section may appear.
    allowedSections: 'any',
    reviewPolicy: PAGE_REVIEW_POLICY,
  },
  system: {
    id: 'system',
    routePattern: '/[system]', // 404, terms, privacy — fixed routes, prose-led
    allowedSections: ['hero', 'prose', 'link_list', 'cta_banner'],
    reviewPolicy: PAGE_REVIEW_POLICY,
  },
};

export type PageTypeLookup =
  | { ok: true; definition: PageTypeDefinition }
  | { ok: false; reason: 'unknown_page_type' | 'not_yet_implemented' };

export const getPageTypeDefinition = (id: string): PageTypeLookup => {
  const parsed = pageTypeIdSchema.safeParse(id);
  if (!parsed.success) return { ok: false, reason: 'unknown_page_type' };
  const definition = pageTypeDefinitions[parsed.data];
  return definition ? { ok: true, definition } : { ok: false, reason: 'not_yet_implemented' };
};

export const listPageTypeDefinitions = (): PageTypeDefinition[] =>
  Object.values(pageTypeDefinitions).filter((definition): definition is PageTypeDefinition => Boolean(definition));

/** Ids typed in the enum but not yet defined here (P6 scope) — surfaced by registry_get. */
export const unimplementedPageTypeIds = (): PageTypeId[] =>
  pageTypeIdSchema.options.filter((id) => !pageTypeDefinitions[id]);

/**
 * The JSON-schema rendering of the per-definition field constraints, for MCP
 * consumers that cannot execute zod (T3.1 verify criterion). Kept next to the
 * data so the two cannot drift: sections come from the same sectionTypeSchema
 * the validator uses.
 */
export const pageTypeDefinitionJsonSchema = () =>
  z.toJSONSchema(
    z
      .object({
        id: pageTypeIdSchema,
        routePattern: z.string().min(1),
        allowedSections: z.union([z.array(sectionTypeSchema), z.literal('any')]),
        requiredSections: z.array(sectionTypeSchema).optional(),
        listing: z
          .object({
            source: z.literal('content_items'),
            defaultQuery: contentQuerySchema,
            paginate: z.boolean(),
          })
          .strict()
          .optional(),
        reviewPolicy: z
          .object({
            required: z.boolean(),
            minApprovals: z.number().int().positive(),
            publishRoles: z.array(z.enum(['admin', 'publisher', 'editor'])),
          })
          .strict(),
      })
      .strict()
  );
