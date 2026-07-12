/**
 * Seed data for the W5 hand-coded-page conversions (06-shop-module-plan §4,
 * "after S2/S3"; 2026-07-12): the last three hand-coded routes become page
 * objects served by the object-page catch-all — their route files are
 * DELETED in the same change (importers verified: none).
 *
 *   - `page_shop_preview` — /solutions/shop-preview: the REAL audited copy,
 *     verbatim, recomposed as one `content_split` (the bespoke shop-hero
 *     markup generalized; its scoped styles moved into the component). The
 *     nav's route-kind links keep working — same route, object-served.
 *     Post-launch this repoints to /shop with one op (the plan's point).
 *   - `page_pricing` — /pricing: previously Astrowind lorem (unlinked, audit
 *     A§2.13). MOCK copy per Wolf's 2026-07-12 directive. Its `pricing_table`
 *     tiers REFERENCE the three mock products — price + availability resolve
 *     from commerce data at build (no copy drift; repointable).
 *   - `page_services` — /services: also lorem before; MOCK copy. Composed
 *     from content_split + content_grid `cards` (the icon feature grid —
 *     feature_grid was deliberately NOT minted: content_grid cards already
 *     covers icon+title+description grids, design-principles rule 1) +
 *     cta_banner.
 *
 * The S2 product seeds are PREPENDED as reference targets (playbook trap 3:
 * every referenced object before its referrer — pricing_table tiers reference
 * the products, and reference integrity blocks at WRITE on the create path).
 * They are imported from the shop module, not copied, so the catalog has one
 * source of truth; re-driving them is idempotent (drills end byte-identical,
 * publish stops at the §0.4 approval gate as the expected terminal).
 */
import { CONVERSION_SEEDS as SHOP_SEEDS } from './pages-shop-seed-data.mjs';

export const SEED_SITE = 'site_drlurie';

const PRODUCT_SEEDS = SHOP_SEEDS.filter((seed) => seed.objectType === 'product');

const PAGE_SEEDS = [
  {
    objectId: 'page_shop_preview',
    body: {
      pageType: 'standard',
      route: '/solutions/shop-preview',
      title: 'Shop Preview',
      seo: {
        description:
          'Preview the age-aware skincare direction from Dr. Lurié and join early access for product updates.',
        ogImage: 'https://kugelmedia.netlify.app/drlurieblog/dr-lurie-shop-social-preview.jpg',
      },
      sections: [
        {
          id: 's_shopsplit',
          type: 'content_split',
          data: {
            kicker: 'Aging skin needs focused care.',
            heading: 'Age-aware skincare is coming.',
            body:
              '<p>Dr. Lurié products are being shaped around the biology of aging skin: barrier changes, lipid shifts, comfort, and ingredients that respect a changing skin environment.</p>' +
              '<p>The first releases are not live yet. Join early access to receive research notes, product previews, and launch updates.</p>',
            actions: [
              {
                label: 'Join Early Access',
                target: { kind: 'route', href: '/solutions/early-access' },
                style: 'primary',
              },
              { label: 'Explore the Science', target: { kind: 'route', href: '/learn/topics' }, style: 'secondary' },
            ],
            images: [
              {
                src: 'https://kugelmedia.netlify.app/drlurieblog/dr-lurie-product-hero.jpg',
                alt: 'Dr. Lurié age-aware skincare product bottle preview',
              },
              {
                src: 'https://kugelmedia.netlify.app/drlurieblog/dr-lurie-product-texture.jpg',
                alt: 'Dr. Lurié skincare texture preview',
              },
            ],
          },
        },
      ],
    },
  },
  {
    objectId: 'page_pricing',
    body: {
      pageType: 'standard',
      route: '/pricing',
      title: 'Pricing',
      seo: { description: 'Simple pricing for science-first skincare guides — fixed, pay-what-you-want, and free.' },
      sections: [
        {
          id: 's_pricinglede',
          type: 'lede',
          data: {
            kicker: 'Pricing',
            heading: 'Pay for depth, not access',
            body: '<p>The library stays free. Paid guides fund the research time behind it — and two of the three options below cost exactly what you choose.</p>',
            actions: [],
          },
        },
        {
          id: 's_pricingtiers',
          type: 'pricing_table',
          data: {
            heading: 'Guides and support',
            description: 'Prices come straight from the shop — this table never goes stale.',
            tiers: [
              {
                product: 'prod_starter_checklist',
                description: 'Start here: audit your current routine in one page.',
                features: ['One-page routine audit', 'Instant download', 'No email required'],
                actionLabel: 'Get it free',
              },
              {
                product: 'prod_barrier_repair_guide',
                description: 'The full, referenced barrier repair plan.',
                features: ['Complete repair protocol', 'Ingredient checklists', 'Free updates to this edition'],
                highlighted: true,
                actionLabel: 'Buy the guide',
              },
              {
                product: 'prod_support_the_work',
                description: 'Keep the library free and unsponsored.',
                features: ['Pay what you want', 'Every cent funds research time'],
                actionLabel: 'Support',
              },
            ],
          },
        },
        {
          id: 's_pricingsteps',
          type: 'steps',
          data: {
            heading: 'How it works',
            items: [
              {
                title: 'Pick a guide',
                description: 'Every product page shows exactly what is inside.',
                icon: 'tabler:shopping-bag',
              },
              {
                title: 'Instant download',
                description: 'Checkout hands you the file immediately — no waiting on email.',
                icon: 'tabler:download',
              },
              {
                title: 'Put it to work',
                description: 'Each guide ends with a concrete routine you can start the same day.',
                icon: 'tabler:checkup-list',
              },
            ],
          },
        },
        {
          id: 's_pricingfaq',
          type: 'faq',
          data: {
            heading: 'Common questions',
            items: [
              {
                q: 'Can I get a refund?',
                a: '<p>Yes — reply to your receipt within 14 days and we will refund the purchase, no questions asked.</p>',
              },
              {
                q: 'I lost my download link.',
                a: '<p>Links expire after 72 hours for safety. Reply to your receipt email and we will reissue a fresh one.</p>',
              },
              {
                q: 'Is the blog staying free?',
                a: '<p>Yes. Paid guides exist so the library never needs sponsors or paywalls.</p>',
              },
            ],
          },
        },
        {
          id: 's_pricingcta',
          type: 'cta_banner',
          data: {
            heading: 'Not sure where to start?',
            body: '<p>The free checklist takes five minutes and tells you which guide — if any — you actually need.</p>',
            actions: [
              {
                label: 'Get the free checklist',
                target: { kind: 'route', href: '/shop/starter-checklist' },
                style: 'primary',
              },
            ],
          },
        },
      ],
    },
  },
  {
    objectId: 'page_services',
    body: {
      pageType: 'standard',
      route: '/services',
      title: 'Services',
      seo: { description: 'Beyond the guides: how Dr. Lurié works with readers, clinics, and brands.' },
      sections: [
        {
          id: 's_serviceslede',
          type: 'lede',
          data: {
            kicker: 'Services',
            heading: 'Beyond the guides',
            body: '<p>Most of this site is self-serve education. For questions a guide cannot answer, here is how we work together.</p>',
            actions: [],
          },
        },
        {
          id: 's_servicessplit',
          type: 'content_split',
          data: {
            kicker: 'Consultations',
            heading: 'A routine review, grounded in your skin',
            body:
              '<p>A structured one-to-one review of your current routine: what stays, what goes, and what the evidence says about the gaps — written up so you can act on it.</p>' +
              '<p>Consultation booking is not open yet; early-access members hear first.</p>',
            actions: [
              {
                label: 'Join Early Access',
                target: { kind: 'route', href: '/solutions/early-access' },
                style: 'primary',
              },
            ],
            images: [
              {
                src: 'https://kugelmedia.netlify.app/drlurieblog/dr-lurie-product-texture.jpg',
                alt: 'Skincare formulation texture close-up',
              },
            ],
          },
        },
        {
          id: 's_servicesgrid',
          type: 'content_grid',
          data: {
            heading: 'What we offer',
            source: {
              kind: 'cards',
              cards: [
                {
                  icon: 'tabler:user-check',
                  title: 'Routine reviews',
                  description: 'One-to-one audits of what you use today, against the evidence.',
                },
                {
                  icon: 'tabler:school',
                  title: 'Education partnerships',
                  description: 'Science-first material for clinics and estheticians, without the sales pitch.',
                },
                {
                  icon: 'tabler:flask',
                  title: 'Formulation input',
                  description: 'Advisory work for brands building age-aware products honestly.',
                },
              ],
            },
            limit: 3,
          },
        },
        {
          id: 's_servicescta',
          type: 'cta_banner',
          data: {
            heading: 'Work with Dr. Lurié',
            body: '<p>Tell us what you are trying to solve — we answer every serious inquiry.</p>',
            actions: [{ label: 'Get in touch', target: { kind: 'route', href: '/contact' }, style: 'primary' }],
          },
        },
      ],
    },
  },
];

export const CONVERSION_SEEDS = [...PRODUCT_SEEDS, ...PAGE_SEEDS.map((seed) => ({ objectType: 'page', ...seed }))];
