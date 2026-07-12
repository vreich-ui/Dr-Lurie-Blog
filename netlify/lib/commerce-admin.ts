/**
 * Commerce store administration reads (Wolf, 2026-07-12: "agents have full
 * access to the store administration") — the lookup half of the support
 * loop: order_reissue needs an order_key, and a support agent starts from
 * "customer X lost their email", not from a session id. This module gives
 * agents bounded order visibility over the `commerce` store.
 *
 * §8.6 stands: Blobs is not a queryable database. This is a bounded
 * list+filter sweep for SUPPORT lookups (v1 order volume is tiny), not a
 * reporting surface — aggregation still waits for the external consumer.
 * Raw buyer emails are visible here by design: the caller is the
 * publish-key-authed MCP surface, the same trust level as the admin UI, and
 * the order store is where raw email deliberately lives (§6).
 */
import { collectBlobListItems, type BlobListResponse } from './blob-list.js';
import { hashEmail } from './commerce-events.js';
import { orderRecordSchema, type OrderRecord } from './commerce-orders.js';

type ListableStore = {
  get(key: string): Promise<string | null>;
  list(options: {
    prefix: string;
    directories?: boolean;
    paginate?: boolean;
  }): Promise<BlobListResponse> | BlobListResponse;
};

export type OrderSummary = {
  /** The idempotency key (orders/<key>.json) — what order_reissue takes. */
  order_key: string;
  order_id: string;
  product_id: string;
  mode: OrderRecord['mode'];
  amount_total: number;
  currency: string;
  buyer_email: string | null;
  created_at: string;
  fulfillment_state: OrderRecord['fulfillment']['state'];
  reissue_count: number;
  flags: OrderRecord['flags'];
};

const toSummary = (key: string, order: OrderRecord): OrderSummary => ({
  order_key: key,
  order_id: order.order_id,
  product_id: order.product_id,
  mode: order.mode,
  amount_total: order.amount_total,
  currency: order.currency,
  buyer_email: order.buyer_email,
  created_at: order.created_at,
  fulfillment_state: order.fulfillment.state,
  reissue_count: order.fulfillment.reissues.length,
  flags: order.flags,
});

export type ListOrdersInput = {
  /** Case-insensitive exact email match (raw or normalized). */
  email?: string;
  /** Only orders for this product object id. */
  product_id?: string;
  /** Max rows, newest first; default 20, cap 100. */
  limit?: number;
};

export const listOrders = async (store: ListableStore, input: ListOrdersInput = {}): Promise<OrderSummary[]> => {
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 20), 1), 100);
  const emailHash = input.email ? hashEmail(input.email) : undefined;

  const listResult = await store.list({ prefix: 'orders/', directories: false, paginate: true });
  const items = await collectBlobListItems(listResult);

  const summaries: OrderSummary[] = [];
  for (const item of items) {
    const raw = await store.get(item.key);
    if (raw === null) continue;
    let order: OrderRecord;
    try {
      order = orderRecordSchema.parse(JSON.parse(raw));
    } catch {
      continue; // a corrupt record must not kill the support lookup
    }
    if (input.product_id && order.product_id !== input.product_id) continue;
    if (emailHash && (!order.buyer_email || hashEmail(order.buyer_email) !== emailHash)) continue;
    summaries.push(toSummary(item.key.replace(/^orders\//, '').replace(/\.json$/, ''), order));
  }

  return summaries.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
};

/** Full order detail by idempotency key; null when absent. */
export const getOrderDetail = async (
  store: Pick<ListableStore, 'get'>,
  orderKey: string
): Promise<{ order_key: string; order: OrderRecord } | null> => {
  const raw = await store.get(`orders/${orderKey}.json`);
  if (raw === null) return null;
  return { order_key: orderKey, order: orderRecordSchema.parse(JSON.parse(raw)) };
};
