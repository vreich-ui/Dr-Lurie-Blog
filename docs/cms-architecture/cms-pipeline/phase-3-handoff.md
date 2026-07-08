# Phase 3 handoff — the object-layer remainder

**Branch:** `claude/phase-3-cutover` (off `origin/main`). Nothing here is live —
every object-export commit carries `[skip netlify]`, so production is untouched
until an explicit release.

This session closed the **code + cutover** half of Phase 3 from a sandbox with
**no route to the production object store** (no MCP tools, no `PUBLISH_SECRET`,
no egress). Everything that remains to fully close Phase 3 is an **object-store
operation** (or an editorial decision), which must run from a session that has
the Dr-Lurié MCP tools or the admin UI. This file is the exact to-do.

---

## Done this session (committed, full suite green: 853 + 20)

| Commit                           | What                                                                                                                                                                                              | Verified                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `structural-capacity guardrail`  | New `src/lib/registry/structural-capacity.ts` + `nav_actions_capacity` criterion — warns (never blocks) when a header carries more CTAs than it renders comfortably; content stays fully editable | nav/validate suites                                                                           |
| `T2.6 delete dead navigation.ts` | Removed the inert `navigation.ts` + `LandingLayout` + `homes/saas` + 6 `landing/*` demos (import chain verified self-contained)                                                                   | build green, 202 pages                                                                        |
| `T3.4/T3.5 materialize exports`  | Generated `page_home.json` + `sec_newsletter_signup.json` via the real materializers from seed data                                                                                               | build unchanged (parallel path)                                                               |
| `T3.6/T3.7/T3.8 cutover`         | `index.astro` is now a thin loader over `page_home`; new `src/lib/renderer/resolve.ts`                                                                                                            | **build-diff EMPTY (203/203)**, verify-section-components 5/5 identical, astro check 0 errors |
| `T3.13 testimonial drill`        | New `testimonial` section type proving the one-module-one-binding extensibility cost                                                                                                              | registry invariants, astro check                                                              |
| `T3.9 code half`                 | `manual`/`query` content_grid rendering wired into `resolve.ts` + `ContentGrid.astro`, resolvers built from `fetchPosts()` in `index.astro`                                                       | 12 new resolver tests, build-diff still EMPTY (seed unchanged)                                |

**Phase 3 exit criteria status:** empty `/` diff ✓ (with the transitional
static grid, which the criteria explicitly permit); testimonial-touches-only-
registry ✓. The remaining two criteria (agent edit flow against production; no
`route`-kind targets for pages that now exist) are the object-store operations
below.

---

## STEP 0 — reconnect the MCP session first

The four review/publish tools and `release_to_production` shipped in PR #365.
If your agent session predates that deploy, its cached `tools/list` won't show
them (the server advertises `tools.listChanged:false`). **Start a fresh MCP
session** so `object_publish` / `object_submit_review` / `release_to_production`
are visible. Confirm with `object_inventory` before proceeding.

---

## STEP 1 — fix the nav_header incident (content regression)

`src/data/site/navigation/nav_header.json` currently has `"actions": []` on
`main` — both header CTAs were dropped during test-probe publishes on 2026-07-07
(the footers are clean). Not live yet only because of `[skip netlify]`. Restore
the two audited actions on the **object record** (editing the export directly
would drift and be overwritten on the next publish):

```
object_checkout  navigation nav_header            → lockToken, record_version
object_patch     navigation nav_header  (upsert_action ×2):
    { label: "Join Early Access", style: "primary",
      target: { kind: "route", href: "/solutions/early-access" } }
    { label: "Join Newsletter",   style: "secondary",
      target: { kind: "route", href: "/newsletter" } }
object_publish   navigation nav_header            → commits nav_header.json (actions restored)
object_checkin   navigation nav_header
```

`object_validate` first — the new capacity guardrail will report
`nav_actions_capacity: complete` at 2 actions (budget is 3). This is also the
first live exercise of the guardrail.

---

## STEP 2 — publish the seeded page + section (reconcile the exports)

The blob records for `sec_newsletter_signup` and `page_home` were seeded
(`3c17c24`) but never published. I materialized their exports locally so the
cutover could build and verify; a real publish re-materializes them
byte-identically and only rewrites the `__generated` marker
(`at`/`record_version`) — a harmless one-field reconcile that does NOT change
rendered HTML. Publish the section BEFORE the page (reference order):

```
object_checkout/publish/checkin   section sec_newsletter_signup
object_checkout/publish/checkin   page    page_home
```

After this, `git diff` on the two export files should show only the marker
changing. If more than the marker moved, the blob record drifted from the seed
— investigate before releasing.

---

## STEP 3 — T3.9: real start-here grid (data + curation — code is DONE)

The homepage still shows the seed's **static placeholder** start-here cards
(intentional — the cutover reproduced them byte-identically). T3.9 replaces
them with real article cards (M-8 manual+fallback).

**Renderer wiring is done** (`resolve-content-grid.ts` is now wired into
`resolve.ts` + `ContentGrid.astro`; `index.astro` builds sync resolvers from
`fetchPosts()`, only loaded when a page needs them). `manual`/`query` sources
render today — verified with unit tests (`renderer-resolve.test.ts`) and a
full `build-diff` (still EMPTY, since the seed hasn't switched source kind
yet). What's left is purely the object-layer step:

1. **Data (object edit):** `object_patch` `page_home`'s `s_startgrid` section
   `source` from `{kind:'static',…}` to
   `{kind:'manual', items:[…3–5 curated article ids…],
  fallback:{kind:'query', query:{sort:'published_time_desc'}}}`. Manual item
   ids are the astro content-collection post `id` (matches `src/types.d.ts`
   `Post.id`, resolved via `fetchPosts()` in `index.astro` — same identifier
   space `findPostsByIds` already uses elsewhere).
2. **Curation (your editorial call, not automated):** hand-pick 3–5
   beginner-appropriate posts from `src/data/post/*.md` matching the
   placeholder framing; **exclude** the `*smoke-test*` / `dubl-*` junk posts
   present there. The fallback query (`published_time_desc`, no category
   filter) auto-fills any remaining slots up to `limit` if fewer than `limit`
   manual picks are supplied or any fail to resolve — this is the "grid fills
   itself if nothing's chosen" behavior; it fills with the **most recent**
   published posts, not randomly (no `random` sort exists in `ContentQuery`
   today — flag if you want that added, it's a small addition).

Verify: `build-diff` should now show a diff **scoped to `/`'s grid only** —
inspect it, confirm it's exactly the placeholder→real-cards change.

---

## STEP 4 — T3.11: upgrade `/` nav targets route → page

Now that `page_home` is published, upgrade the `route`-kind `/` targets to
`{kind:"page", page:"page_home"}` on the three nav records (`nav_header`
`i_home` + `g_start_here` group target; `nav_footer`/`nav_footer_home` `i_home`).
`object_validate` confirms the page reference resolves and is published (the
`nav_published_targets` criterion); materialized href stays `/`, so `build-diff`
remains empty.

---

## STEP 5 — release to production (the one irreversible step)

Only after Steps 1–2 (and optionally 3–4) look right:

```
release_to_production      → POSTs the build hook once, waits, verifies HEAD is live
```

⚠️ **Netlify "Auto Publishing" must be unlocked** and builds active, or this
returns `released:false` / `build_not_confirmed_live` (a locked deploy builds a
preview without moving production).

---

## Deferred (larger, not blocking Phase 4's start)

- **T3.10 admin impact-preview wiring** — lib done (`object-impact.ts`); the
  admin-UI surface (`src/pages/admin/objects/[objectId].astro`) is unbuilt.
- **T3.12 page editor completion** — admin-UI, large; scripts (not the editor)
  drive seeding, so it blocks nothing downstream.

## Superseded framing (correct the mental model)

The old "T2.7 drill gates the homepage cutover" rule assumed T1.4's hardcoded
human-execute tier. That model is gone: the approval policy is configurable and
committed at `all-autonomous`, and `review_decide` + `object_publish` are both
agent-callable (PR #364/#365). The cutover was gated on _byte-identical
verification_, which passed here — not on a human click. T2.6 is now **done**,
not parked.
