/**
 * Product export reading + display helpers (S2, 06-shop-module-plan §4) —
 * shared by the product_preview grid resolvers, the /shop/[slug] route, and
 * anything else that renders commerce data at build time.
 *
 * Reads are collection-based (`getCollection('productObject')` over
 * src/data/site/products/*.json) and ASYNC — used only in route
 * getStaticPaths/frontmatter and the async deps builder, never inside
 * previously-synchronous chrome components (the site-object.ts sync rule).
 */
import { getCollection } from 'astro:content';

import { productBodySchema, type ProductBody } from '../../packages/core/schema/bodies/product-v1';

/** Strip the `__generated` marker and validate a product export. */
export const parseProductExport = (data: unknown): ProductBody => {
  const { __generated, ...body } = (data ?? {}) as Record<string, unknown>;
  void __generated;
  return productBodySchema.parse(body);
};

export type LoadedProductExport = { id: string; body: ProductBody };

/** Every committed product export, parsed; throws loudly on an invalid one. */
export const loadProductExports = async (): Promise<LoadedProductExport[]> => {
  const entries = await getCollection('productObject');
  return entries.map((entry) => ({ id: entry.id, body: parseProductExport(entry.data) }));
};

/**
 * The catalog view: published products with availability 'available'
 * (never-render-private — retired/coming_soon products may be published for
 * drafting but must not surface as buyable cards or routable pages), sorted
 * by title for deterministic builds.
 */
export const loadAvailableProducts = async (): Promise<LoadedProductExport[]> =>
  (await loadProductExports())
    .filter(({ body }) => body.commerce.availability === 'available')
    .sort((a, b) => a.body.presentation.title.localeCompare(b.body.presentation.title));

/** "$19" / "$19.50" for fixed (usd; other currencies fall back to an ISO prefix), else the mode's label. */
export const productPriceBadge = (commerce: ProductBody['commerce']): string => {
  if (commerce.mode === 'pwyw') return 'Pay what you want';
  if (commerce.mode === 'free') return 'Free';
  const price = commerce.price;
  if (!price) return '';
  const dollars = price.amount_cents / 100;
  const formatted = Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
  return price.currency === 'usd' ? `$${formatted}` : `${price.currency.toUpperCase()} ${formatted}`;
};

/** The product page route for a product body. */
export const productRoute = (body: ProductBody): string => `/shop/${body.slug}`;
