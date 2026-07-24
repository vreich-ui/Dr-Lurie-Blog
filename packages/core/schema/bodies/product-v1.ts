/**
 * Product body schema — 'product.v1' (06-shop-module-plan §1).
 *
 * Digital goods only in v1 (downloads, pay-to-unlock, tips/PWYW). Three
 * concern blocks that change at different rates — presentation (editorial,
 * often), commerce (rarely, human-gated via the review-required approval
 * override), fulfillment (the polymorphic axis) — kept flat and common
 * because a tip and a download genuinely share them; only what the buyer
 * *gets* differs.
 *
 * Polymorphism lives in EXACTLY one place: the zod discriminated union on
 * `fulfillment.kind` (the house pattern — `content_grid.source`, NavTarget).
 * Physical goods later = one new union member (`kind: 'shipment'`) +
 * `commerce.provider: 'shopify'` as provenance; recurring later = a
 * `commerce.mode` addition. Nothing structural forbids either.
 *
 * Canonicality (§3): Stripe is canonical for charge amounts; `commerce.price`
 * is a DISPLAY CACHE the site renders while Checkout charges `price_id` — a
 * stale cache is a cosmetic bug, never a wrong charge. The cache/linkage are
 * deliberately NOT agent-patchable (see `set_product_fields` in
 * object-patch-ops.ts); the only price-edit path is the `product_set_price`
 * MCP tool (S3), which creates the new Stripe Price and writes linkage +
 * cache in one governed patch.
 *
 * Mode↔fields coherence (fixed needs price; pwyw needs the pwyw block; free
 * forbids Stripe linkage), slug shape/uniqueness, artifact-ref trust, and the
 * availability/publishability rules are validation-pipeline criteria
 * (netlify/lib/object-validate.ts), not this shape — same split as every
 * other body schema.
 */
import { z } from 'zod';
import { trackingAttributeShape } from './tracking-attribute-v1.js';

export const PRODUCT_SCHEMA_VERSION = 'product.v1';

export const productAvailabilities = ['available', 'coming_soon', 'retired'] as const;
export const productAvailabilitySchema = z.enum(productAvailabilities);
export type ProductAvailability = z.infer<typeof productAvailabilitySchema>;

export const productModes = ['fixed', 'pwyw', 'free'] as const;
export const productModeSchema = z.enum(productModes);
export type ProductMode = z.infer<typeof productModeSchema>;

// 'stripe' | 'none' (free products never touch Stripe); future: 'shopify'
// arrives with physical goods as provenance behind this seam (§1).
export const productProviders = ['stripe', 'none'] as const;
export const productProviderSchema = z.enum(productProviders);
export type ProductProvider = z.infer<typeof productProviderSchema>;

// Stripe ids are linkage, never secrets (§8.5) — safe in content. Shapes are
// pinned so a pasted key (sk_…/whsec_…) can never sit where an id belongs.
export const stripeProductIdSchema = z.string().regex(/^prod_[A-Za-z0-9]+$/, {
  message: 'Stripe product ids look like prod_…',
});
export const stripePriceIdSchema = z.string().regex(/^price_[A-Za-z0-9]+$/, {
  message: 'Stripe price ids look like price_…',
});

const stripeLinkageSchema = z
  .object({
    product_id: stripeProductIdSchema,
    price_id: stripePriceIdSchema.optional(), // absent for pwyw (§3: no Price object; the session function enforces min)
  })
  .strict();
export type StripeLinkage = z.infer<typeof stripeLinkageSchema>;

// DISPLAY CACHE of the charge amount (§3) — Stripe's Price is canonical.
const priceSchema = z
  .object({
    amount_cents: z.number().int().positive(),
    currency: z.string().regex(/^[a-z]{3}$/, { message: 'currency is a lowercase ISO code, e.g. "usd"' }),
  })
  .strict();
export type ProductPrice = z.infer<typeof priceSchema>;

const pwywSchema = z
  .object({
    min_cents: z.number().int().min(0),
    suggested_cents: z.number().int().positive().optional(),
  })
  .strict();
export type ProductPwyw = z.infer<typeof pwywSchema>;

// Product imagery is by URL (the bio-portrait pattern: `src`/`alt`, validated
// by the generic deploy-safety rules — trap 14 URL families are blocked;
// site-asset hosts pass). Not an *AssetRef: covers live on sanctioned public
// hosts, unlike fulfillment artifacts which live in the PRIVATE store.
const productImageSchema = z
  .object({
    src: z.string().min(1),
    alt: z.string().min(1),
  })
  .strict();
export type ProductImage = z.infer<typeof productImageSchema>;

export const productPresentationSchema = z
  .object({
    title: z.string().min(1),
    excerpt: z.string().optional(), // card copy on /shop
    images: z.array(productImageSchema).optional(),
    seo: z
      .object({
        description: z.string().optional(),
        ogImage: z.string().optional(),
      })
      .strict()
      .optional(),
    // OPTIONAL Page object carrying the long-form sections (§2): /shop/[slug]
    // renders buy box + hero from this record, then the referenced page's
    // sections through the standard ObjectSections path. Existence is
    // reference-integrity's job (T0.7); a product without one is a thin
    // card+buy-box page, and that's fine.
    page_ref: z.string().min(1).optional(),
    // Private working notes (never rendered; exempt from reader-safety).
    notes: z.string().optional(),
  })
  .strict();
export type ProductPresentation = z.infer<typeof productPresentationSchema>;

export const productCommerceSchema = z
  .object({
    provider: productProviderSchema,
    mode: productModeSchema,
    price: priceSchema.optional(), // fixed only (display cache, §3)
    pwyw: pwywSchema.optional(), // pwyw only
    stripe: stripeLinkageSchema.optional(), // fixed/pwyw linkage — never secrets
    // Test-mode mirror linkage until launch (§8.7): live price_ids don't work
    // in test-mode sessions, so the session function picks by STRIPE_MODE.
    // Dropped after launch. Clunky, known.
    stripe_test: stripeLinkageSchema.optional(),
    availability: productAvailabilitySchema,
  })
  .strict();
export type ProductCommerce = z.infer<typeof productCommerceSchema>;

// THE polymorphic axis — strict per-variant schemas so a fulfillment can
// never be half-filled (§1).
export const productFulfillmentSchema = z.discriminatedUnion('kind', [
  // A file in the PRIVATE artifacts store, delivered by expiring signed token
  // (§5). `artifact_ref` is a Major-Key artifact ref ({image|pdf}/{id}/
  // {sha256}.{ext}) — trust/resolution is a validation criterion.
  z
    .object({
      kind: z.literal('download'),
      artifact_ref: z.string().min(1),
      filename: z.string().min(1),
    })
    .strict(),
  // Pay-to-unlock inverts timing (§5): the artifact is generated BEFORE
  // payment (at quiz/result creation), keyed under this prefix in the private
  // store; payment only flips retrieval. Per-buyer artifacts, so the product
  // names the key PREFIX, not a single blob.
  z
    .object({
      kind: z.literal('unlock'),
      unlock_prefix: z.string().min(1),
    })
    .strict(),
  // Nothing to deliver — tips/PWYW support ride the same order/event
  // machinery with no fulfillment payload.
  z
    .object({
      kind: z.literal('none'),
    })
    .strict(),
]);
export type ProductFulfillment = z.infer<typeof productFulfillmentSchema>;
export type ProductFulfillmentKind = ProductFulfillment['kind'];

export const productBodySchema = z
  .object({
    // W13: shared tracking attribute (12-plan §2) — set_tracking is its one writer.
    ...trackingAttributeShape,
    slug: z.string().min(1), // /shop/<slug>; shape + uniqueness are validation criteria (isProductSlugTaken)
    presentation: productPresentationSchema,
    commerce: productCommerceSchema,
    fulfillment: productFulfillmentSchema,
  })
  .strict();
export type ProductBody = z.infer<typeof productBodySchema>;
