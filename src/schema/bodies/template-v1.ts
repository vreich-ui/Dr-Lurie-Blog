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
import { sectionInstanceSchema, sectionTypeSchema } from './section-v1.js';

export const TEMPLATE_SCHEMA_VERSION = 'template.v1';

export const templateSlotSchema = z
  .object({
    slotId: z.string().min(1),
    allowed: z.array(sectionTypeSchema),
    required: z.boolean(),
    repeatable: z.boolean(),
    // Default section: registry editor.defaultData, customized (D§3.6).
    blueprint: sectionInstanceSchema.optional(),
  })
  .strict();
export type TemplateSlot = z.infer<typeof templateSlotSchema>;

export const templateBodySchema = z
  .object({
    name: z.string().min(1),
    appliesTo: z.array(pageTypeIdSchema),
    slots: z.array(templateSlotSchema),
  })
  .strict();
export type TemplateBody = z.infer<typeof templateBodySchema>;
