# Shop Module — Development Plan (Stripe-only, v1)

Date: 2026-07-12. Status: **PLAN, not code** (Wolf's brief; this doc is the
deliverable). Companions: `02-architecture-and-schema.md` (D§),
`03-mapping-and-agent-contract.md` (C§), `conversion-map.md` (W5 context),
`design-principles.md` (governing). Scope: digital goods only — downloads,
pay-to-unlock, tips/PWYW. Physical goods deliberately later; the model must
not preclude them and must not carry their weight now.

## 0. Pushback first (the brief asked for it)

1. **"Products authorable like articles, via the article pipeline" — no.**
   The article pipeline is the deliberately FROZEN legacy surface (§3.10
   protects ContentSourceV1; OQ-8 defers its object-model future; CLAUDE.md
   makes it off-limits except bounded exceptions). Hitching commerce to it
   inherits the freeze and doubles the exception surface. Products should be
   a **governed object type in the site-objects store** — the same verbs,
   contract, validation, and audit trail that already run pages/sections/
   taxonomy/site. Agents then get product CRUD *for free* through
   `object_create/checkout/patch/publish` + `object_contract('product')`,
   which is exactly "the way it exposes article CRUD" — but on the strategic
   model, not the legacy one.
2. **"Reuse the article rendering pipeline" — reuse the SECTION pipeline
   instead.** W6 just finished the machinery that makes any surface a
   composition of registered sections rendered by `PageObjectRenderer` /
   `ObjectSections`. That is the unified renderer now; the article TipTap
   model converges on it at W7 anyway. Product pages get article-grade
   richness by composition (see §2), not by borrowing `SinglePost`.
3. **Payment Links: don't coexist in v1.** The zero-code benefit evaporates
   because anything with fulfillment or event capture needs OUR session
   metadata and OUR webhook handling — so the session function must exist
   anyway. Tips ride the same Checkout Session path as everything else
   (`fulfillment.kind: 'none'`). One path, one webhook shape. Revisit links
   only if a truly fire-and-forget product with no events ever appears.
4. **"All-autonomous publish" must NOT extend to commerce.** The approval
   policy is per-type by design (`src/config/approval-policy.ts`). `product`
   ships **review-required**: an agent proposing a price change is fine; a
   price change going live without a human eye is not. This is one config
   line and it is not optional.
5. **Two standing caveats become launch blockers**: rotate `PUBLISH_SECRET`
   (exposed 2026-07-11, accepted-risk while nothing was live — commerce ends
   that), and the `SITE_NOT_YET_LIVE` noindex guard must flip deliberately as
   part of shop go-live, not incidentally.

## 1. Product object design

New object type `product` (`product.v1`), site-objects store, one record per
product, id `prod_<slug-ish>`. Three concern blocks that change at different
rates, plus the polymorphic fulfillment axis:

```jsonc
{
  "slug": "barrier-repair-guide",            // /shop/<slug>; unique (isSlugTaken, like isRouteTaken)
  "presentation": {                            // changes editorially, often
    "title": "The Barrier Repair Guide",
    "excerpt": "…card copy…",
    "images": [{ "src": "https://kugelmedia…/cover.jpg", "alt": "…" }],  // sanctioned hosts / artifact refs (trap 14 rules apply)
    "seo": { "description": "…", "ogImage": "…" },
    "page_ref": "page_prod_barrier_guide"     // OPTIONAL Page object carrying long-form sections (see §2)
  },
  "commerce": {                                // changes rarely, human-gated
    "provider": "stripe",                     // 'stripe' | 'none' (free); future: 'shopify'
    "mode": "fixed",                          // 'fixed' | 'pwyw' | 'free'
    "price": { "amount_cents": 1900, "currency": "usd" },   // DISPLAY CACHE — Stripe is canonical (§3)
    "pwyw": { "min_cents": 300, "suggested_cents": 900 },   // mode:'pwyw' only
    "stripe": { "product_id": "prod_…", "price_id": "price_…" },  // linkage, never secrets
    "availability": "available"               // 'available' | 'coming_soon' | 'retired'
  },
  "fulfillment": {                             // THE polymorphic axis — discriminated union
    "kind": "download",                       // 'download' | 'unlock' | 'none'
    "artifact_ref": "pdf/guides/<sha256>.pdf", // private artifacts store key
    "filename": "barrier-repair-guide.pdf"
  }
}
```

**Polymorphism strategy: a zod discriminated union on `fulfillment.kind`,
and nowhere else.** This is the house pattern (`content_grid.source`,
`NavTarget`) — validated at write time, self-described via
`object_contract('product')`, and impossible to half-fill (strict per-variant
schemas). Presentation and commerce stay flat and common because a tip and a
download genuinely share them; only what the buyer *gets* differs. Physical
goods later = one new union member (`kind: 'shipment'`, carrying address/
shipping needs THEN) + `commerce.provider: 'shopify'` as provenance — no
rewrite of the other two blocks, which is the "normalized interface, not
Stripe-shaped struct" requirement. Recurring later = a `commerce.mode`
addition; nothing structural forbids it.

- `mode: 'free'` **never touches Stripe** (`provider: 'none'`): no session,
  no webhook — the "purchase" is a direct token issuance through the same
  order/event machinery (§5), which is exactly a lead magnet and ties into
  the existing opt-in capture.
- Validation criteria (new, in the standing engine): slug shape/uniqueness;
  mode↔fields coherence (pwyw needs pwyw block; fixed needs price+price_id;
  free forbids stripe linkage); `artifact_ref` must resolve in the artifacts
  store AND be trusted (existing artifact-trust machinery); availability
  'available' requires publishable fulfillment; image/deploy-safety rules as
  everywhere (trap 14).
- MCP surface: the generic verbs cover CRUD; two NEW tools are part of the
  type's contract (criterion 4 — no permitted action without a tool):
  `product_set_price` (§3) and `order_reissue` (§5).

## 2. Product page vs article — answered

**Different object, same rendering pipeline.** A product is not an article
with a commerce facet, for three load-bearing reasons: (a) lifecycle —
articles are all-autonomous and never "retire"; products need availability
states, human-gated pricing, and Stripe linkage; (b) the article pipeline is
frozen legacy (pushback 1) — new commerce semantics grafted onto it would be
the third sanctioned exception and by far the largest; (c) law — products
need their own validation criteria, which the object model gives per-type and
the article pipeline cannot without surgery.

BUT the *page* half of a product is literally a page: long-form copy,
imagery, embeds. So compose instead of clone: `presentation.page_ref` points
at an ordinary **Page object** (agents create it with the existing tools —
templates work too: a `tpl_product` recipe is data, zero code). `/shop/[slug]`
renders: buy box + hero imagery from the product object (commerce facet),
then the referenced page's sections through the SAME `ObjectSections` path W6
built (prose for long-form, `content_embed` for related articles,
`content_grid`, faq, testimonial — the whole palette). A product without
`page_ref` is a thin card+buy-box page and that's fine. This answers "as rich
as an article" without a parallel renderer, and when W7 moves rich text to
the Contentful model, product pages inherit it with zero shop work.

## 3. Blobs↔Stripe canonicality

**Stripe is canonical for charge amounts; Blobs is canonical for everything
else** (copy, imagery, fulfillment, availability, mode). Enforced
structurally, not by discipline:

- The product object stores `stripe.price_id` plus a **display cache** of
  the amount. The site renders the cache; Checkout charges the `price_id`.
  A stale cache is therefore a *cosmetic* bug, never a wrong charge.
- Agents don't edit the cache. The ONLY price-edit path is the
  `product_set_price` MCP tool: it creates a new Stripe Price via API
  (Stripe prices are immutable), archives the old one, and writes
  `price_id` + cache in one governed patch (audited, reviewable, inverse =
  re-point to the archived price). Drift between what an agent set and what
  Stripe charges is impossible by construction — the number on the site is
  the number the server just created in Stripe.
- Backstop for dashboard edits made directly in Stripe: a
  `commerce_price_sync` validation criterion (publish-gated) compares cache
  vs live Price on product publish, and the webhook handler cross-checks
  `amount_total` against the order's expected amount, flagging mismatches
  into the event log. Between a dashboard edit and the next publish, the
  displayed price can be stale for up to one build — said plainly in §8.
- PWYW: Checkout `custom_unit_amount` with `minimum` from `pwyw.min_cents`.
  No Price object needed; the session function is the enforcement point.

## 4. Presentation surfaces + the W5 pages (back in scope, with real content)

- **`/shop`** — catalog. One page object (`page_shop`, pageType `standard`)
  whose grid is the EXISTING `product_preview` section type upgraded from
  static `ProductCard[]` to a resolved source
  (`{kind:'query'|'manual'}` over product objects — the exact M-8 pattern
  content_grid uses for posts). All three product types render as one grid;
  mode decides the price badge ("$19" / "pay what you want" / "free").
- **`/shop/[slug]`** — product route file following the W6 `content_detail`
  pattern: derivation supplies the product list (published, available
  products emit paths), the objects supply everything rendered. Plus a
  `page_product_detail` object for route-level SEO defaults, exactly like
  `page_article`.
- **`/pricing`** — becomes REAL: a page object with the new
  **`pricing_table`** section whose tiers REFERENCE product ids — price and
  availability resolve from the same commerce data at build (no copy drift;
  repointable; passes the design-principles litmus). The **`steps`** type
  (ordered icon steps) carries the "how it works" strip. Both types now grow
  on demand with real content — the objection to minting them speculatively
  is resolved by the shop existing.
- **`/services`** — convertible with **`feature_grid`** + **`content_split`**
  once real copy exists. Flag, plainly: its current text is Astrowind
  lorem (audit A§2.13: "template leftovers, unlinked"); converting it means
  Wolf supplies copy or signs off keeping placeholder — seeding lorem into
  the store is design-principles rule 3 territory and this plan won't do it
  silently. Recommendation: write the copy when the shop launches (services
  = consultations? another fulfillment kind someday) or delete the page.
- **`/solutions/shop-preview`** — converts via **`content_split`** (text +
  media split; kicker/heading/body/actions + 1–2 images), the scoped style
  moving into the component under the functional-equivalence gate
  (`known-inert-diffs.md` entry). Post-launch it naturally repoints to
  `/shop` — a one-op agent edit, which is the whole point.

New reusable types this plan mints (all with real first instances):
`content_split` (shop-preview), `pricing_table` + `steps` (/pricing),
`feature_grid` (/services, /pricing features), `product_grid`-capable
`product_preview` upgrade (catalog). Each: one union member + one registry
module + one component, per the standing recipe.

## 5. Checkout, fulfillment, and orders

**Checkout**: `netlify/functions/create-checkout-session.ts` — validates
product id + availability against the store, creates a Stripe Checkout
Session (`price_id` or `custom_unit_amount`), stamps
`metadata: { product_id, event_id }`, returns the redirect URL. Hosted
Checkout only; no Elements, no PCI scope beyond SAQ-A.

**Orders** (new `commerce` blob store): `orders/<session_id>.json` — the
session id is the natural idempotency key. Written create-if-absent by the
webhook; replays and double-fires no-op. Shape:
`{ order_id, session_id, product_id, mode, amount_total, currency,
buyer_email, created_at, fulfillment: { state, token_hash, issued_at,
reissues: [] }, flags: { amount_mismatch? } }`.

**Webhook**: `stripe-webhook.ts` — signature-verified
(`STRIPE_WEBHOOK_SECRET`), handles `checkout.session.completed` (create
order → issue fulfillment → append event) and
`checkout.session.expired` (append abandonment event). Idempotent,
replayable, and independently re-triggerable: fulfillment is a pure function
of the order record, so `order_reissue` (MCP tool, support case: "customer
lost the email") regenerates a token from the stored order at any time,
appending a reissue entry — no Stripe round trip needed.

**Delivery**: files live in the PRIVATE `artifacts` store (existing).
`get-purchase.ts` validates a signed token (HMAC via the existing
`crypto.ts` helpers) embedding `{ order_id, artifact_ref, exp }`, checks the
order record, streams the blob with `Content-Disposition` — the token-gated
sibling of the existing `get-public-pdf.ts`. Expiring (e.g. 72h), re-issuable,
hard-to-share — not impossible-to-share; said plainly in §8.

**Pay-to-unlock inverts timing, as the brief requires**: the artifact is
generated and stored BEFORE payment (at quiz/result creation), keyed under
the unlock prefix; the product's `fulfillment.unlock` names it. Payment only
flips retrieval — the webhook writes the order and the token unlocks the
already-existing blob. No generation call ever waits on webhook latency.

**Success page** `/shop/thank-you?session_id=…`: a function verifies the
session server-side and renders the download/unlock link — so delivery does
not depend on email at all in v1. Stripe's own receipt email is enabled;
first-party email sending is deferred (§7).

**Free products**: skip Stripe entirely — `claim-free.ts` writes an order
(`order_id` minted, no session), issues the token, appends events, and
optionally records the email through the existing opt-in machinery.

## 6. Event capture (the substrate contract)

New append-only `commerce-events` store, one JSON per event,
`events/<yyyy-mm-dd>/<ts>-<uuid>.json` (the proven opt-ins layout). Schema
`commerce_event.v1` — designed for the unknown downstream consumer:

```jsonc
{
  "schema": "commerce_event.v1",
  "event_id": "uuid",
  "ts": "2026-07-12T12:00:00.000Z",
  "type": "product_viewed",   // product_viewed | checkout_started | checkout_completed
                               // | fulfillment_issued | download_succeeded
                               // | fulfillment_reissued | checkout_abandoned | amount_mismatch
  "actor": { "anon_id": "a_…", "email_hash": "sha256:…" },   // PII-minimized; raw email lives ONLY in order records
  "subject": { "product_id": "prod_…", "order_id": null, "session_id": null },
  "context": { "path": "/shop/…", "referrer": null, "ua": null },
  "data": { "amount_cents": 1900, "currency": "usd", "mode": "fixed" }
}
```

Rules, binding: events are immutable and never deleted; evolution is
additive-only (new types, new optional fields — bump to v2 only for breaking
shape changes, and then dual-write during transition); every type carries the
same envelope; server-side events (completed/issued/downloaded/abandoned) are
authoritative, client-side ones (`product_viewed`, `checkout_started` via a
`sendBeacon` capture function, the save-opt-in pattern) are best-effort and
lossy by design. Nothing reads this in v1; a future consumer ETLs the store —
Blobs is not a queryable database and this plan does not pretend it is.

## 7. OSS: where it earns its place

- **`stripe` (official Node SDK)** — yes. Session creation + webhook
  signature verification; hand-rolling signature checks is malpractice.
- **Existing in-house machinery** — the real reuse story: blob-store env
  contract (W4 lesson), artifacts store + trust, crypto.ts HMAC, opt-in
  capture pattern, object verbs/contract/validation, PageObjectRenderer/
  ObjectSections, build-diff harness.
- **Not earning a place**: Snipcart/Medusa/Commerce.js (each replaces the
  object store or drags a backend we don't need); Astro commerce themes
  (Stripe-shaped structs, wrong model); analytics SDKs (the event log IS the
  product); email providers — deferred until first-party email exists as a
  need (Stripe receipts + success-page retrieval cover v1); Shopify SDK —
  explicitly future, arrives with physical goods behind the
  `commerce.provider` seam.

## 8. The parts that will break — said plainly

1. **Stale display prices.** Direct Stripe-dashboard edits leave the site
   showing the cached amount until the next publish/build. Charges stay
   correct (price_id), the display lies. Mitigations exist (§3) but the
   window is real.
2. **Webhook races and replays.** Stripe retries and double-fires;
   create-if-absent on `orders/<session_id>` makes fulfillment idempotent,
   but a tight double-fire can mint two valid tokens for one order.
   Harmless (both gate the same order) — but it will show up in the events
   as duplicates; the consumer must dedupe on session_id.
3. **Tokens are bearer secrets.** An expiring signed URL is hard to share,
   not impossible. A determined buyer can hand the file on. Accepted for v1
   digital goods; do not promise DRM.
4. **No customer identity.** There are no buyer accounts (the login modal is
   admin-cockpit only). Lost token + expired link = support case →
   `order_reissue`. That tool is therefore launch-critical, not a nicety.
5. **The secrets scanner (trap 14) will bite.** `STRIPE_SECRET_KEY` /
   `STRIPE_WEBHOOK_SECRET` are env-only; any Stripe id leaking into
   *content* is fine (ids aren't secrets) but a key pasted into a product
   body will block ALL deploys exactly as the portrait URL did. The
   deploy-safety validator already guards marked env values — mark the
   Stripe keys.
6. **Blobs is not transactional.** No counters, no queries, eventual-ish
   listing. Order/event writes are single-key puts (fine); anything needing
   aggregation waits for the external consumer. Do not build reporting on
   blob listing.
7. **Test↔live mode switch.** Products carry live `price_id`s; test-mode
   sessions can't use them. The env carries BOTH key pairs and the session
   function picks by `STRIPE_MODE` — products store test ids in a
   `stripe_test` mirror block until launch, dropped after. Clunky, known.
8. **Webhook latency vs buyer patience.** The success page pulls the session
   server-side precisely so the buyer never waits on the webhook; but if the
   webhook is delayed past the success-page visit, the page must poll/retry
   for the order record. Build that retry in from day one.

## 9. Build sequence

**Critical path (serial):**
1. **S1a** `product.v1` schema + object type + validation criteria +
   contract + review-required approval flip. *(the seam everything hangs on)*
2. **S1b** `commerce` + `commerce-events` stores + event lib + capture
   function.
3. **S1c** `create-checkout-session` → `stripe-webhook` (orders,
   idempotent) → `get-purchase` (token delivery) → success page. Exit test:
   one fixed-price download bought end-to-end in Stripe test mode, webhook
   replayed twice, token reissued once — one order, one file, three events.
4. **S2** `/shop` catalog (product_preview upgrade) + `/shop/[slug]`
   (product route + `page_ref` sections) + `page_shop`/`page_product_detail`
   seeds + view/start beacons.
5. **S3** PWYW + free paths; unlock kind; `order_reissue` + `product_set_price`
   MCP tools (criterion-4 completeness for the product type).

**Parallelizable (any time after S1a):** `content_split` + shop-preview
conversion; `pricing_table`/`steps`/`feature_grid` types; driver drill
support for `product` (roundtrip-drill dispatch + seed family); docs.

**After S2/S3:** `/pricing` conversion (needs live products to reference);
`/services` (needs Wolf's copy decision — or deletion).

**Deferrable, explicitly:** first-party email; subscriptions; physical goods
/ Shopify provider; Payment Links; analytics consumers; refunds workflow
(v1: Stripe dashboard + manual event append); multi-currency.

**Launch gate (all mandatory):** PUBLISH_SECRET rotated · Stripe keys marked
as secrets · SITE_NOT_YET_LIVE flip decision · review-required publish for
`product` verified · webhook signature verified in production · the S1c exit
test re-run against live mode with a $1 product and refunded.
