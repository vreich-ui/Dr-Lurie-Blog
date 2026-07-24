/**
 * Product lookups for the checkout path (06-shop-module-plan §5) — the
 * commerce functions' read-only view of the site-objects store. Charging is
 * gated on STORE state (published + active + available), never on committed
 * exports: an unpublished draft or a retired product must not be buyable the
 * instant before the next build.
 */
import { productBodySchema, type ProductBody } from '../../schema/bodies/product-v1.js';
import type { ObjectRecord } from '../../schema/object-record-v1.js';
import { objectRecordKey } from './object-store-keys.js';
import { stripeLinkageForMode } from './stripe-env.js';

type ReadableStore = { get(key: string): Promise<string | null> };

export type LoadedProduct = { record: ObjectRecord; body: ProductBody };

/** A published, active product with a schema-valid body — else null. */
export const loadPublishedProduct = async (store: ReadableStore, productId: string): Promise<LoadedProduct | null> => {
  const raw = await store.get(objectRecordKey('product', productId));
  if (raw === null) return null;
  let record: ObjectRecord;
  try {
    record = JSON.parse(raw) as ObjectRecord;
  } catch {
    return null;
  }
  if (record.status !== 'active' || record.publication?.published_time == null) return null;
  const body = productBodySchema.safeParse(record.body);
  return body.success ? { record, body: body.data } : null;
};

export type BuyabilityCheck =
  | { ok: true; mode: 'fixed'; priceId: string; amountCents: number; currency: string }
  | { ok: true; mode: 'pwyw'; minCents: number; suggestedCents?: number; stripeProductId?: string }
  | { ok: false; reason: 'not_available' | 'mode_not_supported' | 'not_linked' | 'free_product' };

/**
 * Can a Checkout Session be created for this product right now? fixed charges
 * the linked Price; pwyw charges a buyer-chosen amount the session function
 * validates against `pwyw.min_cents` (§3 — no Stripe Price object exists for
 * PWYW; this check is the enforcement point's data source). Free products
 * never get a session (§1 — claim-free is their path). The linkage block is
 * picked by STRIPE_MODE (§8.7).
 */
export const checkBuyability = (body: ProductBody, env: NodeJS.ProcessEnv = process.env): BuyabilityCheck => {
  if (body.commerce.availability !== 'available') return { ok: false, reason: 'not_available' };
  if (body.commerce.mode === 'free') return { ok: false, reason: 'free_product' };
  const linkage = stripeLinkageForMode(body.commerce, env);
  if (body.commerce.mode === 'pwyw') {
    const pwyw = body.commerce.pwyw;
    if (!pwyw) return { ok: false, reason: 'not_linked' };
    return {
      ok: true,
      mode: 'pwyw',
      minCents: pwyw.min_cents,
      ...(pwyw.suggested_cents !== undefined ? { suggestedCents: pwyw.suggested_cents } : {}),
      ...(linkage?.product_id ? { stripeProductId: linkage.product_id } : {}),
    };
  }
  const priceId = linkage?.price_id;
  const price = body.commerce.price;
  if (!priceId || !price) return { ok: false, reason: 'not_linked' };
  return { ok: true, mode: 'fixed', priceId, amountCents: price.amount_cents, currency: price.currency };
};
