/**
 * Success-page order status (06-shop-module-plan §5/§8.8) — the function
 * behind /shop/thank-you?session_id=….
 *
 * Verifies the session SERVER-SIDE with Stripe (so delivery never depends on
 * email, and a guessed session id yields nothing Stripe doesn't confirm),
 * then reads the order record the webhook writes. If the webhook hasn't
 * landed yet the page keeps polling — `order_ready: false` is a normal
 * transient answer, not an error (§8.8: build the retry in from day one).
 *
 * When the order is ready and fulfillable, a FRESH short-lived download
 * token is minted per response — the HMAC signature is the authorization
 * (see get-purchase.ts); order records keep issuance hashes as audit trail.
 */
import '../../src/config/policy-bindings.js'; // W11: register site policy/identity providers before core server use
import { getCommerceBlobStore, getSiteObjectsBlobStore } from '../../packages/core/server/lib/blob-store.js';
import { readOrder } from '../../packages/core/server/lib/commerce-orders.js';
import { loadPublishedProduct } from '../../packages/core/server/lib/commerce-products.js';
import { DEFAULT_PURCHASE_TOKEN_TTL_MS, mintPurchaseToken, purchaseTokenSecret } from '../../packages/core/server/lib/purchase-tokens.js';
import { getStripeClient } from '../../packages/core/server/lib/stripe-env.js';

type LambdaEvent = {
  blobs?: string;
  httpMethod?: string;
  queryStringParameters?: Record<string, string | undefined> | null;
};

const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const reply = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers: jsonHeaders,
  body: JSON.stringify(body),
});

export const handler = async (event: LambdaEvent) => {
  if (event.httpMethod !== 'GET') return reply(405, { error: 'Method not allowed' });

  const sessionId = (event.queryStringParameters?.session_id ?? '').trim();
  if (!sessionId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    return reply(400, { error: 'A Checkout session_id is required.' });
  }

  const stripe = await getStripeClient();
  if (!stripe) return reply(503, { error: 'Checkout is not configured.' });

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const paid = session.payment_status === 'paid';

    const commerce = await getCommerceBlobStore(event);
    const order = await readOrder(commerce, sessionId);
    if (!order) {
      // Webhook latency vs buyer patience (§8.8): tell the page to retry.
      return reply(200, { ok: true, paid, order_ready: false });
    }

    if (order.fulfillment.state !== 'issued') {
      // Nothing to deliver (tips / kind 'none') — the thank-you itself is the outcome.
      return reply(200, { ok: true, paid, order_ready: true, download: null });
    }

    const secret = purchaseTokenSecret();
    const siteObjects = await getSiteObjectsBlobStore(event);
    const product = await loadPublishedProduct(siteObjects, order.product_id);
    if (!secret || product?.body.fulfillment.kind !== 'download') {
      // Fulfilled order but no mintable link right now — surface a support path.
      return reply(200, { ok: true, paid, order_ready: true, download: null });
    }

    const token = mintPurchaseToken(
      {
        order_key: sessionId,
        artifact_ref: product.body.fulfillment.artifact_ref,
        exp: Date.now() + DEFAULT_PURCHASE_TOKEN_TTL_MS,
      },
      secret
    );

    return reply(200, {
      ok: true,
      paid,
      order_ready: true,
      download: {
        url: `/.netlify/functions/get-purchase?token=${encodeURIComponent(token)}`,
        filename: product.body.fulfillment.filename,
      },
    });
  } catch (error) {
    console.error('Failed to resolve checkout session status.', error);
    return reply(502, { error: 'Could not verify the checkout session. Try again shortly.' });
  }
};
