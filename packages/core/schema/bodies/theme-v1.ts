/**
 * Theme body schema — 'theme.v1' (W8.3, 09-template-system-plan §6).
 *
 * The site-level member of the recipe family (design-principles rule 5): a
 * named preset for `site.brandTokens` — color + font token VALUES an agent
 * drafts, validates, and applies to the site singleton via `site_apply_theme`
 * (exact-replace semantics: stale keys unset). Applied by COPY: nothing
 * resolves against a theme, and the site never live-inherits from it — after
 * an apply, the theme could be deleted with zero effect on the live site.
 * A theme is NOT taxonomy (no term semantics, no merged_into).
 *
 * `tokens` reuses siteBodySchema's own brandTokensSchema so the two shapes
 * cannot drift. Key completeness (the CustomStyles-consumed key list) and
 * CSS-value safety are validation-pipeline checks against the
 * src/lib/registry/theme-tokens.ts registry, not shape rules here.
 */
import { z } from 'zod';

import { recipeMetadataShape } from './recipe-metadata-v1.js';
import { brandTokensSchema } from './site-v1.js';
import { trackingAttributeShape } from './tracking-attribute-v1.js';

export const THEME_SCHEMA_VERSION = 'theme.v1';

export const themeBodySchema = z
  .object({
    // W13: shared tracking attribute (12-plan §2) — set_tracking is its one writer.
    ...trackingAttributeShape,
    name: z.string().min(1),
    // Self-description (W8.3b): schema-optional, required to publish.
    ...recipeMetadataShape,
    tokens: brandTokensSchema,
  })
  .strict();
export type ThemeBody = z.infer<typeof themeBodySchema>;
