/**
 * Template body schema — 'template.v1' (D§3.6).
 *
 * Data-not-code, following blobs-are-truth. Instantiation copies slot
 * blueprints into the Page (provenance kept in `page.template`); Pages do NOT
 * live-inherit from Templates — matching how articles never live-inherit from
 * input-bank templates (D§3.6 Δ note).
 *
 * Slot-level guarantees (allowed types exist in the component registry,
 * blueprints validate against their type, appliesTo PageTypes exist, no
 * required slot without a blueprint — C§2.3-template) are validation-pipeline
 * checks (T0.7).
 */
import { z } from 'zod';

import { pageTypeIdSchema } from './page-v1.js';
import { recipeMetadataShape } from './recipe-metadata-v1.js';
import { sectionInstanceSchema, sectionTypeSchema } from './section-v1.js';
import { trackingAttributeShape } from './tracking-attribute-v1.js';

export const TEMPLATE_SCHEMA_VERSION = 'template.v1';

export const templateSlotSchema = z
  .object({
    slotId: z.string().min(1),
    allowed: z.array(sectionTypeSchema),
    required: z.boolean(),
    repeatable: z.boolean(),
    // Default section: registry editor.defaultData, customized (D§3.6).
    blueprint: sectionInstanceSchema.optional(),
    // OR a section_template reference (stpl_* id, W8.2 — 09-plan §4):
    // dereferenced and DEEP-COPIED at instantiation only, never live-bound —
    // editing the recipe changes future instantiations, nothing existing.
    // Resolution + type-in-allowed are validation-pipeline checks.
    blueprintRef: z.string().min(1).optional(),
  })
  .strict()
  .refine((slot) => !(slot.blueprint && slot.blueprintRef), {
    message: 'A slot carries either an inline blueprint or a blueprintRef, not both.',
  });
export type TemplateSlot = z.infer<typeof templateSlotSchema>;

export const templateBodySchema = z
  .object({
    // W13: shared tracking attribute (12-plan §2) — set_tracking is its one writer.
    ...trackingAttributeShape,
    name: z.string().min(1),
    // Self-description (W8.3b): schema-optional, required to publish.
    ...recipeMetadataShape,
    appliesTo: z.array(pageTypeIdSchema),
    slots: z.array(templateSlotSchema),
  })
  .strict();
export type TemplateBody = z.infer<typeof templateBodySchema>;
