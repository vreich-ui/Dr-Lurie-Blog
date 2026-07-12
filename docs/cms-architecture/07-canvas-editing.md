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
build hook. The canvas is a *client* of the T1.4/T1.6 machinery, exactly as
an agent is.

### 1. Section identity in the built HTML

Both dispatch sites — `PageObjectRenderer.astro` and `ObjectSections.astro`
(the latter now takes a required `objectId` prop from the six listing
routes) — wrap every rendered section in a `display:contents` element:

```html
<div style="display:contents"
     data-cms-object-id="page_home"
     data-cms-section-id="s_newsletter"
     data-cms-section-type="newsletter_signup"
     data-cms-shared-object="sec_newsletter_signup">  <!-- only when shared_ref -->
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
  (real Identity login, real Blobs, real Anthropic call, real release). Same
  sandbox boundary as every conversion — first production session should
  walk one edit on a low-stakes page (e.g. page_thank_you) through
  draft → publish → release.

No new env is required: `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL`,
`ADMIN_EMAILS` / role lists, and the build hook are the ones already
configured.
