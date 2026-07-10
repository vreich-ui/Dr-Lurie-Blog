# CMS Object Inventory — Dr. Lurié

**What this is:** the human-readable catalog of every content object the Dr. Lurié
site is (or should be) made of — what each object is _for_, where its _boundaries_
are, and whether it is **CONVERTED** (agent-editable), merely **RENDERS**, a
**SHELL**, or still a **TODO**. Read this to understand "what can an agent actually
edit today, and what is still hand-coded."

**This is a standing reference, not a session log.** The session-by-session
narrative lives in [`cms-pipeline/state-of-play.md`](cms-pipeline/state-of-play.md).
This file answers a different question: _at rest, what objects exist and what is
their status?_

**Governing design rule:** the objects are a **flexible backbone, not a replica of
the current site** — see [`design-principles.md`](design-principles.md). Prefer
reusable, agent-configurable components over bespoke per-page types.

---

## How to keep this current (for agents)

This file is **hand-maintained and drifts easily** — treat it like the map, not the
territory. The territory is: the production object store, `main`, and the live
`object_contract` / `object_inventory` MCP tools.

- **When you cut over a surface, create/publish an object, or wire a new source of
  truth — update the matching row here in the _same_ change.** A cutover PR that
  leaves this file stale is incomplete.
- **Never trust a row over real state.** Before building on "LIVE", verify against
  `object_inventory` (store state) and `main` (rendered state). Before claiming a
  boundary, verify against `object_contract('<type>')` — that tool is _derived from
  the enforcing code_ and cannot drift; this doc can.
- **Status is a claim about reality, not intent.** Mark something CONVERTED only when
  it actually drives the live site _and_ is agent-editable through the MCP (all five
  playbook criteria). If it only renders, it is RENDERS, not CONVERTED — never
  overstate it.
- **Keep it plain.** This page is read by humans deciding what to work on. Schemas,
  op names, and field lists belong in `object_contract`, not here.

### Two different states — do not conflate them (Wolf, 2026-07-10)

A page can **render** from a committed export while having **no editable record in
the production store**. These are different, and only the second is "converted"
([`conversion-playbook.md`](conversion-playbook.md) definition of done):

- **RENDERS** — Astro builds the page from `src/data/site/pages/*.json`. Cheap; a
  git commit is enough.
- **CONVERTED** — a real record exists in the production object store and an agent
  can fully manipulate it via MCP (checkout → patch → publish → release → re-render).
  This needs production credentials and a proven round-trip.

**Today, as of 2026-07-10, only three objects are CONVERTED:** `nav_header`,
`nav_footer`, `nav_footer_home`. Every page below RENDERS but is a **rendered stub**
— not store-backed, not agent-editable. See "Why only nav is converted" at the
bottom.

### Status legend

| Mark             | Meaning                                                                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 🟢 **CONVERTED** | Real content, renders live **and** an agent can fully manipulate it through the MCP (the playbook's 5 criteria all met). Only nav today.                                                                                                         |
| 🟣 **RENDERS**   | Builds and serves from a committed export, but has **no editable store record** — a rendered stub, not converted. Most "pages" are here.                                                                                                         |
| 🟡 **SHELL**     | Exists structurally (a record is published, or a route is scaffolded) but is a **placeholder, a test artifact, or not yet wired to drive the live site**. The real source of truth is still somewhere else. The note says which half is missing. |
| 🔴 **TODO**      | Needed for the CMS MVP. Not built yet.                                                                                                                                                                                                           |

---

## The object types (use & boundaries)

Seven object types exist. Six are "governed" (edited through the generic object
verbs and the approval policy); articles are the seventh and keep their own,
older pipeline. **Boundaries below are the human summary — the machine-checked,
always-current version is `object_contract('<type>')`.**

Current publish posture (`src/config/approval-policy.ts`): **`all-autonomous`** —
an agent proposes **and** publishes every governed type with no human gate (every
publish still writes a full, revertible audit trail). Flip one file to require
human approval per type.

| Type                        | What it is / used for                                                                                                                                                                                 | Key boundaries (summarized)                                                                                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **page**                    | One editable page of the site: a route + ordered list of sections. The unit a route file renders.                                                                                                     | `route` unique and starts with `/`; ≥1 non-hidden section to publish; section types must satisfy the PageType's allow/require rules; `template`, `navigationOverrides`, `shared_ref` and grid references must resolve. |
| **section** (shared)        | A section stored on its own so several pages can reference the _same_ instance via `shared_ref` (edit once, changes everywhere). Inline sections live inside a page and are **not** separate objects. | Same per-variant schema as inline sections; a `shared_ref` may not shadow-copy its target's type/data.                                                                                                                 |
| **navigation**              | A menu: the header, a footer, or a variant footer. The site chrome renders from these.                                                                                                                | No empty groups; menu depth ≤ 2; duplicate targets in a group **warn** (the audited nav does this legitimately); header action count over budget **warns**; a _published_ nav may not point at an _unpublished_ page.  |
| **taxonomy** (singleton)    | The controlled vocabulary — categories & tags — articles and listings draw from.                                                                                                                      | Slugs lowercase-hyphen, unique per kind; a deprecated term's `merged_into` must point at an active same-kind term and form no cycle. **Boundary caveat: not yet the real source of truth — see below.**                |
| **site** (singleton)        | Global config: brand tokens, logo, chrome toggles, blog paths, and the default header/footer navigation.                                                                                              | One per site. **Boundary caveat: not yet wired to drive rendering — see below.**                                                                                                                                       |
| **template**                | A reusable page blueprint (slots + allowed section types + default blueprints). Records _provenance_ only — pages do **not** live-inherit from a template after instantiation.                        | A slot's blueprint type must be in that slot's allowed set; allowed types must be registered components.                                                                                                               |
| **content_item** (articles) | Blog posts / articles. **Outside** the generic object model — served by the older `save_json_blob_*` tools and its own review/publish flow.                                                           | Not creatable or patchable via the object verbs; has no generic body schema. Listed here only so the boundary is explicit.                                                                                             |

**What goes _inside_ a page/section — the section-type palette.** A page's sections
are each one of the registered section types (`hero`, `lede`, `prose`, `checklist`,
`content_grid`, `bio`, `newsletter_signup`, `testimonial`, `cta_banner`, `faq`,
`link_list`, `product_preview`, `contact_form`, `search`, `content_embed`) plus the
bespoke single-use page sections (`thank_you`, `about`, `contact`) and the
`shared_ref` pointer. The reusable ones are meant to be composed onto any page; the
bespoke ones mirror one specific page's markup and are the **anti-pattern** under
[`design-principles.md`](design-principles.md) — a migration expedient, not to be
repeated. The live list + each type's field schema is `registry_get('component')` /
`object_contract('page').section_types`.

---

## Object inventory (concrete records)

### Pages — 12 render; **0 fully converted** (none is store-backed + round-trippable)

All 12 build and serve from committed exports (🟣 RENDERS). **None is CONVERTED** —
no agent can edit them via MCP, because no editable store record backs them (except
`page_home`, whose store record exists but is broken; see notes).

| Object                | Route                     | Status     | Notes                                                                                                                                                                                                                                                                           |
| --------------------- | ------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page_home`           | `/`                       | 🟣 RENDERS | **Restructured 2026-07-10 (home-page conversion):** hero + bio inline; the two grids and the newsletter are `shared_ref`s to standalone section objects (see Shared sections). Renders via `PageObjectRenderer`. **Its production store record is still the broken 2026-07-10 stub** — `scripts/home-conversion-roundtrip.mjs --production` heals it (reconcile ops), publishes, and proves the round-trip; that run needs credentials no agent session has had. |
| `page_start_here`     | `/start-here`             | 🟣 RENDERS | Lede-family interior page. Not store-backed.                                                                                                                                                                                                                                    |
| `page_member_updates` | `/member-updates`         | 🟣 RENDERS | Lede-family interior page. Not store-backed.                                                                                                                                                                                                                                    |
| `page_newsletter`     | `/newsletter`             | 🟣 RENDERS | Lede-family interior page. Not store-backed.                                                                                                                                                                                                                                    |
| `page_free_guide`     | `/guides/free-guide`      | 🟣 RENDERS | Lede-family interior page. Not store-backed.                                                                                                                                                                                                                                    |
| `page_early_access`   | `/solutions/early-access` | 🟣 RENDERS | Lede-family interior page. Not store-backed.                                                                                                                                                                                                                                    |
| `page_thank_you`      | `/thank-you`              | 🟣 RENDERS | Bespoke section (anti-pattern); message-swap script as furniture. Not store-backed.                                                                                                                                                                                             |
| `page_about`          | `/about`                  | 🟣 RENDERS | Bespoke `about` section (anti-pattern), PR #374. Not store-backed.                                                                                                                                                                                                              |
| `page_contact`        | `/contact`                | 🟣 RENDERS | Bespoke `contact` section (anti-pattern), PR #375. Not store-backed.                                                                                                                                                                                                            |
| `page_privacy`        | `/privacy`                | 🟣 RENDERS | `system` PageType, reusable `prose` section (PR #380). Not store-backed.                                                                                                                                                                                                        |
| `page_terms`          | `/terms`                  | 🟣 RENDERS | `system` PageType, reusable `prose` section (PR #380). Not store-backed.                                                                                                                                                                                                        |
| `page_404`            | `/404`                    | 🟣 RENDERS | `system` PageType, reusable `cta_banner` section (PR #380). Not store-backed.                                                                                                                                                                                                   |

### Shared sections

| Object                    | Used by                        | Status     | Notes                                                                                                                                                                                                 |
| ------------------------- | ------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sec_newsletter_signup`   | `page_home` (via `shared_ref`) | 🟣 RENDERS | Renders, not yet store-backed.                                                                                                                                                                        |
| `sec_home_audience_grid`  | `page_home` (via `shared_ref`) | 🟣 RENDERS | **New 2026-07-10.** The "This is for you if…" grid — a `content_grid` with the sanctioned `cards` source (curated text cells; replaced the bespoke `checklist` usage). Renders, not yet store-backed. |
| `sec_home_start_grid`     | `page_home` (via `shared_ref`) | 🟣 RENDERS | **New 2026-07-10.** The "Start here" grid — the SAME `content_grid` type, `query` source (latest posts). One reusable type, two roles by configuration alone. Renders, not yet store-backed.          |

### Navigation

**The only truly CONVERTED objects today** — store-backed and agent-editable via MCP.

| Object            | Role                    | Status       | Notes                                                                                                                                                                                    |
| ----------------- | ----------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nav_header`      | Site header             | 🟢 CONVERTED | Store-backed (record_version ~54), agent-editable — proven by real edits this project. Still carries a field-test description that a store-side `object_patch` + publish should restore. |
| `nav_footer`      | Default footer          | 🟢 CONVERTED | Store-backed, agent-editable; rendered on every page without a footer override. Store review_state is `changes_requested` from an old review never resolved.                             |
| `nav_footer_home` | Homepage footer variant | 🟢 CONVERTED | Store-backed, agent-editable; applied via `page_home.navigationOverrides.footer`.                                                                                                        |

### Singletons & templates

🔴 **No `site`, `taxonomy`, or `template` object is committed.** The field-test
stubs (`site_fieldtest`, `tax_fieldtest`, `tpl_fieldtest`) were deleted in PR #378.
The real site config still lives in `src/config.yaml` (and is what actually drives
rendering); real categories/tags remain article frontmatter (§5.5). Building real
`site` / `taxonomy` objects is **MVP TODO #2 / #3**; template objects are not
MVP-critical.

---

## MVP TODO objects

What still has to become a real object for Dr. Lurié to function as a full CMS —
i.e. for an agent (or a human via the admin UI) to edit **every meaningful part**
of the live site through the one governed workflow. Roughly in priority order.

### 1. Remaining hand-coded pages → page objects 🔴

The last three hand-coded routes. **Do NOT repeat the about/contact bespoke-per-page
pattern** — per [`design-principles.md`](design-principles.md), build these from
**reusable, agent-configurable components** (generalize existing ones or add reusable
types), accepting an intentional non-empty `build-diff` where the flexible result
isn't byte-identical.

| TODO object         | Route                     | Shape / gotcha                                                                                                                                                                                                                                 |
| ------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page_pricing`      | `/pricing`                | Widget-composition (`HeroText`/`Pricing`/`FAQs`/`Steps`/`Features3`/`CallToAction`). `CallToAction` has link actions → needs the action-hrefs resolved shape + a `resolve.ts` entry (like `about`), plus pricing-tier/steps/FAQ data modeling. |
| `page_services`     | `/services`               | Widget-composition (`Hero`/`Content`/`Features2`/`Testimonials`/`CallToAction`). Also has link actions.                                                                                                                                        |
| `page_shop_preview` | `/solutions/shop-preview` | Bespoke markup **+ a scoped `<style>`** → uses the functional-equivalence gate + a `known-inert-diffs.md` entry (like thank-you).                                                                                                              |

### 2. Real `site` object 🔴

Replace `src/config.yaml` as the source of truth with a real `site_drlurie` object
(brand tokens, logo, chrome toggles, blog paths, default navigation) **and wire the
layout to render from it**. This is what makes global site settings agent-editable.

### 3. Real `taxonomy` object 🔴 (design decision first)

A real `tax_drlurie` with the site's actual categories/tags. **Blocked on a
decision**, not just work: today article frontmatter is the deliberate source of
truth (§5.5). Promoting the taxonomy object means either a one-way sync
(frontmatter → object, object read-only) or a genuine cutover of ownership. Decide
the direction before building — using the wrong source reintroduces the exact drift
the project exists to fix.

### 4. System pages → page objects 🔵 DONE, in review (PR #380)

`page_privacy`, `page_terms`, `page_404` are built (see the Pages table) via the
process now written down in [`conversion-playbook.md`](conversion-playbook.md).
Remaining from this batch as a follow-up: the `content_item` resolver gap
(playbook trap 4, blocks manual grid curation). The `content_grid` `static`
variant was retired 2026-07-10 (schema + seed script; the sanctioned `cards`
source replaced it — playbook trap 9 is closed).

### 5. Listing pages 🔴 (Phase 6 — larger)

The blog index, category, and tag listings (`/[...blog]`, `/learn/topics`) and the
`listing` PageType are **typed but deliberately unimplemented** until the listing
loaders are formalized. This is the biggest remaining chunk and is what connects
pages to the article (`content_item`) pipeline.

### Not on the MVP path (noted so they aren't mistaken for gaps)

- **`content_item` / articles** — already functional via the `save_json_blob_*`
  pipeline; intentionally outside the object model.
- **Real `template` objects** — a convenience for spinning up new pages; nice to
  have, not required for MVP.
- **`homes/mobile-app`, `homes/personal`, `homes/startup`** — Astrowind starter-theme
  demo pages, not real Dr. Lurié content. Candidates for deletion, not for cutover.
- **`rss.xml`, `search.json`** — generated endpoints, not editable content.

---

## Boundaries & standing caveats

- **Rendered ≠ published-in-store.** Every LIVE page object's derived export
  (`src/data/site/pages/*.json`) is committed and the route renders from it at build
  time. That is not the same as the record existing in the **production blob store**
  (what the object verbs edit). The store is proven working end-to-end (the
  2026-07-08 field-test round published one of every type, since cleaned up), and
  `nav_header` is confirmed store-published — but the migrated content pages were
  seeded as committed exports, so confirm a given page via `object_inventory` before
  assuming an agent can `object_patch` it in the store.
- **The field-test objects were deleted (PR #378).** The throwaway `page_fieldtest`,
  `sec_fieldtest`, `tpl_fieldtest`, and `site`/`taxonomy` stubs proved the pipeline
  end-to-end, then were removed. One remnant remains: `nav_header` still carries a
  field-test description at store `record_version 52` — restore it store-side
  (`object_patch` + publish), not by editing the export.
- **Two sources of truth still live outside the object model:** `src/config.yaml`
  (site config) and article frontmatter (taxonomy). Until TODO #2 and #3 land, edits
  to those do **not** flow through the object workflow.

---

## Why only nav is converted — the roadmap blocker (root-cause analysis, 2026-07-10)

The goal is agents editing objects on every page via MCP. We are far from it, and
here is the honest why:

1. **"Converted" was defined as "renders," so half-done work looked finished.** Every
   page "cutover" produced a committed export that Astro renders and stopped there.
   The editability half — a real store record an agent can round-trip — was labelled
   a "deferred handoff" and **never executed**. The playbook now forbids this: see
   its definition of done.
2. **The store-seed + publish step needs production credentials no working session
   has had.** `object_publish`'s real path commits via the GitHub Git-Data API and
   requires `GITHUB_CONTENT_TOKEN` + `GITHUB_REPOSITORY` (and the MCP write path needs
   `PUBLISH_SECRET`). Every conversion session ran in a sandbox without them, so the
   real seed could only be _rehearsed_ against a local file-backed store, never
   completed against production. That is the single biggest reason only nav is real:
   **nav_header/nav_footer/nav_footer_home were published in an earlier, credentialed
   phase; nothing since was.**
3. **The MCP tool/action surface is incomplete for "full manipulation."** Concrete
   gaps found 2026-07-10:
   - **No lifecycle removal verb** — 14 object tools exist, none can archive/delete or
     unpublish an object (`object_publish` rejects `null`). So the field-test junk
     records can't be removed, and "delete a page" is impossible via MCP.
   - **No nested-block patch ops** — `upsert_block`/`move_block`/etc. from
     [`block-tree.md`](block-tree.md) were designed but never built; only flat
     section ops (`upsert_section`, `update_section_data`, …) exist. Fine while
     sections stay flat; a hard blocker the moment nesting is real.
   - **`content_item` reference resolution is stubbed** — so a `content_grid` `manual`
     source can't validate against real articles (playbook trap 4).
4. **No standing round-trip verification.** ~~Nothing repeatably proves an object is
   agent-editable; the one-off driver scripts were thrown away each session.~~
   **Closed for the home family 2026-07-10:** `scripts/home-conversion-roundtrip.mjs`
   is the standing driver — ensure/heal each record, exercise EVERY permitted op,
   validate, publish, contract- and inventory-check, in `--local` (rehearsal) and
   `--production` (real conversion) modes. Extend the same pattern to other
   families as they convert.

**What "finishing the roadmap" therefore requires (the honest remaining work):** a
credentialed publishing path (or a documented human-run step) to seed each object
into the production store; the missing MCP verbs (archive/unpublish) and, when
nesting lands, the block ops; the `content_item` resolver; and a standing test that
drives create→patch→publish→render per object as the enforceable "converted" gate.
Until those exist, a "convert this page" task cannot actually be completed — say so
rather than shipping a rendered stub.

_Last audited: 2026-07-10, `claude/home-page-conversion-state-6wsc2r` (home-page
restructure: two shared grid objects + `cards` source + standing round-trip driver).
Prior: PR #383 (homepage-footer regression fix + definition-of-done reset)._
