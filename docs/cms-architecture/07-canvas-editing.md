# 07 — The edit-mode canvas (admin inline AI editing)

Wolf's call (2026-07-12): _"if logged in as an admin with edit rights an
editor would be able to use the entire site (its objects) as canvas … hover
over any qualifying object shows an 'Ask AI' button … output appears in place
of old text, but not yet published (draft). Publish needs to be acted upon
separately."_ Scope rulings from the same call: **layer over the existing
conversion machinery** (no new write paths), **stop at the article publishing
engine** (the article pipeline keeps its own tools untouched — OQ-8 remains
open), and **ignore the old admin editor in favor of this UX** (it stays, it
just gets no further investment).

## What shipped (2026-07-12, this doc's session)

The public site is now the editing surface for a signed-in admin. Everything
below rides the standing verbs — there is **no new mutation path**: Ask-AI
proposes (read-only), `object_patch` persists under lock, `publish_by_time`
commits the export `[skip netlify]`, `release_to_production` fires the one
build hook. The canvas is a _client_ of the T1.4/T1.6 machinery, exactly as
an agent is.

### 1. Section identity in the built HTML

Both dispatch sites — `PageObjectRenderer.astro` and `ObjectSections.astro`
(the latter now takes a required `objectId` prop from the six listing
routes) — wrap every rendered section in a `display:contents` element:

```html
<div
  style="display:contents"
  data-cms-object-id="page_home"
  data-cms-section-id="s_newsletter"
  data-cms-section-type="newsletter_signup"
  data-cms-shared-object="sec_newsletter_signup"
>
  <!-- only when shared_ref -->
</div>
```

`display:contents` generates no box: layout, CSS, and the audited markup are
untouched (verified — the built pages differ from pre-canvas builds by these
attributes only). `resolveSections` now keeps the dereferenced `sec_*` id on
`RenderableSection.sharedObjectId`, so the annotation can encode the routing
law: **shared content is edited on the shared object, never on the
referencing page.** Helper + tests: `src/lib/renderer/section-annotations.ts`,
`tests/netlify/section-annotations.test.ts`.

Object ids were already public (the derived exports are committed to git), so
the annotations leak nothing.

### 2. Section-scoped Ask-AI (server, additive)

`admin-ask-ai-object` accepts an optional `section_id` (page objects only).
The forced tool derives from **that section type's own `data` schema**
(`sectionDataSchemaForType`, generic over the `section.v1` union — a new
section type is served the moment its union member exists), the prompt
carries just the section framed by its page, and the suggestion maps 1:1 onto
one `update_section_data` op. A `shared_ref` scope is refused with the target
`sec_*` id. A shared **section object** request auto-scopes to its inner
instance and returns the inner id — exactly what a patch on that object
targets. Still suggestion-only: `applied: false`, no lock, no writes.
`content_item` remains refused (the article Ask-AI keeps its own path).

**Provider (2026-07-12):** the generic canvas Ask-AI runs on **OpenAI**
(Chat Completions function-calling; `OPENAI_API_KEY`, model `OPENAI_MODEL`
default `gpt-4o`). The zod-derived tool schema is plain JSON Schema, so it is
OpenAI's function `parameters` verbatim and a forced `tool_choice` keeps the
reply structured. The swap is provider-only — the read-only contract, section
scoping, and the human Accept gate are unchanged. (The article Ask-AI,
`admin-ask-ai-node.ts`, is a separate system and keeps its own provider.)

**Copy-only guard (2026-07-12):** the section-scoped tool schema strips
**protected fields** — media/asset URLs (`portrait`, `*AssetRef`, `logo`,
`icon`, `ogImage`, `src`…), references/bindings (`source`, `products`,
`contentItem`, `section`, `formName`, `actions`/`links`…), and
structure/routing (`route`, `sections`, `slug`, `anchor`…) — via
`isProtectedAskAiField` (`ask-ai-schema.ts`), with a defensive re-strip of the
returned suggestion. The copy AI can therefore change **text only**; it can
never rewrite or invent an image/link, even if it tries. This closes the
About-portrait incident: a heading edit that also swapped a real local image
for a hallucinated CDN URL, breaking the page on publish. Whole-object admin
asks (site/nav/template — the deliberate JSON-review surface) keep every field
(`protectFields` is off there). A future manual (non-AI) field editor is the
sanctioned path for deliberately changing an image.

### 3. The overlay (`src/lib/edit-mode/`)

- **Dormant loader** (`EditMode.astro`, included by `Layout.astro`): ~1.5 KB;
  without a GoTrue session in localStorage it does nothing — no editor chunk
  is fetched, no network call is made (browser-verified). With one, the
  editor chunk (~27 KB, code-split) loads and `index.ts` re-verifies properly:
  token via `goTrueClient`, then server-side `admin-auth-state`
  (`ADMIN_EMAILS` allowlist). Never mounts under `/admin`.
- **Edit mode** (pencil FAB → top bar): hover any annotated section → chip
  with type, object id, `shared` / `draft` flags, and ✨ Ask AI. Selecting
  text first arms the request with `selected_text` (the T1.6 capture helper).
- **Panel**: reads the DRAFT record (`get`) so diffs are against the store,
  not the DOM; sends the scoped Ask-AI request; renders per-field old→new
  diffs; **previews in place** via a conservative swap (`preview.ts` — built
  on the REAL rich-text splitters; a field that can't be located unambiguously
  falls back to the panel diff, honestly labeled). Amber dashed framing =
  draft, everywhere.
- **Accept** → `EditSession` (`verbs-client.ts`): checkout via the shared
  `LockManager` (auto-refresh, unload beacon), then `update_section_data`
  under lock with `expected_record_version` (409 → refetch-retry once).
  Validation blockers (422) surface in the panel; a foreign lock names its
  holder. Discard restores the exact pre-preview DOM snapshot.
- **Pending tray**: `inventory {pending_changes:true}` — every object whose
  draft is ahead of its publish receipt, with per-object **Publish**
  (checkout → publish → checkin; publisher/admin role required, and the
  server-side publish gate remains the enforcement) and **Release to
  production** (the one build hook; result status shown). Draft objects'
  regions carry the amber flag on page load, so unpublished state survives
  reloads and is visible to every admin.

### 3b. Manual tools (2026-07-12, Wolf: "add text edit tools to each relevant object")

The chip is now an **icon toolbar** — no "Ask AI" wording. Right-to-left:

- **✨ Sparkles** (AI chat, as before) — the stars render in `--dlem-spark`, a
  brightened site gold, deliberately a notch brighter than the neighboring
  tools so the AI action reads first. Selection-armed = gold glow ring.
- **✏️ Pencil — Edit text**: a field form of the section's COPY (strings →
  inputs, rich-text → textarea with the allowlist noted, string lists → one
  per line). Structured values (actions, FAQ items, quotes) stay AI/admin
  work. **Save draft** goes through the same checkout → `update_section_data`
  path; in-place preview; publish stays separate.
- **🖼 Image** (section types with image fields — `bio` and `content_split`,
  incl. image ARRAYS with one src/alt pair per item): src + alt inputs with a
  live thumbnail. This is the DELIBERATE way to change an image — the
  complement of the copy-only AI guard. Each src row has an **Upload** button
  (see 3c) or takes a path/URL directly.

**Gap "+" affordances**: in edit mode, a small round + sits above the first
section, between sections of the same page object, and below the last. Click
→ a compact palette (`sections-palette.ts`, pure + unit-tested: every starter
body is schema-valid under the real section.v1 union and splitter-safe, so a
quick-add can never 422): Text, Intro header, Call to action, Checklist, FAQ,
Quotes, Newsletter signup. Reference/binding types (content_grid,
product_preview, contact_form, search, shared_ref) are deliberately absent —
a quick-add cannot responsibly invent references. Insert = `upsert_section`
at a RECORD-derived position (hidden sections still occupy indices; anchored
by section id, never DOM order), id minted server-side; an honest draft
placeholder appears in place (annotated — immediately editable with the same
tools) until publish + release renders it for real.

### 3c. Blob-backed image uploads (2026-07-12, Wolf: "stored in blobs … as happens now with pdf-tool")

Canvas images live in the blobs `artifacts` store, exactly like pdf-tool
PDFs — no new write path, the EXISTING tokened pipeline end to end:

1. **Intent (new, admin-gated)**: `admin-artifact-upload-intent.ts` (pure core
   `netlify/lib/canvas-upload-intent.ts`). The browser sends
   `{ object_id, content_type, size_bytes, sha256 }` under the Identity token;
   the server mints the standard short-lived HMAC upload token
   (`createArtifactUploadToken`, 15 min TTL) with server-controlled claims:
   `requestId = req_canvas_<object>_<yyyymmdd>_01` (canvas uploads are
   traceable per object and can never write outside `image/req_canvas_*`),
   `artifactKind: 'image'`, filename minted from the content type. Only
   JPEG/PNG/WebP — the types the save-side sharp validation accepts — get a
   token at all.
2. **Bytes**: the client POSTs the raw file to the same `/api/artifacts/upload`
   agents use; the endpoint re-verifies size/sha256/decodability (sharp)
   against the signed claims. Content-addressed key:
   `image/<requestId>/<sha256>.<ext>`.
3. **Serving (new, public)**: `/img/*` → `get-public-image.ts`, the image
   mirror of `get-public-pdf.ts` (same netlify.toml redirect pattern). Keys
   are unguessable without the sha256 of the exact bytes; extension
   allowlisted; immutable cache (`max-age=31536000`) because the key is
   content-addressed; CSP + nosniff headers for defense in depth.
4. **The section's `src`** gets the root-relative `/img/…` path — deploy-safe
   (no external host) and rendered by the existing components untouched. The
   src change itself still goes through checkout → patch → publish → release;
   the upload alone changes nothing visible.

Client flow (`uploadImageArtifact` in `verbs-client.ts`, Upload button per
src row in the image form): hash the file with `crypto.subtle` → mint intent
→ POST bytes with the claim-echo `X-Artifact-*` headers → fill the src input
with the returned public path → human hits Save draft.

### 3d. AI image references — "Re: portrait.png" (2026-07-12, Wolf)

Opening the AI chat on a section that carries images shows **image chips**
(thumbnail + filename). Clicking one arms the reference:

1. **Ensure blob-backed** (`ensureBlobBackedImage`, verbs-client): a src
   already under `/img/*` passes through; an existing repo image
   (`/images/…`, hashed build assets) is fetched same-origin and **mirrored
   into the blobs artifacts store** through the same intent → upload pipeline
   — so ANY referenced image ends up with a blob copy and a public URL agents
   and external image tooling can fetch to manipulate the exact bytes.
   Mirroring is storage-only: the section's src is untouched.
2. **Armed chat**: the composer placeholder becomes `Re: <name> — …`, the
   sent message renders a `Re: <name>` pill, and every ask carries
   `image_ref { field, name, url }` (absolute public URL).
3. **Server** (`ask-ai-object.ts` + wrapper zod): the section prompt gains a
   "Re: `<name>` — publicly served at `<url>`" clause so the model knows
   exactly which bytes "the image" means. **The copy-only guard is
   unchanged** — image fields still never survive a suggestion; the reference
   is context (and the handle downstream image-editing tools need), not a
   write path. Actually re-pointing an image stays the image tool's job.

### 3e. Panel UI — icon-led collapsible accordion (2026-07-12, Wolf)

The docked panel is one **accordion**: three icon-headed sections
(✨ Ask AI / ✏️ Edit text / 🖼 Image), one expanded at a time (the open one
grows; the rest are a single head with a chevron). A chip tool opens its
section; the accordion heads switch between tools in place (no re-hover);
clicking the open head collapses the body to a compact rail. The Image
section only appears for image-bearing section types. Chrome is
**iconography over prose**: identity is a `type` + monospace `id` with tiny
shared/draft dots (no sentences), actions are icon buttons with tooltips
(check = save, undo = discard, paper-plane = send, up-arrow = upload), and
the sys/log lines are terse and glyph-prefixed. Every color is a
project `--aw-*` design token (via the `--dlem-*` layer) — nothing bespoke;
it flips light/dark with the site.

### 3f. Tier-1 surfaces: article pages, chrome, the related-articles block (2026-07-12, Wolf)

**Article pages.** `page_article`'s object sections already rendered through
the annotated dispatcher — but the object was empty, so articles had no
canvas. Now: (a) `ObjectSections` leaves a zero-height
`data-cms-empty-object` marker when a page object has no sections, and the
gap layer turns it into one add "+" — the FIRST section of an object-empty
page is addable from the canvas (create → publish → release, no code);
(b) the article route passes the current post into resolution, anchoring
`related` grids. The article BODY (title/hero/prose) stays the Tier-1
pipeline (OQ-8 stop line) — `/admin/publish` remains its editor.

**"Other articles to read".** `content_grid` gained a `related` SOURCE KIND
(design-principles: generalize, don't invent a bespoke type):
`{ kind: 'related', algorithm: 'tag_similarity' | 'same_category' | 'latest' }`.
`tag_similarity` is the site's existing scoring (same category +5, each
shared tag +1 — now the pure `rankRelatedPosts`, single source of truth with
the legacy furniture); anchored to the current post on article pages,
newest-first anywhere else, so the section is legal on any page. The chip on
a related grid grows a **compact algorithm dropdown inline with the AI
button** — switching it patches `source.algorithm` through the normal draft
path (checkout → `update_section_data` → publish stays separate). The
palette offers "Related articles" (the one content_grid shape a quick-add
can create: reference-free). When `page_article` carries a related grid, it
REPLACES the hardcoded `RelatedPosts` furniture; until then the legacy block
renders exactly as before. Related-grid titles link to their posts
(query/manual grids keep the audited unlinked markup).

**Chrome (header/footer).** `PageLayout` (and the per-page footer override)
wrap Header/Footer in `data-cms-nav-object` annotations. Hovering chrome
shows the chip (marked **site-wide**); the pencil opens a copy form of the
NAVIGATION object — item labels (children included), group titles, brand
text/descriptor, footer note — flattened by the pure `nav-editor.ts`, and
saved through the nav grammar (`update_item`, `upsert_group` replace-by-id,
`remove_action`+`upsert_action` for label-keyed renames, coalesced
`set_nav_meta`), never page ops. Targets/hrefs/icons are deliberately not in
the form — retargeting is structural work (the Ask-AI protected boundary),
and chrome offers no AI chat (copy form only).

### 3g. Field-test refinements (2026-07-13, Wolf's first live canvas session on the article)

Six fixes from Wolf's field test of /object-model-demo, all verified by a
16-assertion headless-Chromium drive of the built site (mocked admin
endpoints):

- **Block ROLE replaces the req\_\* id** (chip + panel header): an article
  block's identity slot shows its strategy — `Hook · educate`,
  `Resolution · reassure` — never the object id (kept in the header tooltip).
  Roles come from the draft record (one cached fetch per article) because the
  leak rule keeps strategy OUT of the built HTML; sections keep their ids
  (short and meaningful there). Wolf's rule recorded: **what's on screen must
  be what an editor needs at the moment of action.**
- **Image tool ADD path**: a content node with no `public.media` now offers
  empty src/alt rows + Upload (before: "no image fields", dead end). Save
  seeds `{ type: 'image' }` on the new media object (content_item only —
  section image objects stay `{src,alt}`-strict).
- **Panel is content-sized**: no longer pinned top-bar→viewport-bottom; grows
  with content, capped (`max-height`), bodies scroll internally
  (log ≤44vh, form ≤52vh). One-section-at-a-time accordion unchanged.
- **Busy dots**: every wait (Ask-AI round trip, record load, save, mirror)
  shows animated dots; the send button disables while a request is in flight.
- **Article CTA renders like a real site button**: `not-prose` + `font-sans`
  on the action-node CTA — inside `editorial-prose` the typography plugin's
  `prose-a` color beat `.btn-primary`'s `text-white` (invisible label on the
  filled button) and the serif font leaked into it. Renderer-owned classes;
  agents can't reintroduce it (they only write ctaText/ctaLink data).
- **Print/share fixed under view transitions**: SinglePost's inline script
  registered once per hard load; a ClientRouter-swapped article page had
  unwired buttons. Now re-wires on `astro:page-load` with a data-wired guard.

### 3h. W7.7 canvas capability slice (2026-07-13): the node palette, the ad bank, the annotation panel, multi-image

The article body becomes fully composable from the canvas — 19-assertion
headless drive of the built probe page, all green:

- **Node palette** (`nodes-palette.ts`, pure + tested): a "+" before/between/
  after article blocks (label: "Add an article block" — never the req\_\* id)
  offering nine starters: Text, Heading+text, Checklist, Image, **Image
  gallery**, **Call to action**, **Offer/affiliate** (disclosure + `nofollow
sponsored` pre-filled — an editor cannot insert an undisclosed unit), **Ad
  slot (mock)**, **Chat invite**. Every starter is schema-valid with the
  semantic annotation from birth; insert = `upsert_node` at a RECORD-derived
  position, id minted server-side (the missing `mintOpsIds` branch for
  `node.id` was found and fixed — the contract had advertised it since W7.3),
  honest draft placeholder until publish + release.
- **The adSlot mockup bank** (render-nodes.ts): three renderer-owned units —
  native in-feed card, leaderboard, medium rectangle — rendered ONLY for
  `adSlot.provider: 'mock'` (a real provider config still renders nothing:
  mockups never masquerade as live inventory). Honestly labeled
  Advertisement/Sponsored + "Ad" chip like real served units; fictional
  advertiser; self-contained (no external assets); overridable via node
  public copy + `commercial.sponsorName`/`destinationUrl`; switch creative
  via `commercial.creativeId` (`mock-native` / `mock-leaderboard` /
  `mock-rectangle`).
- **Role & intent panel**: a fourth accordion section (🏷, article blocks
  only) — strategy dropdown (the 12 values), intent dropdown (5), agent
  notes. Saves ride `update_node` on `private` fields; '' clears via null;
  chip + header roles refresh from the record (cache invalidated). The
  semantic layer is now HUMAN-editable, not JSON-only.
- **Multi-image**: content nodes gain optional `public.images[]` (each entry
  a full media object, rendered in order as figures). The image tool renders
  a src/alt row per image with Upload, plus **Add image** to grow the
  gallery; an emptied src removes that image on save. One-image-per-node
  stays the norm (the node is the annotation unit) — the gallery is the
  sanctioned multi-image option (Wolf, 2026-07-13).

### 3i. Field-test refinements, round two (2026-07-13, Slice B)

Eight fixes from Wolf's second live session (15-assertion drive + the two
earlier drives re-run green):

- **Metadata row**: category + tag links join "N min read · date" in the
  SinglePost header (registry labels; both article families).
- **Record preload**: entering edit mode warms a shared record cache for
  every object on the page (one parallel get each) — chips, panels, the tray
  and the role editor open from memory; writes invalidate their entry;
  failed fetches never stick.
- **Pending tray speaks human** ("object · verb · location"): rows show the
  object's TITLE and a change summary derived from the record's history
  since its last publish — "Image added to Resolution", "Text edited in
  Hook · +2 more". The req\_\* id survives only as a tooltip.
- **Chip/panel identity de-boilerplated**: an article block's chip is just
  its role ("Hook · educate") — no "article content", no ids.
- **Image placeholder**: the thumbnail never shows the browser's
  broken-image glyph — hidden until an image actually loads; a neutral
  "no image yet" box otherwise.
- **In-place image preview**: a newly-added image previews as an appended
  figure on the block immediately after save; an emptied src removes its
  element (matching the text tools' behavior).
- **Button system**: Save draft uses the accent (the green was off-palette),
  full state set (hover/active/focus-visible/disabled), and is informative —
  "Saving…" while in flight, "✓ Saved" confirmation, restore on failure.
- **Bullet points**: ALWAYS offered on a content block ("Bullet points",
  one per line) — text blocks can gain a list from the canvas (before,
  lists were only editable where they already existed) — and the list
  previews in place on save (create/update/remove the block's <ul>).
  Field labels are editor-facing throughout (Text, Heading, Kicker,
  Button text…).

**Ruling recorded (Wolf, same session): the W7.7 remainder is ON HOLD** —
the old admin-editor UI is stale and the admin area is being rethought; no
TipTap panel work or /admin/publish re-wire until that lands.

### 4. What is deliberately NOT in this slice

- **Articles.** No chips on article bodies (they carry no annotations). The
  article editor at `/admin/publish` keeps its proven per-node Ask-AI.
  Bringing articles onto the canvas is the W7/OQ-8 decision — the stop line
  Wolf drew.
- **Structural ops** (add/move/remove section, page meta, nav/site/taxonomy
  chips). The grammar supports them; the canvas UI doesn't yet. Next natural
  slice, cheap to add: same panel, different ops.
- **True draft re-render.** In-place preview is a field-level swap; structural
  changes preview only in the panel. Pixel-true draft rendering is the OQ-9
  SSR spike (T6.6) — the canvas plugs into it when it exists.
- **W7 rich text.** The canvas works on today's TipTap-HTML fields; moving
  section bodies (then articles) to Contentful Rich Text upgrades selections
  to node-anchored patches and unlocks embeds. Planned as the next
  conversion wave; nothing here blocks or presupposes it.

## Verification record (2026-07-12)

- 1071/1071 tests (unit + scripts), astro check 0 errors, eslint/prettier
  clean, full build (167 pages).
- **Headless-browser drive against the real built site** (mocked endpoints):
  dormant visitor path (zero admin calls, zero editor chunk) → admin gate →
  chips → section-scoped ask (wire shape asserted) → in-place heading
  preview → Accept (checkout + correctly-shaped `update_section_data` with
  lock token + expected version) → pending tray → publish under lock →
  release. One real bug found and fixed by the drive (chip re-render killed
  the button's click).
- **Not yet proven**: the credentialed end-to-end run against production
  (real Identity login, real Blobs, real OpenAI call, real release). Same
  sandbox boundary as every conversion — first production session should
  walk one edit on a low-stakes page (e.g. page_thank_you) through
  draft → publish → release.

No new env is required: `OPENAI_API_KEY` (already configured — ChatKit and the
publisher agent use it) with an optional `OPENAI_MODEL` override,
`ADMIN_EMAILS` / role lists, and the build hook are the ones already
configured.
