/**
 * Section instances + the shared-section wrapper — 'section.v1' (D§3.5, D§2.5).
 *
 * Sections are a strict discriminated union on `type` — deliberately NOT the
 * article node's combinatorial pattern (audit fork #1, D§2.5). Growth = one
 * new union member + one component-registry module; this file owns only the
 * data shapes.
 *
 * Two flavors (D§2.5): inline instances embedded in a Page body, and shared
 * sections stored as their own 'section' object (body = the wrapper at the
 * bottom of this file) referenced via the `shared_ref` union member.
 * `shared_ref` carries ONLY the target's ObjectId — never a shadow copy of the
 * target's type or data; the Renderer (and admin preview) dereference it to
 * the target's current variant before validation and render dispatch.
 *
 * Transitional variant (04-phased-plan P3): `content_grid` accepts
 * `source: {kind: 'static', cards: [...]}` so the P3 homepage cutover can
 * render the audited placeholder copy byte-identically. Deprecated-on-arrival;
 * retired by the post-cutover switch task.
 *
 * M-8 (content_grid manual-primary + query fallback) landed at T3.3: the
 * manual source carries an optional `fallback` query; resolution semantics
 * live in src/lib/renderer/resolve-content-grid.ts.
 *
 * Reference integrity (shared_ref targets exist and are sections, manual grid
 * items resolve, query terms exist — C§2.0/C§2.3) is the validation pipeline's
 * job (T0.7), not this schema's.
 */
import { z } from 'zod';

import { linkActionSchema, navTargetSchema, richTextSchema } from './navigation-v1.js';

export const SECTION_SCHEMA_VERSION = 'section.v1';

// Opaque like n_* node ids (A§1.1), stable across edits (D§3.5).
export const sectionInstanceIdSchema = z.string().regex(/^s_[a-z0-9]+$/, {
  message: 'Section ids must match s_<lowercase alphanumerics>',
});

// Minimally pinned: the docs reference ContentQuery (D§3.4/D§3.5) without a
// field-level definition; this captures the audited listing pattern's filter
// axes (category/tag terms — A§2.5–2.6). Term resolution against the taxonomy
// registry is T0.7/T3.3 territory; refine there, not here.
export const contentQuerySchema = z
  .object({
    category: z.string().optional(), // taxonomy term_id
    tags: z.array(z.string()).optional(), // taxonomy term_ids
    sort: z.enum(['published_time_desc', 'published_time_asc']).optional(),
  })
  .strict();
export type ContentQuery = z.infer<typeof contentQuerySchema>;

// Minimally pinned: D§3.5 references ProductCard (shop-preview page, A§2.9)
// without a field-level definition; refine when the P4 shop-preview migration
// lands.
export const productCardSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().optional(),
    imageAssetRef: z.string().optional(),
    action: linkActionSchema.optional(),
  })
  .strict();
export type ProductCard = z.infer<typeof productCardSchema>;

const sectionVariant = <TType extends string, TData extends z.ZodRawShape>(type: TType, data: TData) =>
  z
    .object({
      id: sectionInstanceIdSchema,
      // Subset of node visibility (A§1.1); 'internal' dropped deliberately (D§3.5).
      visibility: z.enum(['public', 'hidden']).optional(),
      notes: z.string().optional(), // editor/agent notes; never rendered (assert-reader-safe)
      type: z.literal(type),
      data: z.object(data).strict(),
    })
    .strict();

export const contentGridSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('query'), query: contentQuerySchema }).strict(),
  // M-8 (settled S-1, applied at T3.3): manual-primary with optional query
  // fallback. Resolution order (src/lib/renderer/resolve-content-grid.ts):
  // manual refs first — each MUST resolve to a published content item — then
  // fallback-query backfill up to `limit`, de-duplicated against the manual
  // picks. An empty manual list with a fallback is pure-fallback by design.
  z
    .object({
      kind: z.literal('manual'),
      items: z.array(z.string().min(1)),
      fallback: z
        .object({ kind: z.literal('query'), query: contentQuerySchema })
        .strict()
        .optional(),
    })
    .strict(),
  // Transitional (P3 cutover): renders placeholder copy verbatim; deprecated-on-arrival.
  z
    .object({
      kind: z.literal('static'),
      cards: z.array(z.object({ title: z.string().min(1), description: z.string() }).strict()),
    })
    .strict(),
]);
export type ContentGridSource = z.infer<typeof contentGridSourceSchema>;

export const sectionInstanceSchema = z.discriminatedUnion('type', [
  sectionVariant('hero', {
    kicker: z.string().optional(),
    heading: z.string().min(1),
    body: richTextSchema.optional(),
    actions: z.array(linkActionSchema),
  }),
  sectionVariant('prose', {
    body: richTextSchema,
  }),
  // Interior-page lede (T4.2): the kicker + h1 + intro + actions block the
  // audited standalone pages open with (start-here, newsletter, member-updates,
  // free-guide, early-access — A§2.x). Same field shape as `hero` but a
  // distinct, lighter presentation (interior pages, not the landing hero), so
  // it is its own type with its own component (Lede.astro), not a hero variant.
  sectionVariant('lede', {
    kicker: z.string().optional(),
    heading: z.string().min(1),
    body: richTextSchema.optional(),
    actions: z.array(linkActionSchema),
    anchor: z.string().optional(),
  }),
  // "This is for you if…" (A§2.1)
  // M-9 (T3.2, 2026-07-06): optional `kicker` (the small uppercase lead-in
  // line every audited homepage section renders) and `anchor` (the public
  // DOM id, e.g. "audience" — content, not layout: it is URL-addressable)
  // added to the four homepage variants. Without them the C§1.1 record
  // cannot reproduce the audited markup and the T3.6 byte-identical
  // cutover gate is unreachable. All additive-optional; no records of
  // these types exist in production yet.
  sectionVariant('checklist', {
    kicker: z.string().optional(),
    heading: z.string().optional(),
    items: z.array(z.string()),
    anchor: z.string().optional(),
  }),
  sectionVariant('bio', {
    kicker: z.string().optional(),
    heading: z.string().min(1),
    portraitAssetRef: z.string().optional(),
    body: richTextSchema,
    trustNotes: z.array(z.string()),
    // M-9: the audited "Educational content only. Not medical advice." line.
    disclaimer: z.string().optional(),
    anchor: z.string().optional(),
  }),
  // Replaces the placeholder grid (A§2.1).
  sectionVariant('content_grid', {
    kicker: z.string().optional(),
    heading: z.string().optional(),
    // M-9: the audited intro paragraph under the grid heading.
    body: richTextSchema.optional(),
    source: contentGridSourceSchema,
    limit: z.number().int().positive(),
    anchor: z.string().optional(),
  }),
  sectionVariant('newsletter_signup', {
    kicker: z.string().optional(),
    heading: z.string().min(1),
    body: richTextSchema.optional(),
    formName: z.string().min(1),
    consentText: z.string().optional(),
    anchor: z.string().optional(),
  }),
  sectionVariant('contact_form', {
    formName: z.string().min(1),
    heading: z.string().min(1),
    disclaimer: z.string().optional(),
  }),
  // The full /contact page (faithful cutover, A§2.x): a widget-composition page
  // reproduced as one bespoke section. Every widget prop the route file hard-coded
  // (hero tagline/title, the Netlify form's fields + copy, the "how we can help"
  // feature items) is promoted to editable object data; ContactPage.astro
  // re-invokes HeroText/Contact/Features2 with it. No link actions → empty resolved.
  sectionVariant('contact', {
    hero: z.object({ tagline: z.string().min(1), title: z.string().min(1) }).strict(),
    form: z
      .object({
        id: z.string().min(1),
        formName: z.string().min(1),
        title: z.string().min(1),
        subtitle: z.string().min(1),
        inputs: z.array(
          z.object({ type: z.string().min(1), name: z.string().min(1), label: z.string().min(1) }).strict()
        ),
        textarea: z.object({ label: z.string().min(1) }).strict(),
        disclaimer: z.object({ label: z.string().min(1) }).strict(),
        description: z.string().min(1),
      })
      .strict(),
    features: z
      .object({
        title: z.string().min(1),
        items: z.array(
          z.object({ title: z.string().min(1), description: z.string().min(1), icon: z.string().min(1) }).strict()
        ),
      })
      .strict(),
  }),
  sectionVariant('cta_banner', {
    heading: z.string().optional(),
    body: richTextSchema.optional(),
    actions: z.array(linkActionSchema),
  }),
  sectionVariant('faq', {
    heading: z.string().optional(),
    items: z.array(z.object({ q: z.string().min(1), a: richTextSchema }).strict()),
  }),
  sectionVariant('link_list', {
    heading: z.string().optional(),
    links: z.array(linkActionSchema),
  }),
  // Shop-preview page (A§2.9).
  sectionVariant('product_preview', {
    heading: z.string().min(1),
    products: z.array(productCardSchema),
  }),
  // T3.13 extensibility drill: a reader/expert quote grid. No audited markup
  // on the live site — this exists to prove a NEW section type is insertable
  // through the registry pattern (one union member + one module + one
  // component + one binding); see src/lib/registry/components/testimonial.ts.
  sectionVariant('testimonial', {
    kicker: z.string().optional(),
    heading: z.string().optional(),
    quotes: z.array(z.object({ quote: z.string().min(1), attribution: z.string().optional() }).strict()),
    anchor: z.string().optional(),
  }),
  // Extracts the hardcoded Header search overlay (A§2.8).
  sectionVariant('search', {
    placeholder: z.string().optional(),
    indexRoute: z.string().min(1),
  }),
  // Explicit bridge to the article grammar (D§2.5 tradeoff).
  sectionVariant('content_embed', {
    contentItem: z.string().min(1),
  }),
  // The full /about page (faithful cutover, A§2.x): a bespoke single-use section
  // whose prose blocks are fixed component furniture (inline emphasis can't
  // round-trip as clean data), exposing only the clean fields — the page
  // heading, the six body-section headings (paired positionally with their fixed
  // prose), the portrait image, and the closing CTA. `actions` resolve to hrefs
  // the same way hero/thank_you actions do.
  sectionVariant('about', {
    heading: z.string().min(1),
    portrait: z.object({ src: z.string().min(1), alt: z.string().min(1) }).strict(),
    sectionHeadings: z.array(z.string().min(1)).length(6),
    ctaHeading: z.string().min(1),
    actions: z.array(linkActionSchema),
  }),
  // Form-submission confirmation (the /thank-you page, A§2.x): a centered
  // eyebrow + fallback title/message, plus per-form overrides the client script
  // swaps in from the `?form=` query param. Copy is data; the message-swap
  // furniture is owned by the component.
  sectionVariant('thank_you', {
    eyebrow: z.string().optional(),
    heading: z.string().min(1),
    message: z.string().min(1),
    formMessages: z.array(
      z.object({ form: z.string().min(1), heading: z.string().min(1), message: z.string().min(1) }).strict()
    ),
    actions: z.array(linkActionSchema),
  }),
  // A single content cell — the reusable LEAF a container block (e.g.
  // `content_grid`) holds as a child block (docs/cms-architecture/block-tree.md).
  // Not tied to one page: the same `card` composes any grid, row, or strip.
  sectionVariant('card', {
    title: z.string().min(1),
    description: z.string().optional(),
    link: linkActionSchema.optional(),
  }),
  // Reference to a shared 'section' object — no shadow copy of the target's
  // type/data (D§3.5).
  sectionVariant('shared_ref', {
    section: z.string().min(1),
  }),
]);
export type SectionInstance = z.infer<typeof sectionInstanceSchema>;

export const sectionTypes = sectionInstanceSchema.options.map((option) => option.shape.type.value);
export const sectionTypeSchema = z.enum(sectionTypes as [SectionInstance['type'], ...SectionInstance['type'][]]);
export type SectionType = SectionInstance['type'];

// The shared-section wrapper: body of a standalone 'section' object (D§2.5).
// Wraps exactly one instance; whether a shared section may itself be a
// shared_ref (reference chains) is policed by reference-integrity validation
// (T0.7), not by this shape.
export const sectionBodySchema = z
  .object({
    section: sectionInstanceSchema,
  })
  .strict();
export type SectionBody = z.infer<typeof sectionBodySchema>;

export { linkActionSchema, navTargetSchema, richTextSchema };
export type { LinkAction, NavTarget, RichText } from './navigation-v1.js';
