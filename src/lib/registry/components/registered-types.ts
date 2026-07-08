/**
 * The section types that have a bound Astro component (T3.2/T3.13/T4.2) — the
 * ones actually renderable on a page today. Kept in a standalone, client-safe
 * module (no `.astro` imports) so it can be consumed by the Netlify function
 * bundle: the object-contract serializer (to mark `component_bound`) and the
 * validation-context `componentTypeExists` resolver both read it, and neither
 * can import `index.ts` (which pulls the `.astro` components).
 *
 * `index.ts` types its `componentRegistry` as a TOTAL `Record` over this list,
 * so adding a binding without listing it here (or vice-versa) is a compile
 * error — the two cannot drift.
 */
import type { SectionType } from '../../../schema/bodies/section-v1.js';

export const REGISTERED_SECTION_TYPES = [
  'hero',
  'lede',
  'checklist',
  'content_grid',
  'bio',
  'newsletter_signup',
  'testimonial',
] as const satisfies readonly SectionType[];

export type RegisteredSectionType = (typeof REGISTERED_SECTION_TYPES)[number];

export const isRegisteredSectionType = (type: string): type is RegisteredSectionType =>
  (REGISTERED_SECTION_TYPES as readonly string[]).includes(type);
