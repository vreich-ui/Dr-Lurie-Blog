# State of play — agent-editability push

Rolling session log for the multi-session mandate ("an agent can inspect and
edit any meaningful part of the live Dr-Lurie site through one consistent,
human-reviewed workflow"). Each session appends its entry at the top and
updates the standing tables. **Rule inherited from the mandate: never trust
this file over real state — verify against main / test output / the live
store before building on anything below.**

## Session 2026-07-13 G (CANVAS Slice B: second field-test round — preload, human tray, image placeholders, button states, bullets)

Wolf's second live round (screenshots) + three rulings: **W7.7 remainder ON
HOLD** ("that UI is stale now. I need to rethink what the admin area is
supposed to be like" — no TipTap panel or /admin/publish re-wire until his
ruling); **metadata row = category + tags**; the rest shipped same-day
(07-canvas §3i):

- Metadata row: category + tag links on every article header (both
  families, registry labels).
- Record cache + preload (pay the wait up front): edit-mode entry warms one
  get per visible object; chips/panels/tray/role editor open from memory;
  writes invalidate; failures don't stick.
- Pending tray humanized — "object · verb · location": object TITLE + a
  history-derived summary of unpublished ops ("Image added to Resolution",
  "Text edited in Hook · +1 more"); req\_\* ids demoted to tooltips.
- Chip identity is the ROLE alone ("Hook · educate") — "article content"
  boilerplate dropped from chip and panel header.
- Image tool: thumbnails never show the broken-image glyph (load-gated +
  neutral placeholder); a NEW image previews in place as an appended figure
  on save; an emptied src removes its element.
- Buttons: Save draft on the accent token (green was off-palette), full
  hover/active/focus-visible/disabled states, "Saving…" in flight +
  "✓ Saved" confirmation (restores on failure) — saveForm/roleForm/navForm.
- Bullets (the "lists dropped, not editable" report): items[] is ALWAYS
  offered on content blocks ("Bullet points", one per line) — the gap was
  that the form only listed EXISTING fields, so a text block could never
  gain a list; lists now also preview in place on save. Editor-facing field
  labels throughout (Text/Heading/Kicker/Button text…).
- **Gates**: 1205 + 49 tests green · astro check 0 · eslint/prettier clean ·
  build 173 pages · **15-assertion Slice-B drive** on the built demo page
  (metadata links; warm-cache proof — zero re-fetch before first save;
  tray title + "Text edited in Hook · +1 more"; placeholder-not-broken;
  accent save button; Saving…/Saved states; items wire + in-place <ul>) +
  the 19-assertion W7.7 drive and 16-assertion Slice-A drive re-run green
  (probe export recreated for the run, then removed).

## Session 2026-07-13 F (W7.7 CANVAS CAPABILITY SLICE: node palette + adSlot mockup bank + role panel + multi-image; upsert_node id-mint gap fixed)

Same session as E, on Wolf's "continue to W7.7". The article body is now
COMPOSABLE from the canvas — full doc: 07-canvas-editing.md §3h.

- **Node palette** (`nodes-palette.ts`, pure + tested): "+" before/between/
  after blocks ("Add an article block" — req\_\* ids banned from UI copy) →
  nine schema-valid starters, each annotated from birth: Text, Heading+text,
  Checklist, Image, Image gallery, CTA, **Offer/affiliate** (disclosure +
  nofollow-sponsored pre-filled), **Ad slot (mock)**, Chat invite. Insert =
  `upsert_node` at a record-derived position, server-minted id, honest draft
  placeholder.
- **SERVER GAP FOUND + FIXED**: `mintOpsIds` never handled `upsert_node`
  though the contract advertised `minted_id_field: node.id` since W7.3 (the
  W7.9 drill's probe carried an explicit id, so it never fired). Id-less
  upsert*node now mints `n*<hex>` (leak-safe by construction) + test.
- **adSlot MOCKUP BANK** (Wolf: "make them look real like served by google
  or a native ads provider"): native in-feed / leaderboard / med-rectangle,
  rendered ONLY for `adSlot.provider:'mock'` (real providers still render
  nothing — mockups never fake live inventory), honestly labeled
  Advertisement/Sponsored + Ad chip, fictional advertiser, no external
  assets, copy overridable per node, creative switched via
  `commercial.creativeId`. Screenshots delivered to Wolf.
- **ROLE & INTENT PANEL**: fourth accordion section (article blocks only) —
  strategy (12) + intent (5) dropdowns + agent notes → `update_node` on
  `private` fields; '' clears (null); chip/header roles refresh (cache
  invalidated). The semantic layer is human-editable — was JSON-only.
- **MULTI-IMAGE** (Wolf-approved): `public.images[]` on content nodes (full
  media objects, rendered as figures in order); image tool grows the gallery
  ("Add image"; empty src removes on save); one-image-per-node stays the
  norm.
- **Gates**: 1205 + 49 tests green (nodes-palette starters validated against
  the REAL node schema + render; ad bank + gallery render tests; the
  upsert_node mint test) · astro check 0 · eslint/prettier clean · build 173
  pages (probe export used for verification, then removed) · **19-assertion
  headless-Chromium drive on the built probe page** (3 ad units + gallery +
  offer + chat render; node gaps; palette wire: upsert_node id-less at
  position 0 → minted placeholder; role editor: hook→proof +
  agentNotes wire + header refresh; gallery rows + Add image + uploads) +
  the 16-assertion Slice-A drive re-run green.
- **Still open in W7.7**: TipTap/rich-text DOCUMENT editing in the panel,
  the /admin/publish re-wire decision (reduced by the legacy-wipe ruling),
  bugs ⑥⑩. NOTE the schema-vintage gate: canvas inserts against production
  need this merged + deployed first.

## Session 2026-07-13 E (CANVAS Slice A: six field-test fixes from Wolf's first live article-canvas session)

Wolf field-tested the canvas on /object-model-demo and filed the first live
feedback (screenshots). Slice A = the six small fixes, shipped same-day; the
structural asks are queued as W7.7 (node palette incl. commercial
blocks + adSlot mockup bank + annotation panel; multi-image block approved)
and the related-grid options slice (manual/random/latest + tile counts).
Wolf's UI rule recorded in 07 §3g: **on-screen information must be what an
editor needs at the moment of action** — a req\_\* id is worthless there; the
block's marketing role is the point. Also ruled: the 83 legacy posts get
WIPED after ~10 are converted as test corpus (own session; no git-history
rewrite), pending Wolf's keeper shortlist.

- **Role chips**: article-block chip + panel header show `Hook · educate`
  instead of the object id — roles read from the draft record (cached fetch;
  the leak rule keeps strategy out of built HTML, so the DOM can't carry it).
- **Image ADD on nodes**: media-less content nodes get src/alt + Upload rows;
  save seeds `{type:'image'}` (content_item only). Before: dead-end "no
  image fields".
- **Panel content-sized** (was pinned to viewport bottom = "opens to max");
  log/form bodies capped + scroll internally.
- **Busy dots** on every wait; send disabled in flight.
- **CTA button**: `not-prose` + `font-sans` — prose-a color had made the
  label invisible (teal-on-teal) and the serif leaked; render-nodes test pins
  the new classes.
- **Print/share under ClientRouter**: re-wire on `astro:page-load`
  (data-wired guard) — swapped-in article pages had dead buttons.
- **Gates**: 1198 + 49 tests green · astro check 0 · build 173 pages ·
  eslint/prettier clean · **16/16-assertion headless-Chromium drive of the
  built site** (mocked admin endpoints): print/share AFTER a view-transition
  nav, CTA computed white-on-teal in Inter, chip/header role text with no
  req\_\* anywhere, media.src/alt + Upload on an empty node, busy dots
  visible-in-flight → removed after reply + send re-enabled, panel bottom
  edge 421/900.

## Session 2026-07-13 D (W7.9 CREDENTIALED RUN: content_item is CONVERTED — the first article object is LIVE with node chips; OQ-W7-1 resolved)

Wolf: "Nothing allows me to see article elements with node chips and edit
options — finish what's opened, recheck W7.8, make sure the MCP connections
are updated … the end goal is to have articles and article publishing
converted from old schema to the new project-wide schema without losing
functionality. Reverse support is not required." Root cause of "nothing to
see" confirmed first: `object_inventory {content_item}` returned **empty** —
the W7.8 canvas machinery was built and merged but had no article to act on
(W7.9 had never run). This session ran it, op-by-op over the session's live
MCP connection (the same verbs the driver calls):

- **MCP endpoint check**: ping OK; `object_contract('content_item')` serves
  the full W7.3 contract (all six node ops advertised, create_variant in the
  workflow, Tier-1 autonomous publish) — the deployed server needed no
  update; only the store record was missing.
- **SEED BUG found + fixed (the run's one surprise)**: `object_create` was
  blocked by `article_taxonomy` — the seed's `skin-science` category doesn't
  exist in the production `tax_drlurie` registry (it's a TAG there) and
  `skincare-education` exists nowhere. The local rehearsal couldn't catch it:
  the check is registry-gated and the isolated local store has no registry.
  Seed now carries `reflections`/`reflections` (playbook reality-check gained
  the trap note). Store ≡ seed ≡ export holds.
- **The run**: create `req_agent_object_model_demo_20260713_01` → checkout →
  ONE batch patch drilling all six ops (set_article_meta ×2, upsert_node,
  update_node on copy AND `private.strategy` hook→summary, set_node_visibility,
  move_node ×2, remove_node) ending **byte-identical** (history carries every
  exact-inverse capture; the client timed out mid-patch but the server had
  applied — object_get confirmed before proceeding) → validate: eligible,
  zero blockers (slug unique across the 83 committed posts) →
  `create_variant` dry-run: eligible, node ids re-minted, claims node_ids
  re-pointed, lineage set, nothing persisted → publish: export commit
  `60cd213` (`src/data/site/articles/…01.json`) → checkin → inventory returns
  it (published_content_revision 10, no unpublished changes) → release:
  build fired once, confirmed `released: true`, deploy `6a54cf0d…` ready at
  11:42:57Z. **All five conversion criteria hold — content_item, the ninth
  and final governed type, is CONVERTED. Forty-one objects converted total.**
- **W7.8 RECHECKED on the real export** (main fast-forwarded into the
  branch): build 173 pages (was 172); `/object-model-demo` carries all five
  `data-cms-node-id` wrappers + the object id (the chip anchors are in the
  shipped HTML); zero strategy vocabulary in output (leak rule); the article
  joined library + RSS automatically; edit-mode `targets.ts` maps
  `data-cms-node-id` → `update_node` scoped patches. Suite 1198 + 49 green ·
  astro check 0 errors. **What Wolf sees now**: enter edit mode on
  /object-model-demo → every block has a chip (pencil + node-scoped ✨);
  legacy .md articles still have body chips NOWHERE by ruling (only
  page_article furniture + chrome) — that is design, not drift.
- **Rulings recorded (plan §0.5 + §7)**: **OQ-W7-1 RESOLVED — reverse
  support is NOT required.** No alias layer; MCP tools/functions may be
  updated, changed, or retired as the remaining phases land; what must
  survive is FUNCTIONALITY on the object substrate (drafting workflow,
  publish safety stack, admin editor). W7.5's scope is re-pointing internal
  surfaces + retiring/re-pointing the ~31 legacy tools, not aliasing them.

**Still open (each its own session per the phase discipline)**: W7.2
(sections onto rich text, DOM-equivalence gate), W7.5 (reduced: re-point
`/admin/library` toggle + admin patch paths to object verbs; retire or
re-point the legacy `save_json_blob_*`/publish-article tool surface — the
5-agent workflow state moves into `body.workflow` per plan §3.4), W7.7
(admin editor on rich text + visible annotation panel + document-body
canvas/TipTap editing — today plain-text node bodies are the editable
canvas surface), OQ-W7-3 (strategy registry go/no-go, design in plan §2.5).
Standing caveats: unpublish unsupported (OQ-2 — the demo article stays live
until edited); the three shop products still await Wolf's approval in
/admin/objects.

## Session 2026-07-13 C (INCIDENT: agent images broke the production build — raw artifact keys in render fields; guardrail + heal)

Wolf: an agent-triggered build failed — "It had an image as part of its work.
this image was saved correctly in the blob store but it might have failed at
time of build." Root cause (Netlify log): the `Publish page: page_shop_preview`
agent run set the page's `content_split.images[].src` AND `seo.ogImage` to the
RAW artifact blob key `image/req_publish_premium_skus_20260713_01/<sha>.png`.
A raw Major-Key key is servable ONLY at its public path
`/img/<id>/<sha>.png` (the `/img/*` → `get-public-image?blobKey=image/:splat`
redirect); the raw form is neither a URL nor an imported asset, so Astro's
`getImage` on `ogImage` threw **`LocalImageUsedWrongly`** and failed the ENTIRE
static build (a plain `<img src>` like content_split just 404s silently). The
canvas image tool already stores the correct `/img/...` form; this agent used
the raw artifact-upload key. **Not caused by the W7/shop conversions** — a
standing gap: the OBJECT pipeline had no analogue of the ARTICLE pipeline's
`rawImageArtifactReferencePattern` guard (`publish-article.ts` hard-throws on
raw refs), and `checkArtifactTrust` only inspects `*AssetRef` fields (which
LEGITIMATELY hold raw refs — resolved/unrendered), never `src`/`ogImage`/`href`.

Fix (the trap-14 pattern — heal + guardrail):

- **Guardrail** (`checkRenderableImageRefs`, wired into the `renderability`
  group; contract constraint `render_image_ref`): a raw Major-Key artifact key
  (`image|pdf/{id}/{sha}.{ext}`) in ANY string leaf that is NOT a raw-ref
  carrier (`*AssetRef` or product `fulfillment.artifact_ref`) and not private
  `notes` is a BLOCKER at patch/create/publish — the message names the field
  AND the exact public path to use (`publicPathForArtifactRef`, the one
  exported `image/→/img/`, `pdf/→/pdf/` helper in artifact-trust.ts). So the
  broken store record CANNOT republish until fixed, and this class can't
  recur through the store.
- **Heal** (fix-forward, quarantine-safe because of the guardrail): the
  committed exports corrected in-repo — `page_shop_preview` images+ogImage →
  `/img/...`; the SAME scan also caught a PRE-EXISTING sibling bug the guard
  now covers: `pdf/...` raw keys in `kind:'asset'` "Download Starter PDF" link
  `target.href`s on `page_home` (×3) and `nav_header` — relative `pdf/...`
  hrefs 404 from any non-root page (nav is everywhere) → healed to `/pdf/...`.
  The store records still carry the raw values and now can't republish until
  an agent fixes them (the validation error tells them exactly what/how) —
  needs a store-side `object_patch` + publish per object (page_shop_preview,
  page_home, nav_header), no credentialed heal spent on it here.
- Gates: 1198 + 49 tests green (7 new: the helper + guard exemptions/blocks) ·
  astro check 0 · eslint/prettier clean · **production build REPRODUCED green
  (172 pages, the LocalImageUsedWrongly throw gone)**. Benign standing log
  line: the empty `articleObject` collection warns until the first article
  object export lands (W7 dir has only `.gitkeep`) — non-fatal.

## Session 2026-07-13 B (W7.3 + W7.8 BUILT: content_item is the ninth governed type; article bodies on the canvas — awaiting the credentialed run)

Wolf: "Finish W7 rich text with article migration. The committed posts can be
ignored, they are mostly junk and are not worth the effort. The article
section has to have canvas edit-mode overlay. Articles and human engagement
is of the most value, so they need to be converted in full … it is important
that not only basic attributes are attached to every article block but
context attributes related to it being a hook, agitation or a resolution.
Like in the original architecture." Three plan supersessions recorded (plan
§0 updated): **W7.4/W7.6 are WAIVED** (no migration of the 83 committed .md
posts, no DOM-equivalence harness over them — they stay on the legacy
pipeline untouched, OQ-W7-5 moot); **W7.8 canvas is mandatory in-wave**; the
node annotation layer is non-negotiable (already the plan's prime rule).
Recon first (Wolf suspected doc drift): main had gained canvas sessions P/Q/R
(#425 put chips on article-page SECTIONS + chrome, explicitly stopping at the
body) and W7.1's substrate — but `content_item` was still refused by every
verb. That gap is what this session built:

- **`content_item.v1` body schema** (`src/schema/bodies/content-item-v1.ts`):
  node envelope OUTSIDE, rich text INSIDE (plan §2.2). The semantic layer is
  IMPORTED from `article-content-v1.ts`, not copied — `private.strategy`
  (hook/agitation/context/…/resolution/summary), `intent`, `commercial`
  (offers/disclosure/rel/adSlot), `rendering`, `chat`, 3-state `visibility`,
  opaque `n_*` ids (forbidden-word rule kept). `public.body` is
  `string | rich_text.v1 document` (string = plain text, escaped; blank line
  = paragraph). Envelope: slug/title/deck/description/image/taxonomy/seo +
  the judge/score substrate — editorial, emotional_strategy, sources, claims
  (node_ids-wired), compliance, lineage {parent_content_id}, typed
  `scores[]` {scored_by, at, framework, dimension, score, rationale} (§2.4).
- **Ninth governed type end-to-end**: `governedObjectTypes` + approval config
  (Tier 1 = autonomous under the master, OQ-W7-4 — gate it any time with one
  config pin), create (dated `req_agent_<topic>_<yyyymmdd>_01` minting —
  req\_\* ids keep artifact trust intact §1.6), the **node op family**
  (set_article_meta + upsert/update/move/remove_node + set_node_visibility;
  exact inverses via the section-family mechanics; "mark this block a hook"
  is ONE op: `update_node {fields:{private:{strategy:'hook'}}}`),
  **`create_variant`** verb + `object_create_variant` MCP tool (node ids
  re-minted deterministically, claims/compliance node_ids re-pointed,
  lineage set, scores reset, slug uniqueness enforced; `dry_run` for
  zero-residue production proofs), materializer →
  `src/data/site/articles/{req_id}.json`, publish/release through the
  standard pipeline, full contract (annotations contract-visible).
- **Validation**: schema; taxonomy category/tags resolve as REGISTRY SLUGS
  (store resolver now matches slug or term_id, aliases followed;
  registry-gated like the W3 hook); article slug unique across article
  objects AND committed posts (one permalink space; `isArticleSlugTaken`);
  node-id uniqueness; ≥1 public content node publish-gated; rich-text bodies
  restricted to the RENDERABLE grammar (prose + quotes; embeds blocked until
  their resolvers exist — trap-5 discipline) + https-only hyperlinks;
  **reader safety runs on the READER PROJECTION** (public fields of public
  nodes) so the annotation layer is legal record data while a strategy word
  in public copy still blocks; deploy-safety walks everything incl. notes
  (the export commits to the repo).
- **Render path**: published article exports join `fetchPosts()` as
  first-class posts (listings, categories, tags, related scoring, RSS,
  search — no per-surface wiring) via a new `articleObject` collection
  (generateId pinned: bodies carry `slug`, the S2 lesson) and ONE node
  renderer (`src/lib/article-object/render-nodes.ts`) into the article
  route's dormant `set:html` branch — SinglePost furniture, SEO merge, and
  page_article extras all unchanged. Never-render-private: internal/hidden
  nodes emit NOTHING; the leak rule is test-grepped (no strategy vocabulary
  in output). Offers render with disclosure + rel (bug ② partially paid);
  unsafe hrefs degrade to text; hero image via `body.image` (bug ③);
  reading time computed to the md convention.
- **W7.8 canvas (the OQ-8 stop line lifts)**: every rendered node carries
  `data-cms-node-*` identity; node chips (pencil + sparkles; image tool on
  content nodes) ride the SAME EditSession → `update_node` → pending tray →
  publish/release path as sections. Ask-AI gains NODE SCOPE
  (`ask-ai-object.ts`): tool = the node's PUBLIC copy grammar with
  protected-field strip (+`ctaLink`), a document body is excluded (no
  flattening), and the node's strategy/intent flow INTO the prompt ("write
  copy for a hook") but never into the suggestion. The legacy article Ask-AI
  (admin-ask-ai-node, workflow records) is untouched.
- **Driver + seeds**: `articleDrillOps` (probe node cloned/poked — copy AND
  annotation — hidden/moved/removed, byte-identical end), create_variant
  dry-run proof (the instantiate pattern), content_item materializer
  dispatch, and `scripts/lib/articles-seed-data.mjs` — one honest
  demonstration article (full PAS-ish arc of annotated nodes + a
  node-wired claim) at slug `object-model-demo`.
- **Gates**: 1195 + 49 tests green (~60 new; 8 old posture pins deliberately
  flipped) · astro check 0 errors · eslint/prettier clean · **build-diff
  EMPTY (173/173 identical)** — with no article exports the change is
  render-inert · probe-export build verified in dist (article page + node
  wrappers + zero leaks + listing/RSS inclusion), then removed · **local
  rehearsal ALL GREEN** (ensure → 6/6 ops → validate → publish blocked at
  the expected sandbox boundary → variant dry-run → contract 6/6 advertised
  ≡ exercised → inventory).

**Status: BUILT + REHEARSED, not converted.** The credentialed run flips it:
`node scripts/home-conversion-roundtrip.mjs --production --release --seeds scripts/lib/articles-seed-data.mjs`
(schema-vintage gate applies — merge + deploy main first). Standing caveats,
named honestly: (1) **unpublish is still unsupported (OQ-2)** — once the demo
article publishes + releases it is live at /object-model-demo until edited;
the run may stop at the drill (criteria 1–4 proven, record stays draft) if
that's unwanted. (2) Rich-text DOCUMENT bodies exist end-to-end but have no
canvas/TipTap editor yet — plain-text bodies are the editable v1 surface;
W7.2/W7.7 (sections onto rich text; the admin editor + annotation panel +
embeds) remain open, as does the OQ-W7-3 strategy-registry go/no-go and the
W7.5 alias layer (legacy tools untouched this session; the ~31 article tool
names still serve only the .md pipeline). (3) A locally deleted article
export needs `node_modules/.astro` cleared (dev-cache only; CI/Netlify build
clean).

## Session 2026-07-13 (W5 CREDENTIALED RUN: the three hand-coded pages are CONVERTED — the hand-coded-page backlog is EMPTY)

Wolf ran the credentialed `--production --release` driver against the live
MCP endpoint with `scripts/lib/pages-w5-seed-data.mjs`. Result (verbatim
from the run): `page_shop_preview`, `page_pricing`, `page_services` each
`ensure created → drill every permitted op → published`, then
`contract page 6/6`, `inventory` returns all three, and
`release_to_production — live at commit`. **All five conversion criteria now
hold for the three pages** (rendering was proven in `dist` at build time —
172 pages, tiers showing $19/Free/Pay-what-you-want — the public URL is
still 403 behind the pre-launch `SITE_NOT_YET_LIVE` gate, so store-side
proof is the driver's own published+released+inventory, not a public
fetch). The server committed the page exports to main
(`Publish page: page_{shop_preview,pricing,services}`). This closes the
plan's "after S2/S3" conversions — **every routable page on the site now
renders from a page object; zero hand-coded page routes remain.**

Still open (unchanged, all Wolf-side): the three MOCK products
(`prod_barrier_repair_guide`, `prod_starter_checklist`,
`prod_support_the_work`) stopped at `approval_required` exactly as the
review-required gate intends — approve each in /admin/objects and re-run
the same idempotent command to convert them too. Launch gates: the LIVE
Stripe test-mode exit run (needs STRIPE_MODE + both key pairs +
PURCHASE_TOKEN_SECRET), PUBLISH_SECRET rotation, and the
`SITE_NOT_YET_LIVE` flip. Docs flipped in this same change: object-inventory
§1 (SEEDED → CONVERTED) and conversion-map (HAND-CODED PAGES node + W5 row).

## Session 2026-07-12 R (CANVAS Tier-1 surfaces: article pages, chrome, related-articles dropdown)

Wolf: "Article publishing Tier 1 after conversion does not have canvas mode …
apply the same treatment to the article and other tier one objects like
headers, footers … A set of 'other articles to read' below an article can
have an AI option and a simple choice of existing selection algorithms
through a stylish dropdown … inline with AI action button." Shipped on the
canvas branch (PR #425):

- **`content_grid` `related` source kind** (generalize-don't-replicate):
  `{kind:'related', algorithm: tag_similarity|same_category|latest}` —
  tag_similarity = the existing related-posts scoring, extracted pure as
  `rankRelatedPosts` (utils/blog.ts, single source of truth); anchored to
  the current post via a new resolve context (article route passes
  `relatedToPostId`), newest-first degradation elsewhere. Related-grid
  titles link to posts; query/manual grids keep audited unlinked markup.
- **Chip algorithm dropdown**: a related grid announces its algorithm via
  `data-cms-related-algorithm`; the chip renders a compact chip-native
  select inline with the sparkles; change → checkout →
  `update_section_data {source:{kind:'related',algorithm}}` draft.
- **Article pages get canvas**: `ObjectSections` leaves a zero-height
  `data-cms-empty-object` marker on object-empty pages; the gap layer turns
  it into one add "+" → the FIRST page_article section is addable from the
  canvas ("Related articles" joined the palette — the one reference-free
  content_grid starter). An object-backed related grid REPLACES the
  hardcoded RelatedPosts furniture; absent one, byte-identical legacy. The
  article BODY stays Tier-1 (OQ-8 line; /admin/publish).
- **Chrome**: Header/Footer wrapped in `data-cms-nav-object` (PageLayout +
  PageObjectRenderer footer override). Chip marked site-wide, pencil-only →
  copy form (item labels incl. children, group titles, brand, footNote)
  from pure `nav-editor.ts`; saves map to the NAV grammar — update_item,
  upsert_group (replace-by-id, current group rides along),
  remove_action+upsert_action renames, coalesced set_nav_meta — via
  EditSession('navigation'). Local body kept in step
  (`applyNavChangesToBody`) so sequential saves never resend stale groups.
  Targets/hrefs/icons excluded (structural = protected boundary); no AI
  chat on chrome.
- **Gates**: 11 new tests (related resolver + degradation + schema-valid
  page; annotation announces algorithm and only for related; nav-editor
  flatten/ops/throw/apply incl. every-op-legal check; palette related-only
  content_grid rule + empty-anchor append), suite 1159+49 green, astro
  check 0, build 172 pages, drive 60 assertions (nav chip site-wide/no-AI,
  nav grammar op on save, dropdown value + inline-with-AI + patch wire
  shape + annotation update, empty-marker "+" → palette targets
  page_article → upsert_section related grid). Docs: 07 §3f.
- **To make it real on production**: enter edit mode on any article page,
  click the "+" below the article, pick "Related articles", publish +
  release (the store write happens through the verbs; no code or seed
  needed). Header/footer copy edits work the same day-one.

## Session 2026-07-12 Q (CANVAS panel UI: icon-led collapsible accordion)

Wolf: "make the modal UI collapsible accordion. use less text and more
representative iconography. be focused on style and UX … do not use colors
that are outside of a current Astro schema." Shipped on the canvas branch
(PR #425):

- The docked panel is now one **accordion**: three icon-headed sections
  (✨ Ask AI / ✏️ Edit text / 🖼 Image), one expanded at a time (open one
  grows, rest collapse to a head + chevron). Chip tools open their section;
  accordion heads switch tools in place; clicking the open head collapses to
  a compact rail. Image section only shown for image-bearing types.
- **Iconography over prose**: identity = type + monospace id + tiny
  shared/draft dots (no sentences); actions are icon buttons w/ tooltips
  (check=save, undo=discard, plane=send, up-arrow=upload); sys/log lines
  terse + glyph-prefixed; field hints one-liners. Tray text trimmed too.
- **Palette discipline**: every color is a project `--aw-*` token via the
  `--dlem-*` layer — nothing bespoke; light/dark flips with the site.
- Structure preserved: same modes/data-hooks (`data-em-*`, `.dl-em-mode-*`),
  so the verbs/tests are untouched. Gates: astro check 0, eslint/prettier
  clean, suite 1148+49 green, build 172 pages, drive extended to 49
  assertions (3-section accordion, AI expanded/others collapsed, icon-only
  send, head-switch collapses previous, open-head collapse). Docs:
  07-canvas-editing.md §3e.

## Session 2026-07-12 P (CANVAS image tool v2: array images, blob-backed uploads, AI image references)

Wolf, on the Codex array-image finding + storage: "Close the gap. Also, those
images also need to be stored in blobs for edits and other manipulation as
happens now with pdf-tool. Same goes for About image or any other image."
Shipped on the canvas branch (PR #425):

- **Array images (Codex gap closed)**: the image tool now renders image
  ARRAYS (`content_split` `images: [{src,alt}]`) — one src/alt pair per item;
  save copies the array and patches it wholesale (deep-merge replaces arrays),
  editing only the touched item. `content_split` joins `bio` in
  `IMAGE_SECTION_TYPES`.
- **Blob-backed uploads (pdf-tool pattern, zero new write paths)**:
  - `admin-artifact-upload-intent.ts` (+ pure core
    `netlify/lib/canvas-upload-intent.ts`): admin-gated mint of the EXISTING
    HMAC upload token; server controls the claims — `requestId =
req_canvas_<object>_<yyyymmdd>_01`, kind `image`, filename from content
    type; JPEG/PNG/WebP only (what save-side sharp validation accepts).
  - Bytes go to the same `/api/artifacts/upload` agents use (re-verifies
    size/sha256/decodability against the signed claims); content-addressed
    keys `image/<requestId>/<sha256>.<ext>`.
  - **Public serving**: `/img/*` → new `get-public-image.ts`, the image
    mirror of `get-public-pdf.ts` — extension allowlist, immutable cache
    (content-addressed), CSP + nosniff. Sections carry the root-relative
    `/img/…` path (deploy-safe; renders through existing components).
  - Canvas: each src row gets an **Upload** button
    (`uploadImageArtifact` in `verbs-client.ts`: crypto.subtle sha256 →
    intent → tokened byte POST → fill src). Upload is storage-only; the src
    change still walks checkout → patch → publish → release.
- **AI image references ("Re: portrait.png", same session, Wolf)**: the AI
  chat on an image-bearing section shows image chips; arming one (a) ensures
  the image is blob-backed — existing repo images (`/images/…`) are
  **mirrored into the artifacts store** via the same pipeline, storage-only,
  src untouched — and (b) sends `image_ref {field, name, url}` with every
  ask. The section prompt gains a "Re: <name> — publicly served at <url>"
  clause (the public URL is the handle external image-editing tools need).
  Copy-only guard unchanged: image fields still never survive a suggestion.
- **Gates**: 15 new tests (intent mint/round-trip/rejections; public image
  route incl. real underscored canvas keys + 404/405/allowlist; image_ref
  prompt clause + guard-still-strips + optionality), full suite 1148+49
  green, astro check 0, build 172 pages, drive extended to 42 assertions
  (upload wire shapes; chip → mirror → armed pill → image_ref on the wire).
  Docs: 07-canvas-editing.md §3c/§3d.
- **Env note**: the intent endpoint needs `ARTIFACT_UPLOAD_TOKEN_SECRET` —
  already configured (the pdf-tool upload path uses it).

## Session 2026-07-12 O (CANVAS manual tools: icon toolbar, field editor, image tool, gap "+" add)

Wolf: "add text edit tools to each relevant object … remove the wording Ask AI
and replace it with an icon [stars slightly brighter] … other objects may
require uploads or other tools … hovering between objects [show] an Add
symbol." Shipped on the #423 branch (same canvas scope as the guard):

- **Chip → icon toolbar**: pencil (Edit text), image tool (types with image
  fields — `bio`), and an icon-only sparkles whose stars use `--dlem-spark`
  (site gold lifted toward white) so the AI action reads a notch brighter
  than the other tools. Tooltips carry the words; no "Ask AI" text.
- **Manual field editor** (pencil): copy fields only (same non-copy exclusion
  the AI guard enforces), Save draft → checkout → `update_section_data`,
  in-place preview, publish separate. **Image tool**: src/alt + live
  thumbnail — the deliberate image-change path (AI stays schema-blocked);
  also Wolf's in-canvas fix for the About portrait. Upload = later slice.
- **Gap "+"**: subtle round + above/between/below a page object's sections →
  compact palette (`sections-palette.ts`, pure; starters proven schema-valid
  - splitter-safe in tests) → `upsert_section` at a record-derived position
    (hidden-section safe, anchored by id), server-minted id, honest annotated
    draft placeholder in place until publish + release.
- Fixed en route: `.dl-em-actions[hidden]` was overridden by its own
  display:flex (the Accept row showed empty on fresh panels).
- **Gates**: 1104 + 49 tests (palette starters validated against the REAL
  section schema + splitters; insert-position math), astro check 0, build
  172 pages, headless drive extended to 25 assertions (icon toolbar, manual
  edit patch shape, image tool patch shape incl. alt preservation, gap add
  upsert wire shape + placeholder) — all green in both themes.

## Session 2026-07-12 N (CANVAS bug: copy-AI dropped an image — copy-only guard added)

First real production incident from the canvas, reported by Wolf: an AI edit
to the /about intro (heading → add "Ph.D") also **silently swapped the bio
`portrait.src`** from the working local `/images/dr-lurie-portrait4.jpeg` to a
hallucinated `https://kugelmedia.netlify.app/drlurieblog/dr-lurie-portrait.jpg`
(the model echoed the `kugelmedia.netlify.app/drlurieblog/` CDN pattern it saw
elsewhere in site data + a plausible filename). Published as `36b060c`, it
broke the About portrait — and was the "change I did not make." (The three
`prod_*` rows in Wolf's pending tray were unrelated: shop products the
inventory `pending_changes` filter surfaces, not canvas edits.)

**Root cause**: the section-scoped Ask-AI exposed the section's FULL data
schema — including media/asset/reference fields — to the model, and applied
whatever it returned (deep-merge). An LLM will hallucinate URLs.

**Fix (copy-only guard)**: `isProtectedAskAiField` (`ask-ai-schema.ts`) names
the non-copy fields — media/asset (`portrait`, `*AssetRef`, `logo`, `icon`,
`ogImage`, `src`…), references/bindings (`source`, `products`, `contentItem`,
`section`, `formName`, `actions`/`links`…), structure/routing (`route`,
`sections`, `slug`, `anchor`…). `deriveAskAiToolSchema` gains `protectFields`
(set on the canvas section path, off for whole-object admin asks) that strips
them from the tool schema, plus a defensive re-strip of the suggestion in
`ask-ai-object.ts`. The copy AI now edits **text only**. 1093 + 49 tests
(27 ask-ai, incl. a hallucinated-portrait regression test), astro check 0,
eslint/prettier clean. **Follow-ups**: (1) restore the live portrait to
`/images/dr-lurie-portrait4.jpeg` on `sec_about_intro` (inner id `s_intro`) —
needs the production key; (2) the canvas has no manual (non-AI) field editor,
which is now the only sanctioned way to deliberately change an image — worth
building next.

## Session 2026-07-12 M (W7.1 BUILT: the rich_text.v1 substrate — schema + renderer + ProseMirror mapper, inert by design)

Same session (PR #422 — the W7 plan — merged; branch restarted). Wolf's
rulings recorded first: **articles keep Tier 1** (OQ-W7-4 resolved, plan §7
updated on the PR before merge) and the expanded `strategy_drlurie` registry
design shipped into plan §2.5 (go/no-go still open). Mid-session directive
recorded: **canvas editing belongs to ANOTHER session** — articles are not
canvas-wired yet (they aren't objects yet at all); W7.8 is reassigned to that
session's owner when the wave gets there. Nothing canvas-adjacent was touched
here.

W7.1 per the plan, all three substrate pieces in `src/lib/richtext/`:

- **`rich-text-v1.ts`** — the zod mirror of Contentful's node tree
  (`@contentful/rich-text-types` constants are the name source), restricted
  to the house universe: p / h2 / h3 / ul / ol / li / blockquote /
  embedded-entry-block / embedded-asset-block; marks bold + italic;
  hyperlink inline (uri pinned whitespace-free). Per-field narrowing is a
  **`RichTextGrammar`** (enabledNodeTypes/enabledMarks — the D§3.5
  allowlist-becomes-declaration), with the three presets that mirror today's
  splitter vocabularies: INLINE_COPY (p-only fields), PROSE (prose.body),
  ARTICLE_BODY (adds quotes + embeds, the W7.3 target). `data` on every node
  is the annotation carrier — nothing writes to it in this phase.
- **`render-html.ts`** — build-time renderer over
  `@contentful/rich-text-html-renderer` (v17): marks emit the house
  `<strong>`/`<em>` (not the lib's b/i), embeds REQUIRE injected resolvers
  and throw naming the target when absent (never-silently-drop), input is
  schema-validated first, `node.data` never reaches HTML (leak-rule test
  greps the output), and `\n` in text values renders as `<br/>` via a
  post-pass (v17 ignores `renderText`; safe because the lib emits no
  formatting newlines and uris are whitespace-free by schema — verified
  empirically, incl. default text/attribute escaping).
- **`prosemirror.ts`** — the ONE TipTap/ProseMirror ↔ rich_text.v1 mapper
  (W7.2 editors + W7.7 article editor share it): heading levels 2–3, lists,
  blockquote, bold/italic; link MARKS ↔ hyperlink INLINE nodes (consecutive
  same-href runs merge, split back on return); hardBreak ↔ '\n'-in-value;
  everything outside the universe throws naming the type. Structural types
  only — no editor package imports in the build graph.

Gates: **1116 + 49 tests green** (27 new across three test files, incl. both
round-trip directions and the leak rule) · astro check 0 errors ·
eslint/prettier clean · **build-diff EMPTY (173/173 identical)** — the
substrate is used by nothing, exactly as specified. New deps:
`@contentful/rich-text-types`, `@contentful/rich-text-html-renderer`.
NEXT: W7.2 (section body fields accept string | document; one-time export
conversion; TipTap emits rich text) — DOM-equivalence gate, own session/PR.

## Session 2026-07-12 L (W7 PLANNED: OQ-8 RESOLVED as one-time migration — articles onto the object model + Rich Text; plan doc, not code)

Wolf opened the article wave ("let's move with articles W7. be careful, I
need the functionality developed for article publishing") and answered the
four forks in-session — **OQ-8 is resolved: (1) one-time MIGRATION to
ObjectRecords** (adapter path retired), (2) **build the Contentful Rich Text
substrate now** (core-structure tasks 1–5, confirmed never built — sections
use TipTap-HTML strings + splitters today), (3) canvas-for-articles in-wave
if it fits, (4) plan doc first per the shop precedent. His preservation
directive is the wave's prime rule: the `article_body.v1` semantic layer
(per-node `private.strategy`/`intent`, commercial metadata + disclosure,
chat, opaque ids, input templates; envelope-level emotional_strategy/claims/
sources/compliance/scoring slots) exists so "agents can judge, score and
build variants quickly" — it must come out of W7 MORE agent-usable, never
flattened.

**The plan is [`08-articles-plan.md`](../08-articles-plan.md).** Spine:
`content_item` = ninth object type keeping `req_*` ids verbatim (artifact
trust/blobKeys survive unchanged); body = **node envelope outside, Rich Text
inside** (a hook can span paragraphs — the node grouping IS the behavioral
structure; `public.body` upgrades string → `rich_text.v1` document); one
renderer for build/admin/canvas; `create_variant` + typed `scores[]` as the
A/B substrate (serving/traffic-split explicitly out of v1); the ~31 article
tool names live on as thin aliases over object verbs (external agent configs
call them by name); 5-agent workflow state moves into `body.workflow`;
per-article cutover flags + a DOM-equivalence harness (83 committed posts
keep URLs and rendering); the `workflows` store retires read-only as the
rollback source. Ten-bug register dispositioned (recon this session; nothing
was in the issue tracker): ①⑦⑨ die structurally, ② becomes the renderer
feature matrix (offers/adSlots/chatInvite/PDF media render for the first
time), ③④⑤⑥⑧⑩ are named phase tasks. Phases W7.1–W7.9, each its own
session/PR; six OQ-W7 checkpoints for Wolf (alias sunset, variant serving,
strategy vocabulary as a `strategy_drlurie` registry vs code enums, Tier 1
posture, `.md` retirement, credentialed workflows-store inventory). §3.10's
freeze lifts only inside the approved phases. NOT in this session: any code —
W7.1 (rich_text.v1 substrate) starts on Wolf's approval of the plan.

## Session 2026-07-12 K (CANVAS Ask-AI runs on OpenAI; retheme + review fixes landed)

Follow-ups to the merged canvas (PRs #415/#417/#418), each its own PR restarted
from main:

- **Ask-AI provider → OpenAI (Wolf's call: "replace")**: the generic canvas
  Ask-AI (`netlify/lib/ask-ai-object.ts` + `admin-ask-ai-object.ts`) now calls
  OpenAI Chat Completions function-calling with `OPENAI_API_KEY` (already
  configured for ChatKit / the publisher agent) and `OPENAI_MODEL` (default
  `gpt-4o`), replacing the Anthropic Messages call. The zod-derived tool schema
  is plain JSON Schema, so it is the OpenAI function's `parameters` verbatim; a
  forced `tool_choice` keeps the reply structured (arguments arrive as a JSON
  string — parsed before the null-strip). **Provider-only swap**: read-only
  contract, section scoping, shared_ref refusal, and the human **Accept** gate
  are unchanged — the AI still cannot write a field; Accept → object_patch
  (draft) → Publish → Release remain the three human gates. The article Ask-AI
  (`admin-ask-ai-node.ts`) is a separate system, untouched. Both ask-ai test
  files reworked to the OpenAI wire shape; 23 ask-ai tests + full suite green.
- **Retheme (#418, merged)**: canvas chrome derives every color/font from the
  project's `--aw-*` design tokens (auto-flips light/dark); no hardcoded purple.
- **Review fixes (#417, merged)**: lapsed-token sessions keep the canvas;
  listing-page headers carry editing chips.

Gates for the OpenAI swap: 1089 + 49 tests, astro check 0 errors, build 172
pages, eslint/prettier clean. Not yet exercised against the real OpenAI
endpoint (same credentialed-run boundary as the rest of the canvas).

## Session 2026-07-12 J (W5 PAGES SEEDED: /pricing, /services, shop-preview — zero hand-coded page routes left; commerce_orders admin tool)

Same session (PR #416 merged; branch restarted). The plan's "after S2/S3"
page conversions, per Wolf's directive ("convert W5 pricing and the other
passed-over pages; agents get full store administration"):

- **Three new REUSABLE section types** (schema → registry → component →
  resolver → validation → editors, the full wiring): `steps` (numbered
  icon cards), `content_split` (kicker/heading/rich body + actions + up to
  2 staggered images — the bespoke shop-preview hero generalized, its
  scoped styles absorbed), `pricing_table` (tiers REFERENCE product
  objects; title/price badge/availability/CTA href resolve from commerce
  data at build — copy never drifts from the store; unavailable products
  render "Coming soon", ghost refs are skipped with a build warning and
  BLOCKED at write by reference integrity).
- **Three page objects, three route files DELETED** (importers verified):
  `page_shop_preview` (/solutions/shop-preview — REAL copy verbatim;
  nav's route-kind links unchanged, same route now object-served),
  `page_pricing` + `page_services` (previously unlinked Astrowind lorem —
  MOCK copy per Wolf's 2026-07-12 directive). All standard pages on the
  object-page catch-all: **the hand-coded-page backlog is EMPTY — every
  routable page on the site now renders from a page object.**
  (`feature_grid` deliberately not minted: content_grid `cards` already
  covers icon grids — design-principles rule 1.)
- **`commerce_orders` MCP tool** (netlify/lib/commerce-admin.ts): the
  support-lookup half of store administration — list orders by
  email/product (newest-first, capped) or fetch full detail by order_key;
  what order_reissue needed to be operable from "customer lost the email".
  Read-only; raw buyer email visible by design (§6 — publish-key surface).
- **BUG FOUND + FIXED (latent since S2)**: Astro's glob loader prefers a
  top-level `slug` field for the entry id — product exports HAVE one, so
  `getCollection('productObject')` ids were the slug, not the object id.
  Every by-object-id lookup against the collection silently failed: the
  BUY BOX embedded the wrong product_id (live checkout would have 404'd
  product_not_found), and pricing_table tiers/manual product_preview picks
  never resolved. Pinned `generateId` to the filename (= object id) in
  content/config.ts; /shop buy flow and tiers verified in dist.
- Seed module prepends the S2 product seeds as reference targets
  (playbook trap 3 — imported from the shop module, one catalog source);
  driver materialize no longer crashes on a never-created object.

Local rehearsal: full lifecycle SUCCESS (ensure/drill/contract/inventory/
materialize ×6; pages block only at export_commit_failed, products at
approval_required — both expected terminals). Suite 1089 + 49 green; astro
check 0; eslint/prettier clean; build 172 pages — /pricing, /services,
/solutions/shop-preview all render from objects with resolved tiers
($19/Free/Pay-what-you-want badges live). **Rendered + seeded, NOT yet
converted**: the three pages await the credentialed `--production
--release` run (same run can approve the three products stuck at
approval_required). W5 empties the hand-coded backlog for good.

## Session 2026-07-12 I (S3 SHIPPED: PWYW + free + unlock paths; the two commerce MCP tools — criterion 4 closes)

Same session (PR #414 merged; branch restarted). S3 per plan §9 — the
product type's permitted-action surface is now COMPLETE:

- **`set_product_price` patch op** — the §3 funnel's WRITER, the exact
  complement of set_product_fields' refusal: `fields` restricted BY THE
  GRAMMAR to commerce.price/stripe/stripe_test (shape-pinned); internal
  (`agent_authored: false`, the reactivate_term posture); inverts to itself
  with the captured before-tree = "re-point to the archived price".
- **`product_set_price` MCP tool** (netlify/lib/product-set-price.ts):
  creates the new Stripe Price (immutable prices), archives the old one,
  writes cache + the running mode's linkage in ONE governed
  checkout→patch→checkin — cache ≡ what Stripe just created, by
  construction. Bootstraps a Stripe Product for unlinked products. Does NOT
  publish: the change waits for the §0.4 human approval.
- **`order_reissue` MCP tool** (netlify/lib/order-reissue.ts): regenerates
  a download link from the ORDER record alone (orders now store
  `fulfillment.artifact_ref` — §5's "fulfillment is a pure function of the
  order record" made literal; S1c-era orders fall back to the product's
  current ref). Audited reissue entries {at, token_hash, by} + a
  fulfillment_reissued event; ttl 1h–14d.
- **PWYW checkout**: the buyer picks the amount; create-checkout-session is
  the minimum-enforcement point (§3 — no Stripe Price exists; price_data
  charges the chosen amount against the linked Stripe Product). Buy box
  grew an amount input.
- **Free claim** (netlify/functions/claim-free.ts): direct token issuance
  through the SAME order/event machinery (ord*free*…, session null, amount 0) + the lead-capture tie-in (optional email → the opt-ins store). Buy
  box: "Get it free" renders the download link inline.
- **Unlock kind**: checkout requires an EXISTING pre-generated artifact
  under the product's unlock_prefix (nobody pays for a ghost); the webhook
  mints the token over exactly that key. The buy box keeps unlock products
  unbuyable until the artifact-generator integration exists.
- Drill: fixed products now exercise BOTH ops (price poked one cent,
  restored byte-identical); the driver unions exercised ops per type for
  the contract check. Local rehearsal: contract product 2/2 — **criterion 4
  is fully closed for the product type**.

Suite 1061 + 49 green; astro check 0; eslint/prettier clean; build 172
pages. The shop plan's §9 critical path (S1a→S1b→S1c→S2→S3) is now fully
built. Remaining, per plan: the credentialed production run (products stop
at approval_required → Wolf approves), the LIVE Stripe exit test (launch
gate, needs keys), and the after-S3 page conversions (/pricing with
pricing_table; /services + shop-preview with mockup copy per Wolf's
directive).

## Session 2026-07-12 H (CANVAS SHIPPED: the site is the editing surface — admin inline Ask-AI, draft-in-place, publish/release tray)

Wolf approved the edit-mode canvas plan ("go on and start work on this,
layering phases over preexisting conversion steps; stop at the article
publishing engine; ignore the old admin editor in favor of this UX") after a
feasibility/UX write-up + interactive mockup. Shipped in four commits on
`claude/admin-inline-ai-editing-trkigv` — full doc:
[`07-canvas-editing.md`](../07-canvas-editing.md).

- **Section identity in the built HTML**: both dispatch sites wrap every
  section in a `display:contents` element carrying
  `data-cms-object-id/-section-id/-section-type` (+ `-shared-object` for
  shared*ref derefs — `resolveSections` now keeps the `sec*\*`id on`RenderableSection`). No box, no layout change; ObjectSections gained a
required `objectId` prop (threaded from the 6 listing routes).
- **Section-scoped Ask-AI (additive)**: `admin-ask-ai-object` takes
  `section_id` (pages) — tool derived from the section type's own data
  grammar (`sectionDataSchemaForType`, generic over the union), suggestion
  maps 1:1 onto `update_section_data`; shared_ref scopes are refused with the
  target id; section OBJECTS auto-scope to their inner instance. Read-only as
  ever; content_item still refused (article Ask-AI untouched — the stop line).
- **The overlay** (`src/lib/edit-mode/`): dormant 1.5KB loader in Layout →
  GoTrue + server-side admin-auth-state gate → 27KB code-split editor for
  admins only. Hover chips (✨ Ask AI, selection-aware, shared/draft flags),
  docked panel diffing against the DRAFT record, conservative in-place
  preview (real splitters; honest fallback to panel diff), Accept →
  checkout → patch via shared LockManager (`EditSession`; 409-retry, 422
  blockers surfaced, foreign locks named), pending tray fed by
  `inventory {pending_changes:true}` with per-object Publish and Release.
  Draft state survives reloads (amber framing on load).
- **Gates**: 1071/1071 tests (+~45 new: annotations, scope, target routing),
  astro check 0, build 167 pages, **headless-browser drive of the real built
  site end-to-end** (dormant visitor path verified — zero admin calls/chunk;
  full edit flow wire shapes asserted; one real bug found+fixed by the drive).
  Build output now differs from pre-canvas builds by the inert data-cms-\*
  attributes only — sanctioned, one-time.
- **NOT done (deliberate)**: articles on the canvas (W7/OQ-8 — Wolf's stop),
  structural ops UI (add/move/remove/meta), OQ-9 SSR draft preview, W7 rich
  text itself (next conversion wave), and the credentialed production
  walk-through of one canvas edit (sandbox boundary — same as every
  conversion; suggest page_thank_you first).

## Session 2026-07-12 G (S2 BUILT + SEEDED: /shop catalog + product pages, mock content — awaiting credentialed run)

Same session (PR #413 merged; branch restarted). S2 per plan §4/§9, with
Wolf's mockup-data directive applied:

- **`product_preview` upgraded** from a dead static `ProductCard[]` (no live
  usage) to the M-8 source union over PRODUCT objects: `query` (every
  available product) / `manual` (+query fallback) / `cards` (curated cells).
  `resolveContentGridCards` generalized over the query type (same semantics,
  one owner); resolvers load available products from the new `productObject`
  collection ONLY when a section needs them (the dynamic-import chunk rule);
  mode decides the price badge ("$19" / "Pay what you want" / "Free").
  Manual picks validate through reference integrity (`requireObject
'product'`).
- **`/shop`** — NO route file: `page_shop` (standard) is the FIRST page
  served by the object-page catch-all in production use (the zero-code
  promise cashed in). Its grid is a `query` source, so newly published
  products appear with no page edit (the design-principles litmus).
- **`/shop/[slug]`** — the SinglePost-shaped loader: paths derive from
  published + AVAILABLE product exports (never-render-private for
  retired/coming_soon), buy box + hero from the product object, page_ref
  sections via ObjectSections, SEO defaults from `page_product_detail`
  (content_detail, the page_article idiom). Buy CTA posts to
  create-checkout-session; PWYW/free products show a disabled "Coming soon"
  until S3. `product_viewed` / `checkout_started` beacons use the
  save-opt-in sendBeacon pattern.
- **Seeds** (`pages-shop-seed-data.mjs`): three MOCK products covering all
  three commerce modes + the two pages. Driver + drill extended for product
  seeds (`productDrillOps` — set_product_fields poke/restore, never the §3
  funnel keys; materialize dispatch). **Local rehearsal ALL GREEN**: every
  permitted op drilled, contract 1/1 + 6/6, inventory 5/5, exports
  materialized and committed. Build: /shop + 3 product pages emit (172
  pages), dist carries the real copy/badges/wiring.
- **The review gate met the driver**: product publishes stop at
  `approval_required` — now recognized as the drill's expected terminal
  signal for gated types (sandbox AND production; the driver never works
  around the gate). The object-page-routes zero-paths pin was updated:
  page_shop legitimately emits through the catch-all now.

Suite 1051 + 49 green; astro check 0; eslint/prettier clean. **Next for the
credentialed run**: driver `--production` creates + drills the five objects,
products stop at approval_required → Wolf approves each in /admin/objects →
publish + release. Then S3 (PWYW/free/unlock + product_set_price +
order_reissue).

## Session 2026-07-12 F (S1c SHIPPED: checkout → webhook → token delivery → success page)

Same session (PR #412 merged; branch restarted). S1c per plan §9 — the whole
paid path for fixed-price downloads, built on S1b's substrate. The official
`stripe` SDK is the one new dependency (§7: session creation + webhook
signature verification; hand-rolling signature checks is malpractice).

- **`purchase-tokens.ts`**: HMAC-SHA256 expiring bearer tokens (72h default)
  embedding `{order_key, artifact_ref, exp}`, signed with
  `PURCHASE_TOKEN_SECRET` (min 16 chars or the endpoints 503). Signature is
  the authorization; order records keep only hashes (audit trail, not an
  allowlist — a fresh status-page token is as valid as the issued one).
- **`stripe-env.ts`** (§8.7): `STRIPE_MODE` picks the key pair (default
  'test' — a missing flag must never charge real cards);
  `stripeLinkageForMode` picks `commerce.stripe` vs `stripe_test`. All four
  key envs + the token secret are in PROTECTED_ENV_KEYS (§8.5). Lazy client
  - injectable test seam.
- **`create-checkout-session.ts`**: buyability gated on STORE state
  (published + active + available + linked); charges the linked `price_id`,
  never the cache (§3); stamps `metadata {product_id, event_id}`;
  success/cancel URLs from the server's own URL env, never a request header.
  v1 = fixed mode only (PWYW/free are S3).
- **`stripe-webhook.ts`**: signature-verified; `checkout.session.completed`
  → `writeOrderIfAbsent` (replays/double-fires no-op) → token minted for
  download kinds → authoritative events with DETERMINISTIC event ids + ts
  derived from the Stripe event, so replayed webhooks collide on the same
  store key and duplicate nothing (§8.2's window closes to true concurrent
  double-fires). §3 amount cross-check flags `amount_mismatch` + event.
  `checkout.session.expired` → idempotent `checkout_abandoned`. Non-2xx on
  store failures so Stripe retries.
- **`get-purchase.ts`**: token-gated streaming of the PRIVATE artifact
  (attachment, no-store) — 401/410/404 ladder, expired = Gone with a
  reissue hint; appends `download_succeeded` (best-effort).
- **`checkout-session-status.ts` + `/shop/thank-you`** (§8.8): the page
  verifies the session server-side and polls with backoff until the webhook
  lands — delivery never depends on email; Stripe's receipt is enabled
  Stripe-side.
- Tests: 23 new — including **the exit-test mechanics in sandbox form**:
  webhook delivered → replayed twice → ONE order, no duplicate events;
  amount-mismatch flag; unpaid-completion skip; token tamper/expiry ladder;
  status-poller transitions. (The REAL §9 exit test — a live Stripe
  test-mode purchase end-to-end — needs Stripe keys and is the launch-gate
  item, not runnable from this sandbox.) Suite 1044 green; astro check 0;
  build 168 pages (the thank-you page is new).

Env needed for production (all marked as secrets): STRIPE_MODE,
STRIPE_SECRET_KEY[_TEST], STRIPE_WEBHOOK_SECRET[_TEST],
PURCHASE_TOKEN_SECRET. NOT in S1c: PWYW/free/unlock paths + the two MCP
tools (S3), the /shop surfaces (S2).

## Session 2026-07-12 E (S1b SHIPPED: commerce + commerce-events stores, order/event libs, capture beacon)

Same session as S1a (PR #411 merged; branch restarted from main). S1b per
plan §9: the substrate the checkout path (S1c) writes into. Wolf directive
recorded this session: **products/services content uses MOCKUP data** — this
supersedes the plan's "/services awaits Wolf's copy-or-delete call" wait; S2
seeds mock products and the W5 conversions may seed mock copy (no longer
"silent lorem" — it is now sanctioned).

- **Stores** (`netlify/lib/blob-store.ts`, the one env-contract place):
  `commerce` (strong consistency — the success page polls the order the
  webhook just wrote) and `commerce-events` (eventual; append-only).
- **`commerce_order.v1`** (`netlify/lib/commerce-orders.ts`):
  `orders/<idempotency-key>.json` — Checkout Session id for paid orders, the
  minted order_id for free claims (§5). `writeOrderIfAbsent` is THE webhook
  idempotency mechanism: pre-read + `onlyIfNew` atomic write; replays and
  race-losers return the ORIGINAL record so fulfillment stays a pure
  function of first-write state. Raw buyer email lives ONLY here; tokens are
  never stored — only `sha256:` hashes (a store dump can't mint download
  links). Zod-strict, `reissues[]` ready for order_reissue (S3).
- **`commerce_event.v1`** (`netlify/lib/commerce-events.ts`): the §6
  substrate contract — 8 event types, one immutable JSON per event at
  `events/<yyyy-mm-dd>/<digits-ts>-<uuid>.json` (opt-ins layout; timestamp
  compacted to digits for local-FS key safety, still time-sorted).
  `appendCommerceEvent` is create-if-absent (immutable, replays no-op);
  `hashEmail` emits `sha256:<hex>` of the normalized address and the schema
  REJECTS anything in `actor.email_hash` that isn't that shape. Additive-only
  evolution documented in the module header.
- **Capture beacon** (`netlify/functions/save-commerce-event.ts`, the
  save-opt-in sibling): accepts ONLY the client-authored types
  (`product_viewed`, `checkout_started`) — authoritative types cannot be
  forged through the public endpoint; no email field accepted (hashed or
  raw); `data` is allowlisted (amount_cents/currency/mode), never
  passthrough; JSON parsed regardless of content-type (sendBeacon reality).
- Tests: 17 new (schema envelopes, PII rejections, idempotency + race
  paths, endpoint forgery/PII/allowlist) — suite 1021 green, astro check 0,
  eslint/prettier clean.

NOT in S1b: nothing reads these stores (by design, §6 — Blobs is not a
queryable database); S1c wires the writers (checkout session → webhook →
token delivery + success page), which is next on the critical path.

## Session 2026-07-12 D (S1a SHIPPED: `product` is the eighth object type — review-required, price-funnel enforced)

Shop build sequence started per [`06-shop-module-plan.md`](../06-shop-module-plan.md)
§9. **S1a is complete**: `product.v1` schema + object type + validation criteria

- contract + the review-required approval flip — the seam everything else hangs
  on. What exists now:

* **`product.v1` body schema** (`src/schema/bodies/product-v1.ts`): slug +
  presentation (title/excerpt/images/seo/`page_ref`/notes) + commerce
  (provider/mode/price/pwyw/stripe/stripe_test/availability, Stripe id shapes
  pinned so keys can't sit where ids belong) + **fulfillment as THE
  discriminated union** (`download` {artifact_ref, filename} / `unlock`
  {unlock_prefix} / `none`), all strict.
* **Type wiring end-to-end**: `objectTypes` + `prod_` id patterns/minting
  (minted from `slug`), store keys, `object_create` seeding, materializer →
  `src/data/site/products/{id}.json`, Ask-AI schema registry, admin
  `prod_→product` prefix map.
* **`set_product_fields`** patch op (deep-merge + exact inverse, the
  set_site_fields mechanics) with the **§3 canonicality funnel in the
  grammar**: `commerce.price` / `commerce.stripe` / `commerce.stripe_test`
  payloads are refused at write with a pointer to `product_set_price` (S3) —
  price drift is impossible by construction, not by discipline.
* **Validation criteria** (standing engine): `product_slug` (shape + live
  uniqueness via the new `isSlugTaken` store resolver — the isRouteTaken
  analogue), `product_commerce` (mode↔fields coherence: fixed⇒price cache,
  pwyw⇒pwyw block + NO Stripe Price, free⇒provider none + no linkage),
  `product_linkage` (publish-gated: 'available' fixed products need price_id
  or the pre-launch stripe_test mirror; coming_soon/retired publish without),
  `product_artifact` (Major-Key trust for download refs), and
  `commerce_price_sync` (§3 backstop; injected `resolveStripePrice`, optional
  until the Stripe surface lands). `presentation.page_ref` resolves through
  reference integrity like any object ref. `STRIPE_SECRET_KEY` /
  `STRIPE_WEBHOOK_SECRET` pre-marked in the deploy-safety scanner (§8.5).
* **The §0.4 flip**: `src/config/approval-policy.ts` pins
  `product: 'require-approval'` under the all-autonomous master — the one
  deliberate exception; publish-gate matrix tests updated to pin it.
* **Proven, not assumed** (sandbox, real MCP handler against an isolated
  store): contract → create (id minted `prod_barrier_repair_guide`) →
  duplicate-slug create BLOCKED → checkout → validate → patch applies →
  price-edit patch REFUSED (`product_set_price` pointer) → publish DENIED
  `approval_required` → inventory row `requires_approval: true`. All gates
  green: 1004 unit tests + 49 script tests, astro check 0 errors, eslint,
  prettier, full build (167 pages).

**Status: type BUILT, store empty by design** — no product records exist yet;
nothing here is "converted" (that vocabulary applies to store-backed content
objects, which arrive with S2's seeds). NOT in S1a (deliberately, per §9):
S1b stores/events, S1c checkout/webhook/delivery, the S3 tools
(`product_set_price`, `order_reissue` — criterion-4 completeness for the
type), roundtrip-drill support (parallelizable), and the W5 page conversions.

## Session 2026-07-12 C (W6 CONVERTED: the six listing objects are #32–#37 — the credentialed run)

Wolf's credentialed run (after one stale-checkout false start — the seed
module wasn't in his working tree until `git pull`; the driver's error named
the missing path correctly) came back **all-green in a single pass**: every
`ensure` created the store record, all six drilled every permitted page op
(page_article via its seed `drillProbe` — the section-less path working in
production), validated, **published** (export commits `7956b13` `d460db0`
`37dd040` `37fea10` `27a416c` `b0f8d90` on main, `[skip netlify]`), contract
6/6, inventory 6/6, and `release_to_production` confirmed **`released:true`**
(one poll). Byte-verified from this session against main: **store === seed
=== export** for all six (marker-stripped; record_version 11 across the
board).

All five criteria met → `page_library`, `page_topics_index`,
`page_topic_detail`, `page_category`, `page_tag`, `page_article` flipped to
🟢 CONVERTED across inventory / conversion-map / playbook / CLAUDE.md /
AGENTS.md in this change. **Converted count: 31 → 37.** W6 is closed: the
listing surfaces' headings/copy/SEO are live agent levers (`%term%` pattern
copy included), `page_article` governs every article page's SEO defaults and
below-post sections, and the P6/T6.1 "biggest remaining chunk" is done.
Remaining on the path: the shop module (own session, plan in
`06-shop-module-plan.md` — its S-phases now carry the W5 pages) and W7 rich
text (OQ-8, Wolf's checkpoint). Standing caveat repeated: `PUBLISH_SECRET`
is a temp value pasted in chat again this run — rotation stays mandatory
before real go-live (it is a named launch gate in the shop plan).

## Session 2026-07-12 B (SHOP MODULE PLAN: W5 re-grounded in commerce — plan, not code)

W6 merged (PR #408) and Wolf redirected W5: "do the pricing pages and the
rest of the W5 pages which were passed over — but add the payment system,"
with a Stripe-only v1 shop brief whose deliverable is **a development plan,
not code**. Survey findings that shaped it: /pricing and /services are
audit-confirmed Astrowind lorem leftovers (A§2.13, unlinked — nothing on the
site links to them), /solutions/shop-preview is real content, there is NO
Stripe surface or customer identity anywhere yet, and the commerce-relevant
prior art is the artifacts store + get-public-pdf delivery, the opt-ins
append-only capture, crypto.ts HMAC, and the object model itself.

**The plan is [`06-shop-module-plan.md`](../06-shop-module-plan.md).** Spine:
`product` as a governed OBJECT type (not an article-pipeline clone — pushback
recorded), fulfillment as the only discriminated union
(download/unlock/none), Stripe canonical for charge amounts with a
display-cache + `product_set_price` tool making drift structurally
impossible, product pages = product object + `page_ref` Page rendered by the
W6 section machinery (product-vs-article answered: different object, same
renderer), an append-only `commerce_event.v1` log designed for an unknown
consumer, Checkout Sessions only (Payment Links rejected in v1), idempotent
webhook→order→signed-token fulfillment with `order_reissue` as
launch-critical, and the W5 pages sequenced AFTER products exist so
pricing_table/steps/feature_grid/content_split mint with real content
(/services still needs Wolf's copy-or-delete call; seeding lorem refused).
Commerce publishes flip to review-required; PUBLISH_SECRET rotation +
SITE_NOT_YET_LIVE flip named as launch gates. Next session starts at S1a
(product.v1 schema) per the build sequence.

## Session 2026-07-12 (W6 BUILT + SEEDED: listing surfaces — the last unimplemented PageTypes are formalized)

Wolf: "Move to W6 on the conversion to CMS path." The T6.1 batch, built the
design-principles way: **the six listing/article page objects own headings/
copy/SEO; the query machinery stays the audited build-time derivation**
(A§2.5–2.7 — getStaticPathsBlogList/Category/Tag, fetchPosts, the topics
derivation; D§5.5 holds: topics remain category presentations, no Topic
entity).

- **PageType law completed** (`src/lib/registry/page-types.ts`): `listing`
  (allowed: lede/prose/cta_banner/newsletter_signup/content_grid/link_list/
  shared_ref; **required: lede** — the first lede IS the surface's header
  block; `listing: {source: 'content_items', defaultQuery
{sort: published_time_desc}, paginate: true}`) and `content_detail`
  (no lede — the post supplies its heading; **`minVisibleSections: 0`**, a new
  per-PageType knob on the ≥1-visible-section publish gate: page_article
  publishes with zero sections because the article IS its content).
  `unimplementedPageTypeIds()` is now empty; `object_contract('page')` and
  `registry_get('page_type')` serve all five definitions automatically.
- **Six objects seeded** (`scripts/lib/pages-listing-seed-data.mjs`), bodies
  verbatim transcriptions: `page_library` (/learn/library), `page_topics_index`
  (/learn/topics), `page_topic_detail`, `page_category`, `page_tag`,
  `page_article`. **Per-term surfaces are ONE object per route family with
  `%term%` pattern copy** (`src/lib/renderer/listing-term.ts`, deep string
  interpolation, unit-tested): `page_tag.title = "Posts by tag '%term%'"` is an
  agent-editable heading pattern — the loader substitutes each term's display
  label at build. Routes are self-describing family patterns
  (`/category/[category]`, `/%slug%`) — unique, and never emitted by the
  catch-all: `object-page-routes.ts` gained the `loader_owned_page_type` skip
  (listing/content_detail objects are served BY their loaders; without this,
  page_article's `/%slug%` route would have minted a literal page).
- **Wiring** (the six route files + shared plumbing): each loader reads its
  object via `loadRoutePageObject` (`src/utils/route-page-object.ts` — first
  visible lede → header copy; title/seo term-interpolated; pre-conversion
  literals as fallback when the export is absent, the W4 pattern), renders the
  header through the surface's EXISTING furniture (Headline / topics hub
  markup — byte-identical cutover), keeps pagination suffixes + robots gating
  as furniture (object seo.robots wins when set, config.yaml stays the
  fallback), and dispatches **every extra section through the component
  registry after the list/article** (`ObjectSections.astro` — hidden filtered).
  An agent can now put a cta_banner under the library list or a
  newsletter_signup below EVERY article with one patch op (proven with temp
  probes in dist, then removed). PageObjectRenderer's dep-building was
  extracted to `section-resolve-deps.ts` and shared — no behavior change.
- **Driver**: section-less pages drill via a seed-declared `drillProbe`
  (PageType-legal clone source; `roundtrip-drill.mjs`) — page_article
  exercises all six page ops like everyone else.

Gates: **1030/1030 tests** (981 compiled + 49 scripts; ~20 new) · astro check
0 errors · build OK (167 pages) · **build-diff EMPTY (168/168 identical)** —
a pure cutover · local driver run ALL GREEN (create → every permitted op
byte-identical → validate → publish blocked at the expected sandbox boundary →
contract 6/6 → inventory 6/6 → exports materialized).

**Status: the six listing objects are RENDERS + SEEDED, not CONVERTED** —
criteria 2/3 need the credentialed run after merge + deploy:
`node scripts/home-conversion-roundtrip.mjs --production --release --seeds scripts/lib/pages-listing-seed-data.mjs`
(schema-vintage gate applies: the deployed endpoint must carry the new
PageType definitions before the run). After it, 37 objects are converted and
the P6 exit criterion "every object type in the C§2.2 matrix exists in
production" is met for pages. Remaining waves: W5 hand-coded pages (Wolf:
separate session), W7 rich text (OQ-8).

**Follow-up in the same PR (Wolf: "address visibility: 'hidden' in the earlier
converted scope"): the never-render-private gap is CLOSED at the resolver.**
`resolveSections` (the pure layer BOTH render paths share — PageObjectRenderer
for the 12 converted pages + the object-page catch-all, and ObjectSections for
the listing surfaces) now skips a section when its page instance is hidden
(including a hidden `shared_ref`, which is not even dereferenced) OR when a
`shared_ref` target's own section object is hidden
(`parseSharedSectionExport` surfaces the inner `visibility`) — so
`set_section_visibility` on a shared section hides it on every page that
references it, matching the validator's `structure_visible` semantics. No
committed export carries `visibility` today, so the change is render-neutral:
build-diff EMPTY again. 4 new resolver tests pin all four cases.

## Session 2026-07-11 M (content_item resolver: manual article curation is agent-usable — trap 4 closed)

The first real step toward the article object model, per the post-W4 path
Wolf approved (resolver → W6 listings → OQ-8/W7):

- **`netlify/lib/content-item-index.ts`** — the committed article ids
  (filenames under src/data/post minus extension — exactly the renderer's
  `post.id`), fetched via the GitHub contents API with the same env contract
  as the object committer (the W3 ruling: committed frontmatter is the source
  of truth, never the blob drafts). 60s cache + in-flight dedupe;
  unconfigured/erroring → `undefined` = "cannot answer", stale-if-error after
  a first success.
- **Validation context** resolves `content_item` refs against that index:
  real ids pass, ghosts are blockers — `content_grid` manual picks and
  `content_embed.contentItem` validate against real articles at
  patch/create/publish.
- **Contract-conformance fix in `requireObject`**: the documented "resolver
  returns undefined = cannot answer" contract was never implemented — every
  undefined fell through to a hard failure, which is WHY trap 4 blocked
  manual curation for everyone. Now undefined degrades to "not verified"
  (local mode keeps working with no GitHub env); `{exists:false}` still
  blocks.
- **Render-side dead-end removed (no-pipeline-dead-ends rule)**: an
  unresolvable manual pick at BUILD time (a post deleted after the grid
  published — temporal drift validation can't prevent) is now SKIPPED with a
  loud build-log warning naming the id, and the declared fallback backfills
  the freed room. Previously it THREW (`ContentGridResolutionError`,
  removed): one content deletion could kill every future build.

Gates: 1012/1012 tests (7 new/updated) · astro 0 errors · build-diff EMPTY
(no manual grids exist yet; behavior changes are server-side + drift-only).
Agents can now curate: `update_section_data` switching a grid's source to
`{kind:'manual', items:[<post ids>], fallback:{…}}` validates, publishes,
renders. NEXT on the path: W6 listing surfaces.

## Session 2026-07-11 L (INCIDENT: agent content tripped the deploy secrets scanner — trap 14)

Wolf's agent, working the /about intro through the MCP (record_version 25 —
real autonomous editing), set `portrait.src` to an images.weserv.nl proxy of
`raw.githubusercontent.com/<repo>/…/dr-lurie-portrait4.jpeg`. That URL contains
the repo slug — the VALUE of the secret-marked `GITHUB_REPOSITORY` env var —
and Netlify's post-build secrets scan matches marked values (even URL-encoded)
in repo files and build output, so **every production deploy failed** from that
publish onward (the build itself compiled clean; the block is the scan).
Everything published since the last good deploy (the agent's nav/home/site
edits, the W4 record, the object-page catch-all) sat dark until healed.

Resolution (final — zero operator actions; Wolf ruled against spending effort
on a credentialed heal for one image):

- **ENFORCEMENT, not advice — two new validation groups in `validateObject`**,
  run on patch AND create AND publish, so agents get the named blocker at
  write time: `deploy_safety` (no renderable string may contain a protected
  env value — raw, URL-encoded, or double-encoded, matched case-insensitively;
  the error names the KEY, never the value; the repo-file hotlink URL families
  raw.githubusercontent/weserv are blocked outright) and `renderability`
  (trap 5 closed: every field a component splits is checked with the REAL
  splitters, so paragraph-only bodies carrying headings/lists — which pass the
  global allowlist but throw at build — are blockers; FAQ answers per item).
- **The committed export corrected in-repo** (one field: `portrait.src` →
  `/images/dr-lurie-portrait4.jpeg`, the photo the agent wanted, shipped in
  `public/images/` in the same change). Hand-editing an export is normally
  the anti-pattern (the next publish clobbers it) — here it is safe BECAUSE of
  the new guardrail: the store record still carries the bad URL and now CANNOT
  republish until an agent fixes that field (the validation error tells it
  exactly what and why). Quarantine + fix-forward; no credentialed run needed.
- **Merging this change alone unblocks all deploys**: the slug no longer
  appears anywhere in repo files or build output (repo-wide sweep clean), so
  the scanner passes with the env config untouched. Unmarking
  `GITHUB_REPOSITORY` as a secret remains OPTIONAL hardening.
- Also shipped: the bio `portrait` editor hint names sanctioned image sources;
  `scripts/fix-about-portrait.mjs` kept as the store-heal template (trap 14);
  playbook trap 14 + refreshed reality-check; two lifecycle-test fixtures that
  carried never-buildable bare-text prose bodies were themselves caught by the
  new renderability check and fixed.

## Session 2026-07-11 K (object-page catch-all: agent-CREATED pages are now live end-to-end — B1 closed)

The last plumbing between "agent creates a page" and "that page is on the
site": every converted page had a hand-written one-line loader file, so a NEW
page object published + released was store-backed but unreachable. Now
`src/pages/[...objectPage].astro` serves any published Page object whose route
no file owns, via the standard PageObjectRenderer. Ownership rules are pure +
unit-tested (`src/utils/object-page-routes.ts`): file routes always win (the
12 converted pages emit nothing here), article permalinks and the reserved
path families (blog list/category/tag bases from config.yaml per B2,
learn/topics, admin) are refused — and every refusal is a loud build-log
warning naming the object, never a silent drop. Route collisions between page
objects are already blocked live at validation (`isRouteTaken`).

Proof: a temp probe export at `/rt-probe-page` built and served (168th page,
site-object titleTemplate applied) then removed. Gates: astro 0 errors ·
999/999 tests (5 new, incl. "the real committed exports emit ZERO paths
today") · build OK · **build-diff EMPTY**. The full agentic loop is now:
instantiate/create → patch → validate → publish → release → **live at its
route** — no code change per page.

## Session 2026-07-11 J (W4 CONVERTED: site_drlurie is object #31 — after a production credentials outage)

Wolf's credentialed run went green after three failed attempts whose root cause
was **environment, not code**: every object verb 500'd because Netlify Blobs
rejected the store credentials. The diagnosis chain, recorded because it will
recur: (1) the generic 500 hides the real error — it lives in the Netlify
function log after `Object_Store request failed.`; (2) first failure was
`BlobsInternalError (401)` — the token env var held a non-token value (an
all-a–p string, i.e. a clipboard/extension-ID mishap or an expired credential);
(3) mid-repair, `MissingBlobsEnvironmentError` = siteID/token env vars absent
entirely (the MCP function proxies object verbs in-process, so the
platform-injected Lambda blob context never reaches the store — the explicit
env vars do ALL the work); (4) the release path can still report green while
blobs are down (deploys API tolerates things blobs does not — including the
site NAME where blobs requires the UUID), so a green release proves nothing
about store health. **The 5-second local probe that isolates it** (run from the
repo, no redeploys): `getStore({name:'site-objects', siteID:<UUID>,
token:<PAT>}).list(...)` via `node --input-type=module`. Fix: fresh `nfp_` PAT
in `NETLIFY_AUTH_TOKEN` (no separate `NETLIFY_BLOBS_TOKEN` — one live token,
both paths fall back to it), `NETLIFY_SITE_ID` = the site UUID, redeploy.
TODO(nice-to-have): expose `getCoreBlobStoreSourceDiagnostics` as a read-only
`blob_store_diagnostics` MCP tool.

The run itself: create → `set_site_fields` drill byte-identical → validate →
publish → contract (1 op ≡ exercised) → inventory → release `released:true`.
Export commit `a20f107` (`Publish site: site_drlurie [skip netlify]`);
**store === seed === export byte-verified** post-release. `site_drlurie` is
🟢 CONVERTED — **31 objects converted**; the layout renders chrome/brand/
metadata/default-nav from the store-backed object with `set_site_fields` as
the agent's lever.

## Session 2026-07-11 I (W4 BUILT + WIRED: the site singleton renders the chrome — pending credentialed run)

Wolf's W4 answers locked the scope (B1 autonomous publish; B2 urls/blog carried
but config.yaml stays authoritative for routing; B3 announcement deferred). The
singleton is built end-to-end and the layout renders from it:

- **Seed** (`scripts/lib/site-seed-data.mjs`): `site_drlurie`, a byte-identical
  transcription of the previously hardcoded values — name/urls/metadataDefaults/
  blog from config.yaml, logo.text from Logo.astro, brandTokens from the
  CustomStyles literals (colors keyed by var name minus `--aw-color-`, dark
  overrides under `dark:` keys), chrome flags + defaultNavigation from
  PageLayout. 5-test seed suite (schema/id/validation clean; dangling
  defaultNavigation ref proven a real blocker; token set covers every custom
  property).
- **Wiring** (`src/utils/site-object.ts` + 5 consumers): CustomStyles renders
  every custom property from brandTokens; Logo text; PageLayout header/footer
  nav ids + Header chrome flags; PageObjectRenderer footer default; Metadata
  gains a metadataDefaults layer (titleTemplate/description/ogImage/twitter
  handle/og site_name) between config.yaml and per-page props. All with the
  pre-conversion literals as fallback when the export is absent.
- **The trap this session found (recorded for every future wiring): an `await`
  in previously-sync component frontmatter flips astro-icon's `<symbol>`/`<use>`
  placement.** First wiring used a memoized async `getEntry` loader — build-diff
  lit up 153/168 pages, ALL of it icon-sprite placement shifts (Astro evaluates
  sibling components concurrently; any new microtask changes which instance
  renders first and wins the symbol). Fix: the loader is a deliberately
  SYNCHRONOUS eager `import.meta.glob` (zero-or-one match, absent → undefined),
  so frontmatter that was sync stays sync. Re-run: **build-diff EMPTY**.
- **Driver**: `site` support — `siteDrillOps` (`set_site_fields` is the type's
  only op: poke name + restore), reconcile = one `diffFieldsForMerge` fields op
  (trap-2 stray-nulling), materializeSite dispatch. Local rehearsal green: full
  lifecycle create → drill → validate → publish (sandbox boundary) → contract
  (1 op advertised ≡ exercised) → inventory → site.json materialized.

Gates: astro 0 errors · 994/994 tests (8 new) · build OK · **build-diff EMPTY**
(the byte-identical cutover held). Still config-owned deliberately: i18n,
ui.theme, analytics, googleSiteVerificationId, trailingSlash, and routing
(urls/blog are carried, not wired — B2). NEXT: Wolf's credentialed run
(`node scripts/home-conversion-roundtrip.mjs --production --release --seeds
scripts/lib/site-seed-data.mjs`) flips site_drlurie to CONVERTED (#31).

## Session 2026-07-11 H (content cleanup: 10 junk posts dumped, 18 surfaced — PR #402 merged)

Wolf ruled on the 28 invisible posts ("you be the judge"): judged by content —
deleted 10 (5 twenty-three-word "After N" stubs, 4 pipeline-test artifacts,
1 malformed notes file), stamped `published_time` (from each `publishDate`) on
the 18 real ones. Site 123 → 167 pages; topics hub renders all 5 registry
categories; tag pages 18 → 26. The standing "28 posts invisible" caveat is
CLOSED.

## Session 2026-07-11 G (W3 STEP 2 SHIPPED: publish-article taxonomy enforcement + frontmatter normalization + registry labels)

Wolf picked "slugs + label lookup". The bounded exception is built — full §5.5
for articles, in three pieces:

- **Enforcement hook** (`netlify/lib/taxonomy-enforcement.ts` + a minimal
  insertion in `publish-article.ts` before `buildFrontmatter`): when the
  tax_drlurie registry exists in site-objects, every category/tag on a publish
  resolves BY SLUG (labels and slugs both work), following `merged_into`
  aliases (cycle-guarded); unresolvable terms → 422 `TAXONOMY_TERMS_UNRESOLVED`
  with the offender list; resolved terms are materialized into frontmatter as
  their CANONICAL SLUGS (deduped). **No registry → skipped, byte-identical old
  behavior** — the bounded-exception guarantee is structural: all 56
  pre-existing publish-article tests run storeless of taxonomy and pass
  unchanged. Record free-strings stay lossy input (§3.10 untouched).
- **One-time normalization** (`scripts/normalize-taxonomy-frontmatter.mjs`,
  standing tool + audit trail): all 93 posts rewritten via RAW_TO_CANONICAL —
  category kept 11 / dropped 3 (test posts); tag usages kept 122 / dropped 235
  (the junk). Line surgery only; tag-list style preserved per file. One mapping
  added beyond the approved table: tag `Health` → `skin-health` (the category
  map already absorbed it; obvious cluster variant).
- **Registry display labels** (`src/utils/blog.ts`): getNormalizedPost now
  resolves category/tag titles from the taxonomy export by slug (memoized
  `getEntry('taxonomyObject', …)`; raw-string fallback when absent). Labels
  are registry-governed — rename a label in tax_drlurie and every card, chip,
  tag page, and topics entry updates on the next build.

Gates: **986/986 tests** (8 unit + 2 integration new — the integration pair
drives the REAL handler against the REAL seed registry in an isolated local
store: canonical-slug frontmatter committed on success; 422 + nothing committed
on junk). astro 0 errors; build OK. **build-diff reviewed and intended**: 90
only-in-base pages = junk-tag listing pages gone; 11 only-in-head = canonical
merged-term tag pages (+ pagination); 75 changed = article pages' tag chips +
kept tag pages now registry-labeled. Site: 202 → 123 pages.

**Discovered, pre-existing, out of scope (flagged to Wolf):** `fetchPosts()`
filters to posts with a finite `published_time`; 28 of 93 posts (including ALL
11 categorized ones) lack it, so they are invisible in every listing/tag/topics
surface TODAY — the /learn/topics hub renders zero topics at HEAD and after
this change alike (build-diff: byte-identical). Fixing means stamping
`published_time` on those 28 posts (an article-pipeline pass, Wolf's call).

## Session 2026-07-11 F (tax_drlurie CONVERTED — object #30; taxonomy registry live in production)

Wolf ran the credentialed taxonomy command; single all-green run: ensure
(created) → drill (all 5 term ops: add/update/deprecate/reactivate/remove,
byte-identical) → validate → published → contract 5/5 → inventory →
`released:true` (one transient `build_not_confirmed_live` poll, then confirmed).
Export commit `627fa8d` on main; byte-verified store === seed === export
(5 categories + 26 tags, mint-convention ids). All five criteria met → flipped
🟢 CONVERTED across inventory / conversion-map / reality lines.

**Converted count: 29 → 30.** The taxonomy registry is now live: the store
validation context wires `resolveTaxonomyTerm` automatically, so `content_grid`
query terms validate against the real curated vocabulary in production from
this moment.

**Open next (Wolf's call pending on the design fork):** step 2 — the bounded
publish-article enforcement hook + one-time frontmatter normalization of the
93 posts via the committed `RAW_TO_CANONICAL` map. Fork presented to Wolf:
normalize frontmatter to canonical SLUGS per §5.5 + teach the blog renderer to
look up display labels from the registry (recommended — labels become
registry-governed), or normalize to canonical LABELS (zero renderer change,
display strings stay in frontmatter). Awaiting his pick before writing the
sanctioned publish-article exception.

## Session 2026-07-11 E (W3 DECIDED + SEEDED: tax_drlurie — curated agent-editable vocabulary)

**The taxonomy checkpoint is answered.** Wolf first proposed converting the whole
article pipeline (publish-article + workflow) to the new schema so taxonomy
would be unblocked; assessment: right destination, wrong prerequisite — the
pipeline is ~4,700 lines / 31 tool surfaces / 27 test files of load-bearing,
deliberately-frozen contract (§3.10 protects ContentSourceV1; OQ-8 unresolved),
and taxonomy enforcement needs only a HOOK in the publish step, not a new
envelope. **Wolf approved the recommended path:**

1. **Curated registry now (this session):** `tax_drlurie` = agent-editable
   vocabulary, seeded from a CLEANED canonical set Wolf approved term-by-term —
   5 categories + 26 tags distilled from the raw frontmatter of 93 posts
   (158 distinct tag strings; ~2/3 of usage pipeline-test junk; real terms split
   across casing variants — e.g. skin-barrier ×3 spellings = 18 uses). The
   approved raw→canonical mapping is committed as `RAW_TO_CANONICAL` in the
   seed module (step 2's normalization input). Judgment calls recorded:
   Market→skincare, retinol+retinoids→retinoids, photoaging/sun damage→
   sun-protection, essays kept under `reflections`, melanin-rich-skin dropped
   (promotable later — the registry is editable data; nothing is locked in).
2. **Step 2 (next): bounded publish-article enforcement hook** — a third
   sanctioned additive exception to the off-limits rule (resolve article terms
   against the registry at publish time per §5.5/§5.6-step-2, following
   `merged_into` aliases) + one-time frontmatter normalization via the map.
3. **Full content_item→ObjectRecord conversion**: deferred as its own wave
   (OQ-8 adapter-vs-migration decided then) — explicitly NOT a prerequisite.

Built: `scripts/lib/taxonomy-seed-data.mjs` (registry body + mapping); driver
extended to taxonomy (drill = all 5 term ops via a probe tag — add → relabel →
deprecate → reactivate → remove, byte-identical; reactivate_term is
inverse-machinery but advertised, so the drill exercises it; reconcile =
wholesale per-kind rebuild, since there is no reorder op and slug renames mint
aliases; materialize → src/data/site/taxonomy.json). Local rehearsal all-green
(create → 5 ops → validate → publish at sandbox boundary → contract 5/5 →
inventory → export). Gates: **976/976 tests**, astro 0 errors, build OK,
build-diff EMPTY (the registry renders nothing itself; its first live consumer
is store-side validation — resolveTaxonomyTerm wires automatically in
production the moment the record exists, so content_grid query terms start
validating for real).

**Status: tax_drlurie is SEEDED, not CONVERTED** — one-command credentialed run:
`node scripts/home-conversion-roundtrip.mjs --production --release --seeds scripts/lib/taxonomy-seed-data.mjs`
(after merge + deploy — schema-vintage gate: the taxonomy drill needs nothing
new server-side, but run on latest main anyway).

## Session 2026-07-11 D (BATCHED CREDENTIALED RUN: 13 objects CONVERTED — the page + template backlog is cleared)

Wolf ran `./scripts/convert-pending-production.sh --verify-only` (all green) then
the real `./scripts/convert-pending-production.sh` from his credentialed laptop.
The single run created/reconciled, drilled every permitted op, published, and
released all 13 SEEDED objects in one deploy (`release poll: released` →
`SUCCESS — store-backed, round-trips every permitted op, and published`):

- **8 W1 pages** — page_start_here, page_member_updates, page_newsletter,
  page_free_guide, page_early_access (lede); page_privacy, page_terms (prose),
  page_404 (cta_banner).
- **3 W2.5 templates** — tpl_interior, tpl_landing, tpl_legal (all 4 template
  ops round-tripped + instantiate `dry_run` proven).
- **2 W2 form pages** — page_contact, page_thank_you.

Every `ensure` reported "already matches the seed" (store === seed); the 13
`Publish …` commits are on main and carry the decomposed exports (store ===
export); inventory returned all 13. All five criteria met → flipped to
🟢 **CONVERTED** across object-inventory / conversion-map / this log /
CLAUDE.md / AGENTS.md.

**Converted count: 16 → 29.** All 12 page objects + all 3 templates + the 3 nav
objects are now store-backed and agent-editable. **The rendered-stub backlog is
empty** — no page renders from an unbacked export anymore. The now-cleared batch
harness (pending-conversion-seeds.mjs + convert-pending-production.sh + its test)
is retired; the batching PATTERN stays documented in the playbook for the next
wave. `PUBLISH_SECRET` was pasted in chat and the run went live — **rotate it
before any real go-live** (standing caveat, still open).

Next: W3 taxonomy (Wolf's source-of-truth decision — the open checkpoint) and
W4 site singleton.

## Session 2026-07-11 C (W2 SHIPPED: /contact + /thank-you decomposed — the palette is now FULLY GENERIC)

Wolf: "Continue with W2." Answered the three framing questions (generic
decomposition + accept a scoped diff; reuse content_grid cards with an added
optional icon rather than a new feature_grid type; rename thank_you). The last
two bespoke per-page section types are retired — **no single-use page type
remains** (design-principles rule 1 fully satisfied):

- **/contact** decomposed off the bespoke `contact` type into 3 inline GENERIC
  sections: `lede` (kicker + heading) + `contact_form` + `content_grid` (`cards`
  source). To carry the current copy without a new type:
  - `gridCardCellSchema` gained an optional `icon` (Tabler name); ContentGrid
    renders it above the cell — the "how we can help" feature-grid shape as
    curated cards.
  - `contact_form` gained optional `subtitle`/`description`; ContactForm renders
    them (the name/email/message field set stays fixed furniture).
    The bespoke `contact` type + `ContactPage.astro` + `contact.ts` are REMOVED
    (compile-lockstep gate). Intentional **scoped rule-4 visual diff on /contact**
    (build-diff: 1 changed page; all copy + 6 icons + the Netlify form preserved,
    only the widget→generic-component markup changed).
- **/thank-you**: the `thank_you` type was RENAMED to the reusable
  `form_confirmation` (ThankYou.astro → FormConfirmation.astro, thank-you.ts →
  form-confirmation.ts; the `?form=` swap script is unchanged). It was already
  fully data-driven — this makes the palette name honest. **Renders
  byte-identically** (build-diff: /thank-you unchanged). The route `/thank-you`
  and the `?form=` post targets are untouched.
- Seeds: `scripts/lib/pages-forms-seed-data.mjs` (page_contact + page_thank_you,
  both `standard`, sections inline). Exports regenerated via the driver.
- Gates: **969/969 tests**, astro check 0 errors, build OK, build-diff = exactly
  1 scoped change (/contact), reviewed. Local round-trip proven for both pages.

**Status: page_contact + page_thank_you are RENDERS (decomposed, local proof),
not CONVERTED** — production store records land with the batched credentialed
run (`--seeds scripts/lib/pages-forms-seed-data.mjs`). Sixteen converted objects
unchanged. Remaining waves: W3 taxonomy (Wolf's decision), W4 site, W5+ pages.

## Session 2026-07-11 B (W2.5 SHIPPED: templates activated — instantiate verb + 3 starter recipes)

Wolf confirmed the two understandings (the MCP edit surface varies per
object/PageType through the always-exact, self-describing contract; the W1
credentialed run is postponed until all page types are ready) and said
"proceed" — so W2.5 was built end-to-end:

- **`src/lib/template-instantiate.ts`** — pure builder: template slots → page
  body. Blueprint → deep-copy with a fresh deterministic `s_` id; required
  slot without blueprint → registry `defaultData` of its first allowed type
  (the exact promise the `template_required` warning makes); optional empty
  slot → skipped; `page.template = {ref, instantiated_at}` provenance stamped;
  pageType defaults to `appliesTo[0]` (explicit `page_type` must be within a
  non-empty `appliesTo`).
- **`instantiate` verb** (object-verbs.ts) — loads the template (must EXIST,
  draft fine), builds the body, then **delegates to the existing `create`
  case**: one write path, so route uniqueness, PageType law, reference
  integrity, and reader safety all gate an instantiated page exactly like a
  hand-authored one ("law beats recipe" is a pinned test). `dry_run: true`
  returns the built body + would-be id + `id_available` + full validation and
  persists NOTHING. Exposed as the **`object_instantiate_template`** MCP tool
  (also available to the admin mirror via the shared verb core); surfaced in
  `object_contract('template')` and `('page')` workflow sequences.
- **Starter recipes** (`scripts/lib/templates-seed-data.mjs`): `tpl_interior`
  (standard: lede + prose + optional cta), `tpl_landing` (standard: hero +
  curated card grid + cta), `tpl_legal` (system: one required blueprint-less
  prose slot — keeps the defaultData fallback exercised). Blueprints are
  self-contained; blueprint ids are `s_<alnum>` (no underscores — the id
  regex bit once).
- **Driver extended**: seeds may be `objectType: 'template'`; drill covers all
  4 template ops via an always-legal probe slot; reconcile heals templates
  (meta diff excludes `slots`; positioned wholesale slot upserts + stray
  removal + explicit ordering); `--write-exports` materializes to
  `src/data/site/templates/`; and a per-template **instantiate dry_run proof**
  runs after the drill (no probe pages left behind, production-safe).
- **Local rehearsal all-green**: ensure(create) → all 4 ops byte-identical →
  validate → publish blocked at the expected sandbox boundary → 3/3
  instantiate dry_runs eligible → contract 4/4 ops → inventory 3/3 →
  exports written. Gates: **963/963 tests**, astro check 0 errors, build OK,
  **build-diff EMPTY** (templates render nothing — expected).
- Docs: playbook "Template families" section + `object_instantiate_template`
  call-table row; conversion-map TEMPLATES node → 🟡 ACTIVATED/SEEDED; W2.5
  row → DONE (code + seeds); inventory "Singletons & templates" table added.

**Status: the three templates are SEEDED (local proof), not CONVERTED** — the
production store records land with the batched credentialed run
(`node scripts/home-conversion-roundtrip.mjs --production --release --seeds
scripts/lib/templates-seed-data.mjs`, after merge+deploy; batch it with the
postponed W1 run). Sixteen converted objects unchanged.

## Session 2026-07-11 A (ARCHITECTURE DECISION: templates are recipes, PageTypes are law)

Wolf posed the standing tension directly — flexibility (generic components,
agent responsibility) vs strict rules (encoded per set page) — and proposed:
generic objects only + a template per specialty page. Repo survey confirmed the
template machinery is BUILT and dormant (template.v1 schema with
slots/allowed/required/repeatable/blueprint, 4 patch ops, validation,
materializer — but zero instances and NO instantiate flow; deferred to P6 by
the original plan). **Decision (Wolf): adopt the sharpened form — recipes + law
split** (now design-principles.md rule 5, GOVERNING):

- Palette stays generic-only and grows ON DEMAND (Wolf's second choice — no
  speculative upfront library).
- Templates = data recipes, agent-editable, creation-time COPY + provenance
  only (D§3.6 stands; live inheritance explicitly rejected — the propagation
  trap).
- PageTypes (code registry + validation criteria) remain the only enforced
  structural law. Behavior stays in generic components, never templates.
- PageType-as-data (OQ-4) considered and deferred: guardrails must not become
  agent-mutable unless agents should invent page _kinds_.

**Implementation queued as W2.5 in the map** (~1–2 sessions, net-new):
`instantiate_template` MCP verb (copy slot blueprints → new page body, stamp
`page.template`), a starter recipe set (tpl_interior / tpl_landing /
tpl_legal), a template drill in the round-trip driver, contract surfacing,
docs. Remaining W2 (contact/thank_you) now explicitly decomposes into generic
types per rule 5 — the last two bespoke types retire with it.

## Session 2026-07-10 G (W1 batch: 5 lede + 3 system pages seeded for conversion)

Wolf: do the next low-question conversions. The cleanest batch is the 8
interior + system pages — all already thin `PageObjectRenderer` loaders with
committed single-section exports (no restructure needed, unlike home/about):

- **One combined seed module** `scripts/lib/pages-interior-seed-data.mjs`
  (`SEED_SITE` + `CONVERSION_SEEDS`, 8 `page` entries): the 5 `lede` bodies
  reused verbatim from `page-lede-family-seed-data.mjs`, the 3 `system` bodies
  (privacy/terms `prose`, 404 `cta_banner`) inlined verbatim from their
  committed exports (the large legal copy taken exactly, not re-transcribed).
  page_newsletter stays a plain `lede` (Wolf's D2 choice; the shared newsletter
  section can be added later).
- **No rendering change**: these pages already render from committed exports, so
  the conversion adds only the store-backed + round-trip half. The PR is just
  the seed module + test; the 8 seed bodies byte-match the committed exports
  (materialized exports reverted as marker-only churn).
- **Gates:** astro check 0 errors; 899 netlify/src + 37 scripts tests green (3
  new); build green (202 pages); dist grep confirms all 8 render; local
  `--seeds pages-interior` round-trip all-green (every page drilled all 6
  permitted ops via the inline-section probe).

**Status: RENDERS, not yet CONVERTED** — the credentialed
`node scripts/home-conversion-roundtrip.mjs --production --release --seeds
scripts/lib/pages-interior-seed-data.mjs` run creates the 8 store records and
proves the production round-trip (criteria 2/3). After it, 10 pages are
converted (home, about, + these 8), leaving only contact + thank_you.

**Also this session (Wolf's D1 = yes, separate PR):** the now-orphaned bespoke
`about` section TYPE was RETIRED — union member, `About.astro`, its registry
module + binding, the registered-types/object-contract/resolve.ts entries, and
two test artifacts all removed (the `componentRegistry` `Record` forces the
union + binding to change in lockstep, so a miss is a compile error). No live
data migration (zero objects were `type: 'about'`); build-diff EMPTY (203/203)
— nothing rendered it. 17 registered section types remain.

## Session 2026-07-10 F (/about DECOMPOSED into 8 generic objects; bio gains a portrait; driver handles all-shared_ref pages)

Wolf: "convert the about page — the objects on it should each be their own
converted object; mostly generic text sections." Done as the first W2
conversion, the design-principles way (retire the bespoke, don't repeat it):

- **/about decomposed** from the single bespoke `about` section into EIGHT
  standalone shared sections of REUSABLE types — `sec_about_intro` (bio),
  `sec_about_{thinking,products,science,research,blog,note}` (prose ×6),
  `sec_about_cta` (cta_banner); `page_about` is now a `standard` page of 8
  `shared_ref`s. Each piece is independently editable/reorderable/reusable.
  Seed: `scripts/lib/page-about-seed-data.mjs`.
- **bio generalized (Wolf's call)** to keep the doctor's portrait: added an
  optional URL `portrait {src,alt}` field + rendering (distinct from the
  artifact-ref `portraitAssetRef`, which fails artifact-trust on a raw URL —
  that's WHY portrait is a separate field; pinned by test). The reusable "person
  intro" now carries a photo; the homepage bio (no portrait) is byte-identical.
- **Driver improvement surfaced by this conversion:** a fully-decomposed page is
  ALL `shared_ref`s — the normal shape once every section is its own object —
  which the page-drill's "refuse to guess" guard (fix 5) correctly stopped on.
  `pageDrillOps` now handles it by cloning ANY of the page's own sections as the
  probe (a shared_ref duplicate resolves + is PageType-legal). Unit-tested.
- **Gates:** astro check 0 errors; 896 netlify/src + 37 scripts tests green (16
  new); build green; dist grep shows all 8 sections + portrait + lists + CTA;
  build-diff scoped to `/about` ONLY (202/203 identical — the home bio is
  unaffected). Local `--seeds page-about` round-trip all-green.

**Status: CONVERTED (all five criteria).** Wolf ran the credentialed
`--production --release --seeds page-about` run: all 9 objects created,
every permitted op drilled, published (9 export commits `e0a36af`…`029142c`
on main), and `release_to_production` confirmed `released:true` (the resilient
poller's first `build_not_confirmed_live` then `released` — the 504 fix
working as designed). Byte-check: all 9 published exports === seed (no drift);
page_about record_version 10; the intro bio kept the portrait. **Sixteen
objects converted total** (3 nav + home family + /about family); the reality
lines were flipped across CLAUDE.md/AGENTS.md/playbook/inventory/map/core-structure.

**Follow-up flagged:** the `about` section TYPE is now orphaned (no object uses
it) — retire it (union member + About.astro + registry + resolve.ts entry +
fixtures) in a separate focused change.

## Session 2026-07-10 E (conversion factory: full object map + generalized driver + tightened recipe)

Wolf's directive after the home-page success: tighten the instructions so any
coding agent can convert the rest, and produce the complete object universe for
him to set boundaries and priority. Landed:

- **`conversion-map.md` (NEW)** — the full tree of every actual and potential
  object in the Astro project: attributes, dependencies, dependents, status
  marks, composable ⚪ potential objects (topics hub from content_grid, landing
  pages, shared CTAs, pricing_table/steps/feature_grid/content_split types for
  W5), and a PROPOSED wave order (W1 lede+system pages → W1-enabler
  content_item resolver → W2 bespoke pages → W3 taxonomy decision → W4 site →
  W5 pricing/services/shop → W6 listings → W7 rich text). **The priority table
  is Wolf's to edit; agents follow it.** Wired into CLAUDE.md/AGENTS.md
  mandatory reading and playbook criterion 5.
- **Driver generalized** — `home-conversion-roundtrip.mjs --seeds
scripts/lib/<family>-seed-data.mjs`; a seed module exports CONVERSION_SEEDS
  (ordered, referenced-before-referrer) + SEED_SITE. v1 drills page/section
  types and refuses others loudly.
- **Playbook recipe rewritten as the factory flow** (seed module → local
  driver run → gates → record-as-RENDERS → merge+deploy → credentialed
  `--production --release` → flip to CONVERTED) + traps 10–12 (deep-merge
  heal strays; release gateway timeout; schema-vintage before --production).

## Session 2026-07-10 D (HOME-PAGE FAMILY CONVERTED — all five criteria)

Wolf's second credentialed run (after PR #386's driver fixes) came back
**all-green**: every `ensure` reported "already matches the seed" (store ===
seed byte-exact; page_home v44), all four objects re-published, contract and
inventory checks passed, and `release_to_production` confirmed
**`released: true`**. That completes criterion 3's release→re-render leg — so
**`page_home`, `sec_home_audience_grid`, `sec_home_start_grid`, and
`sec_newsletter_signup` are CONVERTED, all five criteria, no asterisks.**
Seven objects total now (3 nav + the home family); the reality lines in
CLAUDE.md / AGENTS.md / conversion-playbook.md / object-inventory.md /
core-structure.md were all flipped in this change. The 2026-07-10 goal —
"agents can change everything on the home page through the MCP, up to
publishing live" — is met: hero and bio edit via `page_home`'s section ops,
each grid and the newsletter via their own section objects, chrome via nav.

Still-open, known follow-ups (unchanged): the `content_item` resolver gap
(manual grid curation, playbook trap 4); archive/unpublish verbs; the other
11 rendered-stub pages; `site`/`taxonomy` objects; `checklist` type now unused
on the home page (kept registered — retirement optional). Also noted for
later: rotate `PUBLISH_SECRET` before real go-live (exposed in a chat
transcript during testing; Wolf accepted the risk for now — nothing is live).

## Session 2026-07-10 C (FIRST CREDENTIALED PRODUCTION RUN + driver hardening)

PR #385 merged; **Wolf ran `home-conversion-roundtrip.mjs --production --release`
from his machine — the first credentialed store run since nav.** Results:

- **`sec_newsletter_signup`, `sec_home_audience_grid`, `sec_home_start_grid`:
  created in the production store, EVERY permitted op exercised, validated,
  PUBLISHED** (export commits `a3d6e87`/`4dbbc1f`/`86b9174` on main).
  `object_inventory` returns all of them. Criteria 1–4 all proven in
  production for the section family.
- **`page_home`: healed and PUBLISHED** (`344faab`, record_version 42) — the
  broken record's structure was fully reconciled (hero inline, two grid refs,
  bio, newsletter ref, footer override). The ensure check flagged a residual
  diff: three `seo` subkeys from the old record (`description`/`robots`/`title`)
  survived because the reconciler hit **playbook trap 2 itself** (`set_page_meta`
  deep-merges; strays must be nulled). The values are good editorial content,
  so they were **adopted into the seed** (seed === store now) rather than
  stripped.
- **`release_to_production` died at a gateway "Inactivity Timeout" 504** — the
  server polls deploy receipts longer than intermediary proxies allow. The
  build hook fires before the polling, and the #385 merge itself also triggers
  a production build, so the release almost certainly happened; confirmation
  rerun pending.

**Hardening landed this session:** reconcile logic extracted to
`scripts/lib/roundtrip-reconcile.mjs` with `diffFieldsForMerge` (nulls stray
keys at every depth — unit-tested against the exact production drift); a failed
ensure now SKIPS that object's drill/publish (never publish a wrong body); the
release step fires the hook once (`timeout_seconds: 15`) then confirms via
short read-only polls (`force_build: false`) tolerant of gateway errors.

**Remaining to declare the home family CONVERTED:** one rerun of
`--production --release` (expect: every ensure "already matches the seed";
`released: true`), a look at the live homepage, then flip the four inventory
rows to 🟢. **Security follow-up: rotate `PUBLISH_SECRET`** — it was exposed
in a chat transcript during this run's setup.

## Session 2026-07-10 B (home-page conversion push: restructure + standing round-trip driver)

Wolf's goal: the home page at 100% conversion — hero, the two grids, about/bio,
newsletter — everything agent-editable via MCP through to live publish. His
structural call, implemented: **hero and bio stay inline on `page_home`; the two
grids become standalone objects of the ONE reusable `content_grid` type**
(`sec_home_audience_grid` — new sanctioned `cards` source of curated text cells;
`sec_home_start_grid` — the settled M-8 `query` source), referenced via
`shared_ref` like the newsletter. One grid type, two roles by configuration
alone — the design-principles litmus passes.

**Landed on `claude/home-page-conversion-state-6wsc2r`:**

- **Schema:** `content_grid` gains the `cards` source (cells: optional
  title/description + optional `link` LinkAction, ≥1 of title/description,
  max 8 = the block-tree bound); the transitional `static` variant is **removed**
  (playbook trap 9 closed; seed script now safe to re-run). Renderer resolves
  cell links like hero actions (`ContentGridResolved.cardHrefs`).
- **Restructure:** `page_home` = hero (inline), 2 grid `shared_ref`s, bio
  (inline), newsletter `shared_ref`. `index.astro` collapsed to
  `<PageObjectRenderer objectId="page_home" />` (removes the loader duplication
  AND the 2026-07-10 footer-crash mode — the renderer falls back to `nav_footer`;
  the `structure_home_footer` rule still guards the store record).
- **Standing round-trip driver** (`scripts/home-conversion-roundtrip.mjs`) —
  closes root-cause 4 (throwaway drivers): ensure/heal each record (the broken
  production `page_home` reconciles via real patch ops), drill EVERY permitted
  op per type ending byte-identical, validate (zero blockers), publish, then
  contract-completeness (advertised ops ≡ exercised ops — criterion 4 ✓ for
  page/section) and inventory checks. `--local` rehearsal **PASSED end-to-end**
  (publish blocked exactly at `export_commit_failed` — the expected boundary);
  `--production [--release]` is the credentialed conversion run.
- **Gates:** astro check 0 errors; 882 + 24 tests green; build green; dist grep
  shows all five sections' real copy; render gate 5/5 IDENTICAL (fixture updated
  to the two-grid structure); build-diff reviewed: **scoped to `/` section 2
  only** (audience cards adopt the grid card frame — intentional, per
  design-principles rule 4), 202/203 pages byte-identical.

**Honest status: page_home + the three shared sections are RENDERS + fully
rehearsed, NOT yet converted.** Criteria 2/3 (production store record + proven
production round-trip) still need what no agent session has: `PUBLISH_SECRET`
(+ egress to `drluriescience.netlify.app` — this session verified the network
policy blocks it). **The remaining work is one command from a credentialed
machine:** `node scripts/home-conversion-roundtrip.mjs --production --release`
(then re-check `object_inventory` and the live site; expect the four exports'
`__generated` markers to reconcile). Alternatively: add `PUBLISH_SECRET` (and
the domain) to this Claude environment's config and re-run from a session.

## Session 2026-07-10 (definition-of-done RESET; homepage-footer regression fix)

Two things. **(1) Incident + fix (PR #383, merged):** four real production
`object_publish` calls on 2026-07-10 progressively stripped `page_home`'s store
record down to one section with no `navigationOverrides` — every step passed
validation (the field is schema-optional) and only surfaced as a site-wide Netlify
build crash (`index.astro` throws without `navigationOverrides.footer`; Astro's build
is all-or-nothing). Added the `structure_home_footer` validation rule (rejects any
page_home / pageType-home patch/publish missing the footer override, at validation
time), restored the git export, documented in `object_contract`. The **live store
record for page_home is still broken** — restoring it needs production credentials.

**(2) Governing reset (Wolf):** "converted" was being used to mean "renders," which
let half-done work look finished. New GOVERNING definition, added to CLAUDE.md /
AGENTS.md / conversion-playbook.md: an object is converted ONLY when it renders **and**
is store-backed **and** an agent can round-trip every permitted action via MCP **and**
every permitted action is in the contract + has a server tool **and** it's recorded in
docs. No half measures. **After every session, docs must be updated; no record =
not converted.** Honest status recorded: **only nav_header/nav_footer/nav_footer_home
are actually converted**; the 12 pages are rendered stubs. Root-cause analysis of why
(no production credentials in any session; missing archive/unpublish + nested-block
MCP verbs; content_item resolver gap; no standing round-trip test) is in
`object-inventory.md` "Why only nav is converted."

## Session 2026-07-09 (system pages + grid via the real MCP lifecycle; playbook)

PR #380 (`claude/system-pages-and-grid`): `page_privacy`/`page_terms`/`page_404`
cut over as `system` pages using **reusable** section types (`prose`, `cta_banner`
— no bespoke per-page types, per design-principles), and the homepage grid's
invalid `static` placeholder retired for a live `query` source. Every object was
driven through the REAL compiled MCP handler (create→checkout→validate→patch→
publish→checkin, local file-backed store; publish correctly blocked at the
`not_configured` git-commit gate — the expected sandbox boundary). Also: site-wide
noindex/nofollow guard (`SITE_NOT_YET_LIVE`, Metadata.astro) + README notice — the
site is not live; QA posts surfacing in the grid is accepted per Wolf.

**Review pass (Fable) findings, fixed in the same PR:** literal markdown backticks
shipped into page_privacy's rendered copy (no `code` tag in the allowlist);
materializer meta silently dropped `record_version` when passed camelCase (now a
loud runtime guard + test); the object-inventory same-change rule was missed.
Every trap from this batch is codified in **`docs/cms-architecture/conversion-playbook.md`**
(new; mandatory pre-conversion reading, wired into CLAUDE.md/AGENTS.md/core-structure)
so Sonnet-class conversions don't need a fix-up pass. Open follow-ups: `content_item`
resolver (manual grid curation), retiring the `static` grid variant + seed script.

## Standing state (after session 2026-07-08 D — bespoke-page cutovers)

Continues the bespoke-page cutover track opened by the `/thank-you` cutover
(`7c14eb4`, **merged to main** in `fdc55eb`), which established the
functional-equivalence gate for pages carrying a page-level inline script/scoped
style (`known-inert-diffs.md`). This session cut over the next two, each on its
**own branch off `main`** (not stacked — applying the #368–#371 scoping lesson):

| Page cutover                  | Branch / commit                      | State                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`/about` → page_about**     | `claude/cutover-about` (`6180f3a`)   | **Cut over in CODE + verified.** Bespoke-markup page: prose blocks stay fixed component furniture, only the **clean fields** are object data — page + 6 section headings, portrait src/alt, closing CTA (Wolf's "clean fields only" call; no rich-text/injection surface). `build-diff` EMPTY (203/203). No page-level script/style → strict byte-identity, no ledger entry. **Not merged.**                                                      |
| **`/contact` → page_contact** | `claude/cutover-contact` (`e7e734c`) | **Cut over in CODE + verified.** First **widget-composition** page: `ContactPage.astro` re-invokes the same HeroText/Contact/Features2 widgets, every prop now object data (promotes cleanly — no prose-emphasis problem, so no clean-fields compromise). Two editorial HTML comments kept verbatim (html-minifier `removeComments` off). `build-diff` EMPTY (203/203). No link actions → empty resolved, no `resolve.ts` change. **Not merged.** |

**Two page-shape families identified for the remaining cutovers:**

- **Bespoke raw markup** (`about` done; `shop-preview` remaining). Faithful repro = one bespoke section reproducing the exact markup. `shop-preview` also carries a scoped `<style>`, so it takes the **functional-equivalence** gate + a `known-inert-diffs.md` entry (like thank-you).
- **Widget-composition** (`contact` done; `pricing`, `services` remaining). Faithful repro = a bespoke section re-invoking the page's existing widgets with props promoted to object data. `pricing`/`services` both use `CallToAction` (link actions), so each will need the action-hrefs resolved shape + a `resolve.ts` entry (like `about`) and richer data modeling (pricing tiers/steps/FAQ; content/testimonials).

**Every cutover this session:** `astro check` 0 errors, eslint/prettier clean,
full suite green (870 netlify+src, 24 script), `build-diff` EMPTY. **Object-store
seed+publish still deferred to the handoff** (no production store in this sandbox)
— same posture as thank*you and the lede family; the committed `page*\*.json`exports are the derived-export half, publish reconciles the`\_\_generated` marker.

A separate `claude/state-of-play-cutovers` branch carries only this log entry, to
keep each cutover branch a clean single-purpose diff for review.

## Standing state (after session 2026-07-08)

| Area                                  | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Homepage cutover (T3.6/T3.7/T3.8)** | **DONE + verified.** `index.astro` is a thin loader over the published `page_home` object (`src/lib/renderer/resolve.ts`). `build-diff` EMPTY (203/203 identical); verify-section-components 5/5; astro check 0 errors. On branch `claude/phase-3-cutover`, not merged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **T3.4/T3.5 exports**                 | Materialized locally (`page_home.json`, `sec_newsletter_signup.json`) via the real materializers. Blob records still unpublished — a real `object_publish` reconciles the `__generated` marker only (handoff Step 2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Structural-capacity guardrail**     | **NEW.** `src/lib/registry/structural-capacity.ts` + `nav_actions_capacity` criterion (warn-only; content stays editable). The first "JSON-based hard rules" layer — fixed structure, agents decide content.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **T2.6**                              | **DONE** (was "parked"). `navigation.ts` + demo chain deleted; import chain verified self-contained.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **T3.13 extensibility drill**         | **DONE.** `testimonial` type added end-to-end; proves one-module-one-binding cost.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **nav_header incident**               | `nav_header.actions` is `[]` on `main` (test-probe fallout, not live). Fix is object-layer (handoff Step 1) — the guardrail, not a human gate, is the durable answer per Wolf's framing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Remaining to close Phase 3**        | All object-store operations: publish page/section (reconcile), T3.9 grid content (needs renderer wiring + curation), T3.11 route→page upgrade, release. **See `phase-3-handoff.md` for exact steps + payloads.** T3.10/T3.12 admin-UI deferred (block nothing).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **T3.9 content_grid code**            | **DONE.** `manual`/`query` rendering wired (`resolve-content-grid.ts` → `resolve.ts` + `ContentGrid.astro`, resolvers from `fetchPosts()`). Only the object-layer source-kind switch + curation remain (handoff Step 3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Phase 4 — lede family (T4.2/T4.3)** | **Cut over in CODE + verified.** New `lede` section type + component + shared `PageObjectRenderer`; 5 interior pages (start-here, member-updates, newsletter, free-guide, early-access) are thin loaders, `build-diff` EMPTY (203/203). Object-layer seed+publish is NEW records — handoff Step 4b.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **build-diff normalizer**             | **Extended** (`0e34ea4`) to drop class-attribute-value ORDER + CSS chunk-STEM (both content-neutral; astro-compress frequency-sort + Astro chunk renaming churn every page when a component is added). Required to verify any Phase 4 page cutover.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Self-describing object contract**   | **NEW** (`0212f55`). `object_contract(object_type)` MCP tool + `src/lib/registry/object-contract.ts`: one read-only call returns the full editing contract (body JSON-schema, all 16 section variants + fields, per-type patch ops with arg schemas + minted-id fields, constraints, publish policy, workflow, aux inputs) — all DERIVED from the enforcing code (`z.toJSONSchema`, `patchOpNamesByObjectType`, the registries, `activeApprovalPolicy`), so it cannot drift. `registry_get('component')` un-stubbed from the same source. Agents no longer guess what a valid body/op looks like.                                                                                                                                                                                       |
| **Live validation enforcement**       | **NEW** (`b48413c`). `netlify/lib/object-validation-context.ts` + injection at object-store.ts/admin-object.ts: the write path now runs the resolver-dependent criteria (reference integrity, PageType allowed/required sections, route uniqueness, template registry, taxonomy) that previously degraded to `optional`. So the boundaries the contract advertises actually bite. Regression-guarded: every committed export validates zero-blockers under the live resolvers.                                                                                                                                                                                                                                                                                                          |
| **Section-type catalog COMPLETE**     | **NEW** (`05de63e`, `4f9e9a1`, `f4d532b`). Bound the 8 schema-legal-but-unbound section types — `prose`, `cta_banner`, `faq`, `link_list`, `product_preview`, `contact_form`, `search`, `content_embed`. Every variant except `shared_ref` (dereferenced by the renderer, never a component) now has a component + editor hints and surfaces as `component_bound` in `object_contract` / `registry_get`. Reusable guardrailed primitives an agent can compose onto any page; `build-diff` EMPTY (additive registry entries — no page renders them yet). **Bespoke-page cutovers (about/contact/pricing/services/shop-preview) deliberately deferred:** their hand-tuned per-block markup can't be both byte-identical AND reusable-guardrailed (Wolf chose "finish the catalog first"). |

### Session 2026-07-08 (Phase 3 cutover, one long autonomous session)

Ran from a sandbox with **no route to the production object store** (no MCP
tools, no `PUBLISH_SECRET`, no egress — verified at start). So this session did
every **code + cutover** task and left every **object-store** task as a
documented handoff (`phase-3-handoff.md`). Five commits on
`claude/phase-3-cutover`, full suite green (848 netlify/src + 20 script), build
green, `build-diff` empty for the cutover.

**Landed:** the structural-capacity guardrail (the deconfliction framework Wolf
asked for — warns on over-budget header CTAs, never blocks content, deliberately
does NOT re-add the action↔menu duplication flag the seed's "exactly one warning
class" invariant forbids); T2.6 dead-code deletion; the two derived exports; the
homepage cutover (T3.6/T3.7/T3.8) verified byte-identical; the T3.13 testimonial
drill.

**Deliberately deferred (object-store / editorial / large admin-UI):** the real
publishes, the nav_header incident fix, T3.9 grid content (renderer wiring +
curation), T3.11 target upgrades, release, T3.10/T3.12. Phase 4 does not start
until the cutover pattern is exercised against production (handoff Steps 1–5).

**Judgment calls (per Wolf's "make reasonable decisions" directive):** treated
T2.7's old blocking rationale as superseded (approval policy is `all-autonomous`,
publish is agentic); kept the policy autonomous rather than re-gating (the fix
for the incident is the structural guardrail); materialized exports locally from
the canonical seed so the cutover could be verified, with the marker-reconcile
documented.

## Standing state (after session 2026-07-07)

| Area                              | State                                                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Configurable approval policy      | **Landed** (`b50c5e4` + follow-ups on PR #364) — replaces T1.4's hardcoded tier gate entirely. See "New model" below.                            |
| `netlify/lib/tier-gate.ts`        | **Deleted.** Replaced by `netlify/lib/publish-gate.ts`; `Tier` type and `tierForObjectType` are gone from the codebase.                          |
| Everything else from 2026-07-06 C | Unchanged — still standing as recorded below (T2.7/T2.6 waiting on Wolf, T3.2–T3.10 landed, homepage cutover still forbidden until T2.7 closes). |

### New model: configurable approval policy (replaces T1.4's hardcoded tiers)

The old scheme hardcoded publish permission by tier: Tier 1 (`content_item`)
untouched, Tier 2 (`page`/`section`/`template`) agent-publishes-after-approval,
Tier 3 (`navigation`/`taxonomy`/`site`) approval-plus-**human-executed**. That
fixed scheme is gone. There is now **one gate, one question, per object type**:
_does a change to this type require human approval before it can be published?_

- **Not gated (the default):** an agent proposes and publishes directly. Fully
  autonomous, no human in the loop.
- **Gated (opt-in):** an agent proposes → the change waits → a human approves
  → **the agent publishes it**. There is no separate "human executes the
  publish" step anymore — approval is the only human touch, on every governed
  type, not just former-Tier-2. If a further edit invalidates the approval
  (`content_revision` moves), it waits again.

**How Wolf flips posture — one file, no code changes:**
`src/config/approval-policy.ts`. Two levers:

```ts
export const approvalPolicyConfig = {
  master: 'all-autonomous', // or 'all-require-approval'
  overrides: {}, // e.g. { navigation: 'require-approval' }
} satisfies ApprovalPolicyConfig;
```

- `master` is the fast lever for the whole system's posture.
- `overrides` pins individual types (`page`, `section`, `navigation`,
  `taxonomy`, `site`, `template`) against the master, either direction.
- Resolution order: per-type override → master switch → hardcoded default
  `autonomous`. An unconfigured type in an unconfigured system is fully
  autonomous — this is the checked-in **dev-stage default** (`all-autonomous`,
  no overrides).
- `content_item` (articles) is structurally outside this config — the schema
  rejects it as an override key — and keeps its own pipeline (OQ-8), untouched.

**What's preserved verbatim from T1.4:** the `content_revision`-based approval
invalidation (an approval is invalidated by a body write, not by lock
checkout/checkin or the publish stamp — both still bump only `version`); the
M-6 publish-action pin exactness for agent execution on gated types; the
patch/inverse Discard mechanism. **What's decoupled:** audit-trail writing
(history attribution, patch+inverse capture, the publish receipt) never lived
in the gate to begin with — it's unconditional in `object-patch-apply.ts` and
`object-publish.ts` regardless of gate outcome, so an autonomous publish is as
attributed and revertible as an approved one. Nothing needed to change there;
this was verified, not assumed (see `publish-gate.test.ts`'s explicit
autonomous-publish-audit-trail assertions and the wiring tests in
`object-verbs-review.test.ts` / `publish-review-lifecycle.e2e.test.ts`).

**Module map:** `src/lib/approval-policy.ts` (pure resolution: `governedObjectTypes`,
`publishRequiresApproval`, zod-validated `resolveApprovalPolicy` that THROWS on
a malformed config rather than silently defaulting permissive) + `src/config/approval-policy.ts`
(the one editable file) + `netlify/lib/publish-gate.ts` (the server gate,
replacing `tier-gate.ts`) + `src/lib/admin/object-review-ui.ts` (client-safe
display-only mirror for the admin UI's button visibility — same policy, same
resolution, never the enforcement point).

**Consumers updated:** `object-verbs.ts` (gate + inventory both take an
injectable `approvalPolicy`, defaulting to the committed config),
`object-inventory.ts` (`tier` field replaced by `requires_approval`),
`mcp.ts`'s `object_inventory` tool (same rename), `admin-auth-state.ts` (comment
only, gate reference updated). Three scripts (`drill-footer-cta.mjs`,
`patch-nav-header-t28-t29.mjs`, `submit-navigation-review.mjs`) had their old
"expect-403 live agent publish probe" removed — under an autonomous posture
that probe would have actually **published**, not been refused, so firing it
blind was no longer safe; `--verify-tier3` is retired with an explicit error
pointing at the offline gate-matrix tests instead.

**Test matrix (`tests/netlify/publish-gate.test.ts`, new, replaces
`tier-gate.test.ts`):** every master × override × type combination in both
directions (master all-autonomous per type, master all-require-approval per
type, one override against each master for every governed type), the config
parse itself (dev default pinned; malformed configs throw; `content_item` and
typo'd keys rejected), M-6 pin exactness, the full content_revision
invalidation lifecycle (survives lock ops and the publish stamp, dies on a
body write), and two explicit "changing the config changes behavior
immediately" tests. `object-verbs-review.test.ts` and
`publish-review-lifecycle.e2e.test.ts` (the T1.8 exit drill) were rewritten at
the wiring/e2e level for the same model — including a new drill scenario
proving the replacement behavior end-to-end: gated navigation, approved by a
human, **published by the agent**, not a human.

Full suite green (822 netlify/src tests + 20 script tests, eslint/astro/prettier
clean) before this landed.

## Standing state (after session 2026-07-06 C)

| Area                   | State                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| T2.7                   | **STILL WAITING ON WOLF** — commands + clicks both run on his side (agent sandbox has no PUBLISH_SECRET and no egress to production); runbook §6  |
| T2.6                   | PARKED — Wolf alone                                                                                                                               |
| publishReceiptSchema   | **Approved + landed** (`df5e631`) — typed to the real buildReceipt shape; ObjectPublishReceipt derives from it                                    |
| T3.2 (M-9 + registry)  | **Done** (`57f878f` + `c292f7e`) — five components render 5/5 IDENTICAL to the live homepage via `scripts/verify-section-components.mjs`          |
| T3.3 (M-8)             | **Done** (`41bbc80`) — manual+fallback schema, validation, pure resolution helper for T3.6                                                        |
| Next (T3.4/T3.5)       | Reference-count validation (archive refused while referenced) + seed-page-home script (assembles from `home-fixture-data.ts` — one transcription) |
| T3.6+ homepage cutover | FORBIDDEN until Wolf's T2.7 clicks close Part 1                                                                                                   |

## Session 2026-07-06 C

Wolf's directives: receipt tightening approved (landed, `df5e631`); T2.7
"run the drill clicks" — **cannot run from an agent session**: no
`PUBLISH_SECRET` in the environment and the sandbox proxy blocks egress to
the production domain (verified empirically this session), and the
approve/publish clicks are architecturally human-only regardless (Tier 3 —
the drill exists to prove exactly that). The full command+click sequence
stays in runbook §6; every agent-side command is safe to run from Wolf's
machine as-is. Continued into Phase 3: T3.2 (with amendment M-9) and T3.3
(M-8) landed; T3.2's render gate compares component output against the live
homepage from the same build — the strongest available oracle — and passed
5/5. `index.astro` remains untouched (T3.6 is the cutover).

Continuation (same session, "keep working"): **T3.4+T3.5 seed half**
(`3c17c24`) — `scripts/seed-page-home.mjs` creates `sec_newsletter_signup`
then `page_home` with the seed-navigation discipline plus a schema-vintage
gate (the bodies use M-8/M-9 fields; a create rejection on those keys means
Phase 3 isn't deployed, not bad data); tests pin the seed deep-equal to the
T3.2 render fixture, so the seeded record IS the proven data. **T3.10 lib
half** (`050ada4`) — `netlify/lib/object-impact.ts` computes the real
affected-pages lists (shared_ref / navigationOverrides-then-site-default /
template provenance); `sec_newsletter_signup → page_home` pinned by test.

**Everything still open is gated**, none of it agent-completable offline:
T2.7 + T2.6 (Wolf), seed `--execute` + Tier 2 publishes (production creds,
post-deploy), T3.6–T3.9 cutover chain (forbidden until T2.7 closes),
T3.11 (needs published page objects), T3.10 admin wiring + T3.12 editor
(admin-UI surfaces — take them with a fresh session's full context), T3.13
(drill; also exposes that a new section type needs a union edit outside
the registry dirs — flag to resolve when run). **Open dependency noted:**
T3.4's archive-refusal needs an `archive` verb that does not exist yet —
object-impact provides the reference count it will consume; building the
verb is propose-first (new write path).

New gotcha for the log: Astro silently excludes underscore-prefixed files
in `src/pages` from routing — the render-gate fixture had to be named
without the `__` prefix.

## Standing state (after session 2026-07-06 B)

| Area                        | State                                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 + Phase 1           | Complete on `main`; both exit drills re-run this session from actual output (object-lifecycle 5/5, publish-review-lifecycle 4/4 covering the 5 scenarios)                 |
| Phase 2 (T2.0–T2.5, T2.8–9) | **Complete and live.** nav_header/nav_footer/nav_footer_home are CMS objects; chrome renders from published exports; T2.8+T2.9 end state verified (see §7 of the runbook) |
| T2.6                        | **PARKED — Wolf alone.** Production observation window, then the cleanup commit (runbook §5). Explicitly excluded from agent sessions                                     |
| T2.7                        | **READY FOR WOLF.** Agent side fully scripted + offline-verified; ordered checklist in runbook §6                                                                         |
| Object inventory (Part 2)   | **Done.** `object_inventory` MCP tool + `inventory` verb (commit `eed8cae`)                                                                                               |
| T3.1 PageType registry      | **Done** (commit `0a400c4`). `registry_get('page_type')` live; `listing`/`content_detail` typed-but-unimplemented until P6                                                |
| T3.2 component registry     | **Not started — next session's first task** (see "Next work" for the two decisions it needs)                                                                              |
| T3.3+ / homepage cutover    | Not started; **T3.5+ cutover remains forbidden until Wolf closes Part 1's human steps** (T2.7 clicks are the acceptance gate)                                             |

## Session 2026-07-06 B (this session)

Branch: `claude/phase-2-nav-footers-fdwfpt`, restarted from `main`@`e09e608`
(prior PR #362 merged; branch carried no unmerged work).

**Verification battery (mandate-required, all read from real state):**

- `main` tip `e09e608 Publish navigation: nav_header` — Wolf ran the
  T2.8+T2.9 patch + publish AFTER the premature #362 chrome merge; the
  rehearsed regression window closed itself. Recorded in runbook §7.
- `origin/main:src/data/site/navigation/nav_header.json` body deep-equals
  `applyPatchOps(seed, NAV_HEADER_T28_T29_OPS)` exactly (record_version 20;
  actions `['Join Early Access','Join Newsletter']`; `i_early_access` gone).
- `main` builds green (210 HTML files); rendered header carries both action
  containers with `data-newsletter-cta` in each; the only remaining
  'Early Access' label is the `nav_footer` link T2.7 edits by design.
- Phase 0 + Phase 1 exit drills pass from actual output.

**Landed (one task, one commit):**

- `6ac2c47` — T2.8+T2.9 runbook truth-up (executed record incl. the
  out-of-order merge; T2.5 gate marked PASSED 210/210).
- `bb28864` — T2.7 agent side: `scripts/drill-footer-cta.mjs` (two legs,
  pre-flight state gate, Tier 3 refusal check, submit-only),
  `scripts/lib/nav-footer-t27-drill.mjs`, offline tests proving both legs
  through the real T0.6/T0.7 engine (revert restores the seed byte-exactly);
  runbook §6 rewritten as the ordered agent/human checklist.
- `eed8cae` — Part 2: `object_inventory` MCP tool + `inventory` verb.
  Read-only; per object: tier, lock (held/free/holder/expiry, never the
  token), review state incl. `'none'`, version, content_revision,
  published_time, published_content_revision (from the T1.3 receipt),
  `unpublished_changes`; filters status/tier/review_state/pending_changes;
  single-object detail view. No new stored state.
- `0a400c4` — T3.1: PageType registry v1 (`src/lib/registry/page-types.ts`)
  - `registry_get('page_type')` serving definitions with a
    JSON-schema-rendered shape.

**Waiting on Wolf (ordered):**

1. **T2.7 drill** — runbook §6 checklist. Agent steps are scripted; your
   steps are the two review/approve/publish clicks (forward leg, then
   revert leg). This is the Phase 2 acceptance test and the gate the
   homepage cutover (T3.5+) waits behind.
2. **T2.6** — whenever you're satisfied with the production observation
   window: say so, and the cleanup commit gets prepared per runbook §5
   (delete `src/navigation.ts` + demo pages, build-verified).
3. **Proposal (shared-interface, not acted on):** `publishReceiptSchema` in
   `src/schema/object-record-v1.ts` is a loose `z.record(...)` while
   `buildReceipt` (T1.3) writes a rich fixed shape the new inventory now
   reads (`content_revision`). Tightening the schema to the real shape would
   let consumers rely on it — but it's a Phase 1 file, so it needs your nod.

**Next work (for the next agent session):**

1. **T3.2 component registry + section components** — deliberately deferred
   whole rather than half-landed. Two decisions to make at session start:
   (a) render-test vehicle for `.astro` components under the repo's
   tsc+node--test harness (Astro's experimental Container API needs a vite
   pipeline; options: a small vite-based test entry, or snapshot the built
   HTML via the T2.0 harness instead), and (b) whether registry modules
   import per-variant zod schemas from `section-v1.ts` (single source of
   truth stays in schema land) or the reverse. Extraction itself is
   mechanical: `index.astro:89-201` → five components, markup-verbatim.
2. T3.3 (M-8 content_grid manual+fallback), T3.4 (shared newsletter
   section), T3.5 seed script — in order, after T3.2.
3. Homepage cutover (T3.6/T3.7) only after Wolf's T2.7 clicks close Part 1.

**Gotcha log (recurring):**

- `*/` inside a JS block comment terminates it — bit T2.4's docs once and
  this session's drill script once (`--execute-*/--verify`). Write flag
  pairs without the slash-star adjacency.
- `node --test tests/scripts/` (directory form) fails; use the glob.
- The Astro content store bleeds across worktrees via symlinked
  node_modules — `scripts/build-diff.mjs` purges it per build; do the same
  in any new harness.
