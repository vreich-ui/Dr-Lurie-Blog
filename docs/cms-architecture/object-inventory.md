# CMS Object Inventory — Dr. Lurié

**What this is:** the human-readable catalog of every content object the Dr. Lurié
site is (or should be) made of — what each object is _for_, where its _boundaries_
are, and whether it is **LIVE**, a **SHELL**, or still a **TODO**. Read this to
understand "what can an agent actually edit today, and what is still hand-coded."

**This is a standing reference, not a session log.** The session-by-session
narrative lives in [`cms-pipeline/state-of-play.md`](cms-pipeline/state-of-play.md).
This file answers a different question: _at rest, what objects exist and what is
their status?_

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
- **Status is a claim about reality, not intent.** Mark something LIVE only when it
  actually drives the live site _and_ is editable through the object workflow. If
  only one of those is true, it is a SHELL — say which half is missing.
- **Keep it plain.** This page is read by humans deciding what to work on. Schemas,
  op names, and field lists belong in `object_contract`, not here.

### Status legend

| Mark | Meaning |
| ---- | ------- |
| 🟢 **LIVE** | Real content. Drives the live site **and** is editable through the object verbs (create → checkout → patch → publish). |
| 🟡 **SHELL** | Exists structurally (a record is published, or a route is scaffolded) but is a **placeholder, a test artifact, or not yet wired to drive the live site**. The real source of truth is still somewhere else. The note says which half is missing. |
| 🔵 **IN REVIEW** | Built and verified; a PR is open but not merged. Becomes LIVE on merge (+ store publish where noted). |
| 🔴 **TODO** | Needed for the CMS MVP. Not built yet. |

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

| Type | What it is / used for | Key boundaries (summarized) |
| ---- | --------------------- | --------------------------- |
| **page** | One editable page of the site: a route + ordered list of sections. The unit a route file renders. | `route` unique and starts with `/`; ≥1 non-hidden section to publish; section types must satisfy the PageType's allow/require rules; `template`, `navigationOverrides`, `shared_ref` and grid references must resolve. |
| **section** (shared) | A section stored on its own so several pages can reference the _same_ instance via `shared_ref` (edit once, changes everywhere). Inline sections live inside a page and are **not** separate objects. | Same per-variant schema as inline sections; a `shared_ref` may not shadow-copy its target's type/data. |
| **navigation** | A menu: the header, a footer, or a variant footer. The site chrome renders from these. | No empty groups; menu depth ≤ 2; duplicate targets in a group **warn** (the audited nav does this legitimately); header action count over budget **warns**; a _published_ nav may not point at an _unpublished_ page. |
| **taxonomy** (singleton) | The controlled vocabulary — categories & tags — articles and listings draw from. | Slugs lowercase-hyphen, unique per kind; a deprecated term's `merged_into` must point at an active same-kind term and form no cycle. **Boundary caveat: not yet the real source of truth — see below.** |
| **site** (singleton) | Global config: brand tokens, logo, chrome toggles, blog paths, and the default header/footer navigation. | One per site. **Boundary caveat: not yet wired to drive rendering — see below.** |
| **template** | A reusable page blueprint (slots + allowed section types + default blueprints). Records _provenance_ only — pages do **not** live-inherit from a template after instantiation. | A slot's blueprint type must be in that slot's allowed set; allowed types must be registered components. |
| **content_item** (articles) | Blog posts / articles. **Outside** the generic object model — served by the older `save_json_blob_*` tools and its own review/publish flow. | Not creatable or patchable via the object verbs; has no generic body schema. Listed here only so the boundary is explicit. |

**What goes _inside_ a page/section — the section-type palette.** A page's sections
are each one of the registered section types (`hero`, `lede`, `prose`, `checklist`,
`content_grid`, `bio`, `newsletter_signup`, `testimonial`, `cta_banner`, `faq`,
`link_list`, `product_preview`, `contact_form`, `search`, `content_embed`) plus the
bespoke single-use page sections (`thank_you`, `about`, `contact`) and the
`shared_ref` pointer. The reusable ones are meant to be composed onto any page; the
bespoke ones mirror one specific page's markup. The live list + each type's field
schema is `registry_get('component')` / `object_contract('page').section_types`.

---

## Object inventory (concrete records)

### Pages

| Object | Route | Status | Notes |
| ------ | ----- | ------ | ----- |
| `page_home` | `/` | 🟢 LIVE | Homepage; renders via `resolvePage`; owns the `nav_footer_home` footer override and a `shared_ref` to the newsletter section. |
| `page_start_here` | `/start-here` | 🟢 LIVE | Lede-family interior page. |
| `page_member_updates` | `/member-updates` | 🟢 LIVE | Lede-family interior page. |
| `page_newsletter` | `/newsletter` | 🟢 LIVE | Lede-family interior page. |
| `page_free_guide` | `/guides/free-guide` | 🟢 LIVE | Lede-family interior page. |
| `page_early_access` | `/solutions/early-access` | 🟢 LIVE | Lede-family interior page. |
| `page_thank_you` | `/thank-you` | 🟢 LIVE | Bespoke section; owns the per-form message-swap script as fixed furniture. |
| `page_about` | `/about` | 🟢 LIVE | Bespoke `about` section; prose is fixed furniture, only clean fields are data (merged PR #374). |
| `page_contact` | `/contact` | 🟢 LIVE | Bespoke `contact` widget-composition section: re-invokes HeroText/Contact/Features2 with props promoted to object data (merged PR #375). |

### Shared sections

| Object | Used by | Status | Notes |
| ------ | ------- | ------ | ----- |
| `sec_newsletter_signup` | `page_home` (via `shared_ref`) | 🟢 LIVE | The one genuinely-shared section today. |

### Navigation

| Object | Role | Status | Notes |
| ------ | ---- | ------ | ----- |
| `nav_header` | Site header | 🟢 LIVE | Store-published. Still carries a field-test description at store `record_version 52` — restoring the original needs a store-side `object_patch` + publish, not a file edit (a direct export edit would drift from the store). |
| `nav_footer` | Default footer | 🟢 LIVE | Rendered on every page without a footer override. |
| `nav_footer_home` | Homepage footer variant | 🟢 LIVE | Applied via `page_home.navigationOverrides.footer`. |

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

### 1. Remaining bespoke pages → page objects 🔴

The last three hand-coded routes. Same faithful-reproduction cutover pattern as
about/contact (bespoke section per page, byte-identical `build-diff`).

| TODO object | Route | Shape / gotcha |
| ----------- | ----- | -------------- |
| `page_pricing` | `/pricing` | Widget-composition (`HeroText`/`Pricing`/`FAQs`/`Steps`/`Features3`/`CallToAction`). `CallToAction` has link actions → needs the action-hrefs resolved shape + a `resolve.ts` entry (like `about`), plus pricing-tier/steps/FAQ data modeling. |
| `page_services` | `/services` | Widget-composition (`Hero`/`Content`/`Features2`/`Testimonials`/`CallToAction`). Also has link actions. |
| `page_shop_preview` | `/solutions/shop-preview` | Bespoke markup **+ a scoped `<style>`** → uses the functional-equivalence gate + a `known-inert-diffs.md` entry (like thank-you). |

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

### 4. System pages → page objects 🔴

The static legal/utility pages, as `system`-PageType page objects (prose-led):

| TODO object | Currently |
| ----------- | --------- |
| `page_privacy` | `src/pages/privacy.md` |
| `page_terms` | `src/pages/terms.md` |
| `page_404` | `src/pages/404.astro` |

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

_Last audited: 2026-07-08, against `main` @ `4139d51` (contact live via #375; field-test objects removed via #378)._
