/**
 * Seed data for the S2 shop batch (06-shop-module-plan §4, 2026-07-12):
 * three MOCK products (Wolf, 2026-07-12: products/services content uses
 * mockup data) + the two shop page objects.
 *
 * Conventions:
 *
 *   - The three products deliberately cover all three commerce modes so the
 *     catalog exercises every price badge ("$19" / "Pay what you want" /
 *     "Free"). The fixed product carries a stripe_test MIRROR linkage with
 *     placeholder ids (shape-valid, not real Stripe objects): checkout
 *     against them fails at Stripe until real test products exist — the S1c
 *     exit test wires the real ones (launch gate). Its artifact_ref is
 *     Major-Key-shaped but no blob exists yet; delivery 404s gracefully.
 *   - `page_shop` (standard, route /shop) is served by the object-page
 *     catch-all — zero route code. Its grid is a `query` product_preview:
 *     every available product, so newly published products appear with no
 *     page edit (the design-principles litmus).
 *   - `page_product_detail` (content_detail) is the /shop/[slug] route-level
 *     SEO-defaults object, exactly like page_article: publishes with ZERO
 *     sections, so it declares a `drillProbe`.
 *   - Products are referenced by page_shop's grid only via `query`, so seed
 *     ordering is irrelevant (no manual refs to resolve).
 */

export const SEED_SITE = 'site_drlurie';

const PRODUCT_SEEDS = [
  {
    objectId: 'prod_barrier_repair_guide',
    body: {
      slug: 'barrier-repair-guide',
      presentation: {
        title: 'The Barrier Repair Guide',
        excerpt:
          'A practical, science-first plan for rebuilding a compromised skin barrier — routines, ingredients, and what to skip.',
        seo: { description: 'A downloadable, science-first guide to repairing your skin barrier after 60.' },
        notes: 'MOCK product (Wolf 2026-07-12): placeholder Stripe test linkage + artifact ref; replace before launch.',
      },
      commerce: {
        provider: 'stripe',
        mode: 'fixed',
        price: { amount_cents: 1900, currency: 'usd' },
        stripe_test: { product_id: 'prod_MockBarrier001', price_id: 'price_MockBarrier001' },
        availability: 'available',
      },
      fulfillment: {
        kind: 'download',
        artifact_ref: 'pdf/mockshop/0000000000000000000000000000000000000000000000000000000000000001.pdf',
        filename: 'barrier-repair-guide.pdf',
      },
    },
  },
  {
    objectId: 'prod_starter_checklist',
    body: {
      slug: 'starter-checklist',
      presentation: {
        title: 'The Skincare Starter Checklist',
        excerpt: 'A one-page checklist to audit your current routine — free to download.',
        seo: { description: 'A free one-page checklist for auditing your skincare routine.' },
        notes: 'MOCK product (Wolf 2026-07-12): free lead magnet; claim path lands with S3.',
      },
      commerce: { provider: 'none', mode: 'free', availability: 'available' },
      fulfillment: {
        kind: 'download',
        artifact_ref: 'pdf/mockshop/0000000000000000000000000000000000000000000000000000000000000002.pdf',
        filename: 'starter-checklist.pdf',
      },
    },
  },
  {
    objectId: 'prod_support_the_work',
    body: {
      slug: 'support-the-work',
      presentation: {
        title: 'Support the Work',
        excerpt: 'This education stays free and unsponsored. If it helped you, you can chip in whatever feels right.',
        seo: { description: 'Support independent, science-first skincare education.' },
        notes: 'MOCK product (Wolf 2026-07-12): PWYW tip; session path lands with S3.',
      },
      commerce: {
        provider: 'stripe',
        mode: 'pwyw',
        pwyw: { min_cents: 300, suggested_cents: 900 },
        stripe_test: { product_id: 'prod_MockTip001' },
        availability: 'available',
      },
      fulfillment: { kind: 'none' },
    },
  },
];

const PAGE_SEEDS = [
  {
    objectId: 'page_shop',
    body: {
      pageType: 'standard',
      route: '/shop',
      title: 'Shop',
      seo: { description: 'Guides, checklists, and ways to support science-first skincare education.' },
      sections: [
        {
          id: 's_shoplede',
          type: 'lede',
          data: {
            kicker: 'Shop',
            heading: 'Guides and resources',
            body: '<p>Everything here is built from the same research standards as the free library. Digital downloads arrive instantly.</p>',
            actions: [],
          },
        },
        {
          id: 's_shopgrid',
          type: 'product_preview',
          data: {
            heading: 'Available now',
            source: { kind: 'query', query: {} },
            limit: 6,
          },
        },
      ],
    },
  },
  {
    objectId: 'page_product_detail',
    body: {
      pageType: 'content_detail',
      route: '/shop/[slug]',
      title: 'Shop',
      seo: { description: 'Science-first skincare guides and resources from Dr. Lurié.' },
      sections: [],
    },
    // content_detail publishes with zero sections, so the drill clones a
    // PageType-legal probe instead of a page section (the page_article idiom).
    drillProbe: {
      type: 'cta_banner',
      data: {
        heading: 'Round-trip probe',
        body: '<p>Probe section (removed by the drill).</p>',
        actions: [],
      },
    },
  },
];

export const CONVERSION_SEEDS = [
  ...PRODUCT_SEEDS.map((seed) => ({ objectType: 'product', ...seed })),
  ...PAGE_SEEDS.map((seed) => ({ objectType: 'page', ...seed })),
];
