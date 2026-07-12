/**
 * product_set_price (06-shop-module-plan §3) — THE only price-edit path.
 *
 * Stripe prices are immutable, so a price change is: create the new Stripe
 * Price → archive the old one → write `price_id` + the display cache in ONE
 * governed `set_product_price` patch (checkout → patch → checkin through the
 * real verbs — audited, reviewable, inverse = re-point to the archived
 * price). Drift between what an agent set and what Stripe charges is
 * impossible by construction: the number on the site is the number this
 * function just created in Stripe.
 *
 * Mode-aware (§8.7): writes the linkage block for the RUNNING STRIPE_MODE
 * (`stripe` in live, the `stripe_test` mirror in test). A product with no
 * linkage yet gets a Stripe Product created from its title — this tool is
 * also the linkage bootstrapper.
 *
 * Publishing is deliberately NOT part of this tool: the price change sits as
 * an unpublished revision until a human approves and the publish runs
 * (§0.4 — a price change never goes live without a human eye).
 */
import type Stripe from 'stripe';

import { objectRecordKey } from './object-store-keys.js';
import { handleObjectVerb, type ObjectVerbStore } from './object-verbs.js';
import { buildStoreValidationContext } from './object-validation-context.js';
import { stripeMode, type StripeMode } from './stripe-env.js';
import { productBodySchema } from '../../src/schema/bodies/product-v1.js';
import type { ObjectRecord, Principal } from '../../src/schema/object-record-v1.js';

export type ProductSetPriceInput = {
  product_id: string;
  amount_cents: number;
  currency?: string;
};

export type ProductSetPriceResult =
  | {
      ok: true;
      mode: StripeMode;
      price: { amount_cents: number; currency: string };
      stripe: { product_id: string; price_id: string; archived_price_id?: string };
      record_version: number;
      note: string;
    }
  | { ok: false; status: number; error: string };

const err = (status: number, error: string): ProductSetPriceResult => ({ ok: false, status, error });

/**
 * Load ANY active product record (drafts included — pricing a draft is
 * legal; publishing it is the gated step). loadPublishedProduct requires a
 * published_time, so read the record directly.
 */
const loadProductRecord = async (store: ObjectVerbStore, productId: string) => {
  const raw = await store.get(objectRecordKey('product', productId));
  if (raw === null) return undefined;
  const record = JSON.parse(raw) as ObjectRecord;
  if (record.status !== 'active') return undefined;
  const body = productBodySchema.safeParse(record.body);
  return body.success ? { record, body: body.data } : undefined;
};

export const productSetPrice = async (
  input: ProductSetPriceInput,
  deps: { stripe: Stripe; store: ObjectVerbStore; principal: Principal; env?: NodeJS.ProcessEnv }
): Promise<ProductSetPriceResult> => {
  const env = deps.env ?? process.env;
  const currency = (input.currency ?? 'usd').toLowerCase();
  if (!/^[a-z]{3}$/.test(currency)) return err(400, 'currency must be a 3-letter ISO code.');
  if (!Number.isInteger(input.amount_cents) || input.amount_cents <= 0) {
    return err(400, 'amount_cents must be a positive integer.');
  }

  const product = await loadProductRecord(deps.store, input.product_id);
  if (!product) return err(404, `Product ${input.product_id} not found (or archived/invalid).`);
  if (product.body.commerce.mode !== 'fixed') {
    return err(409, `mode '${product.body.commerce.mode}' has no Stripe Price — only fixed-price products are priced.`);
  }

  const mode = stripeMode(env);
  const linkageKey = mode === 'live' ? 'stripe' : 'stripe_test';
  const existing = mode === 'live' ? product.body.commerce.stripe : product.body.commerce.stripe_test;

  // Stripe side first — if any of this fails, the record is untouched.
  let stripeProductId = existing?.product_id;
  if (!stripeProductId) {
    const created = await deps.stripe.products.create({ name: product.body.presentation.title });
    stripeProductId = created.id;
  }
  const newPrice = await deps.stripe.prices.create({
    product: stripeProductId,
    unit_amount: input.amount_cents,
    currency,
  });
  const oldPriceId = existing?.price_id;
  if (oldPriceId) {
    try {
      await deps.stripe.prices.update(oldPriceId, { active: false });
    } catch (error) {
      // Archiving is hygiene, not correctness — the new price_id is what
      // charges. A mock/already-archived old price must not fail the change.
      console.warn(`product_set_price: could not archive old price ${oldPriceId}.`, error);
    }
  }

  // Governed record write: checkout → set_product_price patch → checkin.
  const validationContext = await buildStoreValidationContext(deps.store, {
    selfObjectId: input.product_id,
    selfObjectType: 'product',
  });
  const options = { validationContext };
  const checkout = await handleObjectVerb(
    deps.store,
    { action: 'checkout', object_type: 'product', object_id: input.product_id },
    deps.principal,
    options
  );
  if (checkout.status !== 200) {
    return err(checkout.status, `checkout failed: ${JSON.stringify(checkout.body)}`);
  }
  const lockToken = (checkout.body as { lockToken?: string }).lockToken ?? '';
  const recordVersion = (checkout.body as { record_version?: number }).record_version ?? 0;

  const patch = await handleObjectVerb(
    deps.store,
    {
      action: 'patch',
      object_type: 'product',
      object_id: input.product_id,
      lock_token: lockToken,
      expected_record_version: recordVersion,
      ops: [
        {
          op: 'set_product_price',
          fields: {
            commerce: {
              price: { amount_cents: input.amount_cents, currency },
              [linkageKey]: { product_id: stripeProductId, price_id: newPrice.id },
            },
          },
        },
      ],
    },
    deps.principal,
    options
  );
  const checkin = await handleObjectVerb(
    deps.store,
    { action: 'checkin', object_type: 'product', object_id: input.product_id, lock_token: lockToken },
    deps.principal,
    options
  );
  void checkin; // lock release is best-effort; expiry covers a failure
  if (patch.status !== 200) {
    return err(
      patch.status,
      `patch failed after Stripe price ${newPrice.id} was created: ${JSON.stringify(patch.body)}`
    );
  }

  return {
    ok: true,
    mode,
    price: { amount_cents: input.amount_cents, currency },
    stripe: {
      product_id: stripeProductId,
      price_id: newPrice.id,
      ...(oldPriceId ? { archived_price_id: oldPriceId } : {}),
    },
    record_version: (patch.body as { record_version?: number }).record_version ?? recordVersion + 1,
    note:
      'The record now carries the new price cache + linkage as an UNPUBLISHED revision. Publishing stays ' +
      'review-required (§0.4): submit for review, a human approves in /admin/objects, then object_publish.',
  };
};
