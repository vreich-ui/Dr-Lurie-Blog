/**
 * Taxonomy body schema — 'taxonomy.v1' (D§3.7).
 *
 * One registry object per site, replacing the two disconnected de-facto
 * sources (free-string frontmatter and the blob-draft aggregation — A§2.6,
 * A§2.11). `term_id` is opaque and stable so slugs/labels can be renamed
 * safely; `merged_into` is the rename/merge alias mechanism that keeps
 * published frontmatter resolving (D§5.5).
 *
 * Registry-level safety rules — slug shape and per-kind uniqueness,
 * merged_into targets existing/active/acyclic, deprecation-with-live-usage
 * requiring merged_into, and the slug-rename auto-alias rule (C§2.3-taxonomy)
 * — are enforced by the validation pipeline (T0.7) and the patch grammar
 * (T0.6), not by this shape.
 */
import { z } from 'zod';
import { trackingAttributeShape } from './tracking-attribute-v1.js';

export const TAXONOMY_SCHEMA_VERSION = 'taxonomy.v1';

export const termIdSchema = z.string().regex(/^t_[a-z0-9]+$/, {
  message: 'Term ids must match t_<lowercase alphanumerics>',
});

export const termSchema = z
  .object({
    term_id: termIdSchema, // opaque, stable (D§3.7)
    slug: z.string().min(1), // unique per kind; used in routes/frontmatter (A§2.6)
    label: z.string().min(1),
    description: z.string().optional(),
    status: z.enum(['active', 'deprecated']),
    merged_into: termIdSchema.optional(), // rename/merge without breaking published frontmatter
  })
  .strict();
export type Term = z.infer<typeof termSchema>;

export const taxonomyKindSchema = z.enum(['category', 'tag']);
export type TaxonomyKind = z.infer<typeof taxonomyKindSchema>;

export const taxonomyBodySchema = z
  .object({
    // W13: shared tracking attribute (12-plan §2) — set_tracking is its one writer.
    ...trackingAttributeShape,
    kinds: z
      .object({
        category: z.object({ terms: z.array(termSchema) }).strict(),
        tag: z.object({ terms: z.array(termSchema) }).strict(),
      })
      .strict(),
  })
  .strict();
export type TaxonomyBody = z.infer<typeof taxonomyBodySchema>;
