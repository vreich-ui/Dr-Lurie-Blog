/**
 * Recipe metadata — the shared self-description block every recipe body
 * carries (W8.3b, 09-template-system-plan §W8.3b; Wolf, 2026-07-14: "agents
 * or humans need to be able to explain what it is, whether it is for a
 * project that is one off or it has a strategy").
 *
 * One shape, three consumers (template.v1 / section_template.v1 / theme.v1 —
 * the brandTokensSchema sharing precedent), so the family cannot drift. All
 * fields are schema-OPTIONAL — pre-W8.3b records keep parsing — but REQUIRED
 * TO PUBLISH (the `recipe_metadata` validation criterion: warns while
 * drafting, blocks publish). Editable through each type's existing meta/
 * fields op; never rendered.
 *
 * These fields are the reuse-first index (AI-cost lever): object_inventory
 * surfaces them as one-line recipe summaries so an agent answers "does a
 * recipe already exist for this?" from one cheap call instead of fetching
 * bodies — write them for THAT reader.
 */
import { z } from 'zod';

/**
 * 'evergreen' = a standing recipe with a strategy behind it — part of the
 * site's ongoing design system; the default to reach for.
 * 'one_off' = built for a single project/campaign — reusable mechanically,
 * but not a default, and safe to archive when its project ends.
 */
export const recipeScopeSchema = z.enum(['evergreen', 'one_off']);
export type RecipeScope = z.infer<typeof recipeScopeSchema>;

/** Spread into every recipe body schema. No min(1): emptiness is the
 *  validation criterion's job (empty-after-trim counts as missing), not a
 *  parse failure — keeps the additive guarantee clean. */
export const recipeMetadataShape = {
  /** What this recipe IS (agent-facing; never rendered). */
  description: z.string().optional(),
  /** When to pick it over sibling recipes — use cases, not a restatement. */
  whenToUse: z.string().optional(),
  scope: recipeScopeSchema.optional(),
};
