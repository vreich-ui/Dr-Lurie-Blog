/**
 * Section-template body schema — 'section_template.v1' (W8,
 * 09-template-system-plan §2).
 *
 * The section-level member of the recipe family (design-principles rule 5):
 * a named, pre-configured section blueprint an agent stamps into any page (as
 * one upsert_section under the caller's lock) or mints as a standalone shared
 * section — via the instantiate verb (W8.2). Data-not-code: agents create and
 * evolve recipes freely with the section_template patch ops; nothing ever
 * live-binds to one, and a recipe renders nothing itself.
 *
 * The blueprint is a full SectionInstance — the same discriminated union pages
 * embed, so there is no parallel shape to drift (and a future composite
 * section type becomes blueprint-able with zero changes here). Its s_* id is a
 * placeholder, ALWAYS re-minted at instantiation (the template.v1
 * slot-blueprint precedent). Blueprint-type placeability (component-bound; no
 * `card` leaf, no `shared_ref` pointer) is a validation-pipeline check
 * (checkSectionTemplate), not a shape rule here.
 */
import { z } from 'zod';

import { sectionInstanceSchema } from './section-v1.js';

export const SECTION_TEMPLATE_SCHEMA_VERSION = 'section_template.v1';

export const sectionTemplateBodySchema = z
  .object({
    name: z.string().min(1),
    // Agent-facing purpose note ("campaign hero with kicker + two CTAs");
    // never rendered.
    description: z.string().optional(),
    blueprint: sectionInstanceSchema,
  })
  .strict();
export type SectionTemplateBody = z.infer<typeof sectionTemplateBodySchema>;
