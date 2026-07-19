/**
 * Site body schema — 'site.v1' (D§3.2).
 *
 * Net-new object type: the blob-object → derived-export → build-time-injection
 * pattern applied to configuration. Replaces config.yaml site/metadata/blog
 * blocks (A§2.10), the Logo.astro hardcode and CustomStyles.astro literals
 * (A§2.13), and ad-hoc Header props (A§2.2). `defaultNavigation` is the ONLY
 * place default menus bind (D§5.4 consolidation); per-page variation goes
 * through page.navigationOverrides, never code.
 *
 * Referenced ObjectIds (navigation instances, announcement sectionRef) are
 * resolved by reference-integrity validation (T0.7), not this shape.
 */
import { z } from 'zod';

import { THEME_AXES } from '../../lib/registry/theme-tokens.js';

export const SITE_SCHEMA_VERSION = 'site.v1';

// Shared with theme.v1 (W8.3): a theme is a preset FOR this exact shape, so
// the two cannot drift. Colors are keyed by CSS var name minus `--aw-color-`
// (`dark:`-prefixed keys carry the .dark overrides); the consumed key list
// lives in src/lib/registry/theme-tokens.ts.
//
// T10.1: the layout/shape/type axis objects are additive-optional bounded
// enums (11-platformization-plan §1.1). The allowed values come from the
// THEME_AXES registry — the SAME module the renderer's var mappings live in —
// so schema and render cannot drift. An absent axis (or group) means "the
// default look"; no axis value ever carries CSS.
export const brandTokensSchema = z
  .object({
    colors: z.record(z.string(), z.string()),
    fonts: z
      .object({
        sans: z.string(),
        serif: z.string(),
        heading: z.string(),
      })
      .strict(),
    layout: z
      .object({
        containerWidth: z.enum(THEME_AXES.layout.containerWidth.values).optional(),
        sectionRhythm: z.enum(THEME_AXES.layout.sectionRhythm.values).optional(),
      })
      .strict()
      .optional(),
    shape: z
      .object({
        radius: z.enum(THEME_AXES.shape.radius.values).optional(),
        buttonShape: z.enum(THEME_AXES.shape.buttonShape.values).optional(),
        shadow: z.enum(THEME_AXES.shape.shadow.values).optional(),
      })
      .strict()
      .optional(),
    type: z
      .object({
        scale: z.enum(THEME_AXES.type.scale.values).optional(),
        headingWeight: z.enum(THEME_AXES.type.headingWeight.values).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type BrandTokens = z.infer<typeof brandTokensSchema>;

export const siteBodySchema = z
  .object({
    name: z.string().min(1),
    logo: z
      .object({
        text: z.string(),
        imageAssetRef: z.string().optional(),
      })
      .strict(),
    urls: z
      .object({
        base: z.string().min(1),
        canonicalHost: z.string().min(1),
      })
      .strict(),
    metadataDefaults: z
      .object({
        titleTemplate: z.string(),
        description: z.string(),
        ogImage: z.string(),
        twitterHandle: z.string().optional(),
      })
      .strict(),
    brandTokens: brandTokensSchema,
    chrome: z
      .object({
        showRssFeed: z.boolean(),
        showThemeToggle: z.boolean(),
        announcement: z
          .object({
            enabled: z.boolean(),
            sectionRef: z.string().min(1).optional(), // shared section ObjectId
          })
          .strict()
          .optional(),
      })
      .strict(),
    defaultNavigation: z
      .object({
        header: z.string().min(1), // navigation ObjectIds
        footer: z.string().min(1),
        secondary: z.string().min(1).optional(),
        social: z.string().min(1).optional(),
      })
      .strict(),
    blog: z
      .object({
        listPath: z.string().min(1),
        postsPerPage: z.number().int().positive(),
        categoryBase: z.string(),
        tagBase: z.string(),
      })
      .strict(),
  })
  .strict();
export type SiteBody = z.infer<typeof siteBodySchema>;
