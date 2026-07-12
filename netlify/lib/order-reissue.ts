/**
 * order_reissue (06-shop-module-plan §5) — the launch-critical support tool
 * (§8.4: no customer accounts, so "lost token + expired link" is a support
 * case that lands HERE, not a dead end).
 *
 * Fulfillment is a pure function of the order record: the artifact key comes
 * from `order.fulfillment.artifact_ref` (stored at issuance; falls back to
 * the product's CURRENT download ref for S1c-era orders that predate the
 * field) — no Stripe round trip. Each reissue appends an audit entry
 * `{ at, token_hash, by }` and a `fulfillment_reissued` event; old tokens
 * are not revoked (they expire on their own — bearer semantics, §8.3).
 */
import { randomUUID } from 'node:crypto';

import { appendCommerceEvent, hashEmail, newCommerceEvent } from './commerce-events.js';
import { orderKey, orderRecordSchema, readOrder, type OrderRecord } from './commerce-orders.js';
import { loadPublishedProduct } from './commerce-products.js';
import {
  DEFAULT_PURCHASE_TOKEN_TTL_MS,
  mintPurchaseToken,
  purchaseTokenHash,
  purchaseTokenSecret,
} from './purchase-tokens.js';

type Store = {
  get(key: string): Promise<string | null>;
  setJSON(key: string, value: unknown, options?: { onlyIfNew?: boolean }): Promise<void | { modified: boolean }>;
};

export type OrderReissueInput = {
  /** The order's idempotency key: the Checkout session id, or the ord_… id for free claims. */
  order_key: string;
  /** Override the 72h default, bounded 1h–14d (support judgement call). */
  ttl_hours?: number;
};

export type OrderReissueResult =
  | {
      ok: true;
      order_id: string;
      download_url: string;
      expires_at: string;
      reissue_count: number;
    }
  | { ok: false; status: number; error: string };

const err = (status: number, error: string): OrderReissueResult => ({ ok: false, status, error });

export const orderReissue = async (
  input: OrderReissueInput,
  deps: {
    commerce: Store;
    events: Store;
    siteObjects: { get(key: string): Promise<string | null> };
    /** Who ran the reissue — recorded on the audit entry. */
    by: string;
    env?: NodeJS.ProcessEnv;
  }
): Promise<OrderReissueResult> => {
  const secret = purchaseTokenSecret(deps.env ?? process.env);
  if (!secret) return err(503, 'Purchase delivery is not configured (PURCHASE_TOKEN_SECRET).');

  const ttlHours = input.ttl_hours ?? DEFAULT_PURCHASE_TOKEN_TTL_MS / 3_600_000;
  if (!Number.isFinite(ttlHours) || ttlHours < 1 || ttlHours > 14 * 24) {
    return err(400, 'ttl_hours must be between 1 and 336 (14 days).');
  }

  const order = await readOrder(deps.commerce, input.order_key);
  if (!order) return err(404, `No order found for key "${input.order_key}".`);

  // The §5 purity rule: prefer the ref recorded at issuance; fall back to
  // the product's current download ref only for pre-artifact_ref orders.
  let artifactRef = order.fulfillment.artifact_ref;
  if (!artifactRef) {
    const product = await loadPublishedProduct(deps.siteObjects, order.product_id);
    if (product?.body.fulfillment.kind === 'download') artifactRef = product.body.fulfillment.artifact_ref;
  }
  if (!artifactRef) {
    return err(409, `Order ${order.order_id} has nothing to deliver (fulfillment state '${order.fulfillment.state}').`);
  }

  const expMs = Date.now() + ttlHours * 3_600_000;
  const token = mintPurchaseToken({ order_key: input.order_key, artifact_ref: artifactRef, exp: expMs }, secret);

  const updated: OrderRecord = orderRecordSchema.parse({
    ...order,
    fulfillment: {
      ...order.fulfillment,
      state: 'issued',
      artifact_ref: artifactRef,
      reissues: [
        ...order.fulfillment.reissues,
        { at: new Date().toISOString(), token_hash: purchaseTokenHash(token), by: deps.by },
      ],
    },
  });
  await deps.commerce.setJSON(orderKey(input.order_key), updated);

  try {
    await appendCommerceEvent(
      deps.events,
      newCommerceEvent({
        type: 'fulfillment_reissued',
        event_id: randomUUID(),
        actor: { email_hash: order.buyer_email ? hashEmail(order.buyer_email) : null },
        subject: { product_id: order.product_id, order_id: order.order_id, session_id: order.session_id },
        data: { reissue_count: updated.fulfillment.reissues.length },
      })
    );
  } catch (error) {
    console.error('Failed to append fulfillment_reissued event.', error);
  }

  return {
    ok: true,
    order_id: order.order_id,
    download_url: `/.netlify/functions/get-purchase?token=${encodeURIComponent(token)}`,
    expires_at: new Date(expMs).toISOString(),
    reissue_count: updated.fulfillment.reissues.length,
  };
};
