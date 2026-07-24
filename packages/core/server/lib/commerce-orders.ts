/**
 * Order records — the `commerce` store's `orders/` keyspace
 * (06-shop-module-plan §5).
 *
 * One JSON per order at `orders/<idempotency-key>.json`. The idempotency key
 * is the Stripe Checkout Session id for paid orders (the natural key — the
 * webhook's create-if-absent write makes replays and double-fires no-op) and
 * the minted `order_id` for free claims (no session exists, §5 "Free
 * products"). A tight webhook double-fire can still mint two valid tokens
 * for one order — harmless, both gate the same record, but the event log
 * will show duplicates and consumers must dedupe on session_id (§8.2).
 *
 * PII boundary (§6): the RAW buyer email lives HERE and only here; the event
 * log carries at most `sha256:` hashes.
 *
 * Fulfillment is a pure function of the order record — `order_reissue` (S3)
 * regenerates a token from the stored order at any time, appending a reissue
 * entry; no Stripe round trip. Tokens themselves are never stored — only
 * their sha256 hashes, so a leaked store dump cannot mint download links.
 */
import { z } from 'zod';

import { productModes } from '../../schema/bodies/product-v1.js';

export const COMMERCE_ORDER_SCHEMA_VERSION = 'commerce_order.v1';

const TOKEN_HASH_RE = /^sha256:[0-9a-f]{64}$/;

const reissueSchema = z
  .object({
    at: z.iso.datetime(),
    token_hash: z.string().regex(TOKEN_HASH_RE),
    /** Who triggered it (an order_reissue support call names the agent). */
    by: z.string().min(1).optional(),
  })
  .strict();
export type OrderReissue = z.infer<typeof reissueSchema>;

export const orderFulfillmentStates = [
  // A token was issued (download/unlock kinds — the normal paid path).
  'issued',
  // Nothing to deliver (fulfillment.kind 'none' — tips/PWYW support).
  'none',
] as const;

export const orderRecordSchema = z
  .object({
    schema: z.literal(COMMERCE_ORDER_SCHEMA_VERSION),
    order_id: z.string().min(1),
    /** Stripe Checkout Session id; null for free claims (no session, §5). */
    session_id: z.string().min(1).nullable(),
    product_id: z.string().min(1),
    mode: z.enum(productModes),
    /** What Stripe actually charged (cents); 0 for free claims. */
    amount_total: z.number().int().min(0),
    currency: z.string().regex(/^[a-z]{3}$/),
    /** RAW email — lives ONLY in order records, never the event log (§6). */
    buyer_email: z.string().min(3).nullable(),
    created_at: z.iso.datetime(),
    fulfillment: z
      .object({
        state: z.enum(orderFulfillmentStates),
        /** sha256:<hex> of the issued token — never the token itself. */
        token_hash: z.string().regex(TOKEN_HASH_RE).nullable(),
        issued_at: z.iso.datetime().nullable(),
        /**
         * The PRIVATE artifacts-store key this order's tokens unlock —
         * stored so fulfillment stays a pure function of the order record
         * (§5: order_reissue never needs Stripe or the product's CURRENT
         * body, which may have changed since purchase). Optional: S1c-era
         * orders predate it (additive evolution); reissue then falls back
         * to the product's current fulfillment.
         */
        artifact_ref: z.string().min(1).optional(),
        reissues: z.array(reissueSchema),
      })
      .strict(),
    flags: z
      .object({
        /** Webhook cross-check: amount_total ≠ the product's expected amount (§3). */
        amount_mismatch: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();
export type OrderRecord = z.infer<typeof orderRecordSchema>;

/**
 * `orders/<idempotency-key>.json`. Pass the Checkout Session id for paid
 * orders, the minted order_id for free claims.
 */
export const orderKey = (idempotencyKey: string): string => {
  if (!idempotencyKey || /[/\\]/.test(idempotencyKey)) {
    throw new Error(`orderKey: invalid idempotency key "${idempotencyKey}"`);
  }
  return `orders/${idempotencyKey}.json`;
};

/** The idempotency key an order stores under (session id, else order id). */
export const orderIdempotencyKey = (order: Pick<OrderRecord, 'order_id' | 'session_id'>): string =>
  order.session_id ?? order.order_id;

type OrderStore = {
  get(key: string): Promise<string | null>;
  setJSON(key: string, value: unknown, options?: { onlyIfNew?: boolean }): Promise<void | { modified: boolean }>;
};

export type WriteOrderResult =
  | { created: true; key: string; order: OrderRecord }
  | { created: false; key: string; order: OrderRecord };

/**
 * Create-if-absent order write — THE §5 idempotency mechanism. `onlyIfNew`
 * makes the write atomic on Netlify Blobs; the pre-read guards the local
 * file-backed store (which ignores set options) and lets replays return the
 * ORIGINAL record so fulfillment stays a pure function of first-write state.
 */
export const writeOrderIfAbsent = async (store: OrderStore, order: OrderRecord): Promise<WriteOrderResult> => {
  const parsed = orderRecordSchema.parse(order);
  const key = orderKey(orderIdempotencyKey(parsed));

  const existingRaw = await store.get(key);
  if (existingRaw !== null) {
    return { created: false, key, order: orderRecordSchema.parse(JSON.parse(existingRaw)) };
  }

  const result = await store.setJSON(key, parsed, { onlyIfNew: true });
  if (result && typeof result === 'object' && result.modified === false) {
    // Lost the race to a concurrent webhook fire — read the winner back.
    const winnerRaw = await store.get(key);
    if (winnerRaw !== null) return { created: false, key, order: orderRecordSchema.parse(JSON.parse(winnerRaw)) };
  }
  return { created: true, key, order: parsed };
};

/** Load + validate an order by its idempotency key; null when absent. */
export const readOrder = async (
  store: Pick<OrderStore, 'get'>,
  idempotencyKey: string
): Promise<OrderRecord | null> => {
  const raw = await store.get(orderKey(idempotencyKey));
  return raw === null ? null : orderRecordSchema.parse(JSON.parse(raw));
};
