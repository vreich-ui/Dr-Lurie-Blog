import { z, defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

const metadataDefinition = () =>
  z
    .object({
      title: z.string().optional(),
      ignoreTitleTemplate: z.boolean().optional(),

      canonical: z.string().url().optional(),

      robots: z
        .object({
          index: z.boolean().optional(),
          follow: z.boolean().optional(),
        })
        .optional(),

      description: z.string().optional(),

      openGraph: z
        .object({
          url: z.string().optional(),
          siteName: z.string().optional(),
          images: z
            .array(
              z.object({
                url: z.string(),
                width: z.number().optional(),
                height: z.number().optional(),
              })
            )
            .optional(),
          locale: z.string().optional(),
          type: z.string().optional(),
        })
        .optional(),

      twitter: z
        .object({
          handle: z.string().optional(),
          site: z.string().optional(),
          cardType: z.string().optional(),
        })
        .optional(),
    })
    .optional();

const postCollection = defineCollection({
  loader: glob({ pattern: ['*.md', '*.mdx'], base: 'src/data/post' }),
  schema: z.object({
    publishDate: z.date().optional(),
    published_time: z.date().nullable().optional(),
    updateDate: z.date().optional(),
    draft: z.boolean().optional(),

    title: z.string(),
    excerpt: z.string().optional(),
    image: z.string().optional(),
    video: z.string().url().optional(),
    ctaLink: z.string().optional(),
    ctaText: z.string().optional(),

    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
    author: z.string().optional(),

    metadata: metadataDefinition(),
  }),
});

// ─── CMS object collections (T1.7 — inert loader plumbing) ───────────────────
//
// Content collections over the derived-export layout (D§1): one collection per
// object type that materializes a committed file. They exist NOW so Phase 3 can
// build the first real page from a published Page object without also standing
// up the loader plumbing in the same task. Nothing consumes these this phase —
// no page or route references them; empty dirs = empty collections, build
// unaffected (the .gitkeep files hold the otherwise-empty glob bases).
//
// Schema note: these deliberately DO NOT import the T0.2 body schemas
// (src/schema/bodies/*). Those are zod v4 (the project's zod), while
// `astro:content`'s `z` is Astro's bundled zod v3 — passing a v4 schema to
// defineCollection would not validate correctly. The derived exports are
// already validated against the T0.2 schemas at write time (T0.7); here we
// only assert the T1.1 `__generated` marker every export carries and pass the
// body through. Modeling the full bodies in a second (v3) copy would recreate
// exactly the multi-source drift the CMS project exists to remove.

const generatedMarker = z.object({
  from: z.string(),
  at: z.string(),
  record_version: z.number(),
});

// The shape every derived JSON export carries: the marker plus the body fields.
const derivedExportSchema = z.object({ __generated: generatedMarker }).passthrough();

// Singletons live directly under src/data/site/ (one per site); the rest are
// one-file-per-object directories. Specific filenames for the singletons keep
// the singleton globs from also matching the per-type directories' contents.
const siteObjectCollection = defineCollection({
  loader: glob({ pattern: 'site.json', base: 'src/data/site' }),
  schema: derivedExportSchema,
});

const taxonomyObjectCollection = defineCollection({
  loader: glob({ pattern: 'taxonomy.json', base: 'src/data/site' }),
  schema: derivedExportSchema,
});

const pageObjectCollection = defineCollection({
  loader: glob({ pattern: '*.json', base: 'src/data/site/pages' }),
  schema: derivedExportSchema,
});

const navigationObjectCollection = defineCollection({
  loader: glob({ pattern: '*.json', base: 'src/data/site/navigation' }),
  schema: derivedExportSchema,
});

const sectionObjectCollection = defineCollection({
  loader: glob({ pattern: '*.json', base: 'src/data/site/sections' }),
  schema: derivedExportSchema,
});

const templateObjectCollection = defineCollection({
  loader: glob({ pattern: '*.json', base: 'src/data/site/templates' }),
  schema: derivedExportSchema,
});

const productObjectCollection = defineCollection({
  // generateId pins the entry id to the FILENAME (= object id). The glob
  // loader's default prefers a top-level `slug` field when the data has one —
  // and product bodies do (/shop/<slug>) — which silently made entry.id the
  // slug, breaking every by-object-id lookup (pricing_table tiers, manual
  // product_preview picks, the buy-box product_id the checkout functions
  // resolve in the store). Every other object collection has no `slug` field,
  // so their ids were already the filename.
  loader: glob({
    pattern: '*.json',
    base: 'src/data/site/products',
    generateId: ({ entry }) => entry.replace(/\.json$/, ''),
  }),
  schema: derivedExportSchema,
});

// Exported so Phase 3+ consumers (and tests) share one derived-export shape.
export type DerivedExport = z.infer<typeof derivedExportSchema>;

export const collections = {
  post: postCollection,
  siteObject: siteObjectCollection,
  taxonomyObject: taxonomyObjectCollection,
  pageObject: pageObjectCollection,
  navigationObject: navigationObjectCollection,
  sectionObject: sectionObjectCollection,
  templateObject: templateObjectCollection,
  productObject: productObjectCollection,
};
