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

**As of 2026-07-12, thirty-seven objects are CONVERTED** (all via credentialed
`home-conversion-roundtrip.mjs --production --release` runs — store-backed, every
permitted op round-tripped in production, published, `released:true`): the 3 nav
objects; the home-page family (`page_home`, `sec_home_audience_grid`,
`sec_home_start_grid`, `sec_newsletter_signup`); the /about family (`page_about` +
`sec_about_intro`/`_thinking`/`_products`/`_science`/`_research`/`_blog`/`_note`/`_cta`);
**all 8 W1 interior/system pages + `page_contact` + `page_thank_you`; the 3
templates (`tpl_interior`/`tpl_landing`/`tpl_legal`); the `tax_drlurie`
taxonomy registry; and the `site_drlurie` site singleton (W4)** — the page +
template backlog landed in one batched credentialed run on 2026-07-11, the
taxonomy and site singleton in their own runs the same day. **All 12 page objects
are converted; no page renders from an unbacked export anymore** — the rendered-stub
backlog is empty. See "Why only nav is converted" (historical root-cause analysis)
at the bottom. **W6 (2026-07-12) added six CONVERTED listing/article page
objects** (see "Listing & article surfaces") — Wolf's credentialed run the same
day went all-green: store-backed, every permitted op round-tripped, published
(export commits `7956b13`…`b0f8d90`), `released:true`; store === seed ===
export byte-verified (record_version 11 across all six).

### Status legend

| Mark             | Meaning                                                                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 🟢 **CONVERTED** | Real content, renders live **and** an agent can fully manipulate it through the MCP (the playbook's 5 criteria all met). Nav + the home-page & /about families today.                                                                            |
| 🟣 **RENDERS**   | Builds and serves from a committed export, but has **no editable store record** — a rendered stub, not converted. Most "pages" are here.                                                                                                         |
| 🟡 **SHELL**     | Exists structurally (a record is published, or a route is scaffolded) but is a **placeholder, a test artifact, or not yet wired to drive the live site**. The real source of truth is still somewhere else. The note says which half is missing. |
| 🔴 **TODO**      | Needed for the CMS MVP. Not built yet.                                                                                                                                                                                                           |

---

## The object types (use & boundaries)

Eight object types exist. Seven are "governed" (edited through the generic object
verbs and the approval policy); articles are the eighth and keep their own,
older pipeline. **Boundaries below are the human summary — the machine-checked,
always-current version is `object_contract('<type>')`.**

Current publish posture (`src/config/approval-policy.ts`): **`all-autonomous`,
with `product` pinned to require-approval** (06-shop-module-plan §0.4: an agent
proposing a product change is fine; a price change going live without a human
eye is not). Every other governed type publishes autonomously; every publish
still writes a full, revertible audit trail. Flip one file to change the
posture per type.

| Type                        | What it is / used for                                                                                                                                                                                 | Key boundaries (summarized)                                                                                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **page**                    | One editable page of the site: a route + ordered list of sections. The unit a route file renders.                                                                                                     | `route` unique and starts with `/`; ≥1 non-hidden section to publish; section types must satisfy the PageType's allow/require rules; `template`, `navigationOverrides`, `shared_ref` and grid references must resolve. |
| **section** (shared)        | A section stored on its own so several pages can reference the _same_ instance via `shared_ref` (edit once, changes everywhere). Inline sections live inside a page and are **not** separate objects. | Same per-variant schema as inline sections; a `shared_ref` may not shadow-copy its target's type/data.                                                                                                                 |
| **navigation**              | A menu: the header, a footer, or a variant footer. The site chrome renders from these.                                                                                                                | No empty groups; menu depth ≤ 2; duplicate targets in a group **warn** (the audited nav does this legitimately); header action count over budget **warns**; a _published_ nav may not point at an _unpublished_ page.  |
| **taxonomy** (singleton)    | The controlled vocabulary — categories & tags — articles and listings draw from.                                                                                                                      | Slugs lowercase-hyphen, unique per kind; a deprecated term's `merged_into` must point at an active same-kind term and form no cycle. **Boundary caveat: not yet the real source of truth — see below.**                |
| **site** (singleton)        | Global config: brand tokens, logo, chrome toggles, blog paths, and the default header/footer navigation.                                                                                              | One per site. **Boundary caveat: not yet wired to drive rendering — see below.**                                                                                                                                       |
| **template**                | A reusable page blueprint (slots + allowed section types + default blueprints). Records _provenance_ only — pages do **not** live-inherit from a template after instantiation.                        | A slot's blueprint type must be in that slot's allowed set; allowed types must be registered components.                                                                                                               |
| **product**                 | One sellable digital good (download / pay-to-unlock / tip-PWYW / free lead magnet): `slug` + presentation + commerce + a fulfillment union on `kind`. Long-form copy composes via `presentation.page_ref` → an ordinary Page (06-shop-module-plan §1–2). | Slug lowercase-hyphen + unique (→ `/shop/<slug>`); mode↔fields coherence enforced; **price cache + Stripe linkage are NOT agent-patchable** (`product_set_price` only, S3); `fulfillment.artifact_ref` must be a trusted private-store ref; **publishes review-required**. |
| **content_item** (articles) | Blog posts / articles. **Outside** the generic object model — served by the older `save_json_blob_*` tools and its own review/publish flow.                                                           | Not creatable or patchable via the object verbs; has no generic body schema. Listed here only so the boundary is explicit.                                                                                             |

**What goes _inside_ a page/section — the section-type palette.** A page's sections
are each one of the registered section types (`hero`, `lede`, `prose`, `checklist`,
`content_grid`, `bio`, `newsletter_signup`, `testimonial`, `cta_banner`, `faq`,
`link_list`, `product_preview`, `contact_form`, `form_confirmation`, `search`,
`content_embed`) plus the `card` leaf and the `shared_ref` pointer. **As of
2026-07-11 the palette is fully generic — every bespoke single-use page type has
been retired:** `about` (2026-07-10) and `contact` (2026-07-11) decomposed into
reusable sections, and `thank_you` was renamed to the reusable `form_confirmation`.
The live list + each type's field schema is `registry_get('component')` /
`object_contract('page').section_types`.

---

## Object inventory (concrete records)

### Pages — 12 render; **all 12 CONVERTED** (2026-07-11 batched run)

All 12 build and serve from committed exports and are now **CONVERTED** — store-backed
in production, round-tripping every permitted op via MCP, published, and released.
`page_home` + `page_about` landed 2026-07-10; the remaining 10 (8 W1 interior/system
pages + `page_contact` + `page_thank_you`) landed 2026-07-11 in one batched
credentialed `convert-pending-production.sh` run (`released:true`; each `ensure`
reported "already matches the seed" → store === seed === export).

**NEW pages are fully agentic (2026-07-11):** the object-page catch-all
(`src/pages/[...objectPage].astro`) serves any published Page object whose route
no hand-written file owns — create (`object_create` / `object_instantiate_template`)
→ publish → release, and the page is live at its route with zero code. Ownership
rules (file routes win; article permalinks and the blog/topics/admin path families
are refused with a build-log warning) live in `src/utils/object-page-routes.ts`.
The 12 pages below keep their thin loader files, so the catch-all emits nothing
for them.

| Object                | Route                     | Status       | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------- | ------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page_home`           | `/`                       | 🟢 CONVERTED | **All five criteria met 2026-07-10.** Hero + bio inline; grids + newsletter are `shared_ref`s to standalone section objects. The broken store record was healed via reconcile ops, every permitted op round-tripped in production, published (v44+, `4753ae7`), and released (`released:true`). Seed === store === export.                                                                                                                |
| `page_start_here`     | `/start-here`             | 🟢 CONVERTED | Lede interior page. Seed in the W1 batch (`pages-interior-seed-data.mjs`); store-backed + round-tripped in production, published, released 2026-07-11.                                                                                                                                                                                                                                                                                    |
| `page_member_updates` | `/member-updates`         | 🟢 CONVERTED | Lede interior page. W1 batch; store-backed + round-tripped in production, published, released 2026-07-11.                                                                                                                                                                                                                                                                                                                                 |
| `page_newsletter`     | `/newsletter`             | 🟢 CONVERTED | Lede interior page (plain lede today — the shared newsletter section can be added later). W1 batch; store-backed + round-tripped in production, published, released 2026-07-11.                                                                                                                                                                                                                                                           |
| `page_free_guide`     | `/guides/free-guide`      | 🟢 CONVERTED | Lede interior page. W1 batch; store-backed + round-tripped in production, published, released 2026-07-11.                                                                                                                                                                                                                                                                                                                                 |
| `page_early_access`   | `/solutions/early-access` | 🟢 CONVERTED | Lede interior page. W1 batch; store-backed + round-tripped in production, published, released 2026-07-11.                                                                                                                                                                                                                                                                                                                                 |
| `page_thank_you`      | `/thank-you`              | 🟢 CONVERTED | **Decomposed 2026-07-11:** the bespoke `thank_you` type was RENAMED to the reusable `form_confirmation` (a `standard` page with one such section; the `?form=` swap script is unchanged furniture). Renders byte-identically; store-backed + round-tripped in production, published, released 2026-07-11.                                                                                                                                 |
| `page_about`          | `/about`                  | 🟢 CONVERTED | **Decomposed 2026-07-10** off the bespoke `about` anti-pattern into EIGHT standalone shared sections (bio + prose ×6 + cta_banner) — a `standard` page of 8 `shared_ref`s. Store-backed (record_version 10), round-tripped in production, published, released. (The bespoke `about` TYPE was retired 2026-07-10.)                                                                                                                         |
| `page_contact`        | `/contact`                | 🟢 CONVERTED | **Decomposed 2026-07-11** off the bespoke `contact` anti-pattern into reusable `lede` + `contact_form` (now carrying subtitle/description) + `content_grid` (`cards` source, cells gained an optional `icon`) — a `standard` page of 3 inline generic sections. Intentional scoped visual diff (rule 4); store-backed + round-tripped in production, published, released 2026-07-11. (The bespoke `contact` TYPE was retired 2026-07-11.) |
| `page_privacy`        | `/privacy`                | 🟢 CONVERTED | `system` PageType, reusable `prose` section (PR #380). W1 batch; store-backed + round-tripped in production, published, released 2026-07-11.                                                                                                                                                                                                                                                                                              |
| `page_terms`          | `/terms`                  | 🟢 CONVERTED | `system` PageType, reusable `prose` section (PR #380). W1 batch; store-backed + round-tripped in production, published, released 2026-07-11.                                                                                                                                                                                                                                                                                              |
| `page_404`            | `/404`                    | 🟢 CONVERTED | `system` PageType, reusable `cta_banner` section (PR #380). W1 batch; store-backed + round-tripped in production, published, released 2026-07-11.                                                                                                                                                                                                                                                                                         |

### Listing & article surfaces (W6, CONVERTED 2026-07-12)

The six T6.1 page objects: **headings/copy/SEO are object data; the query
machinery (post feeds, term filters, pagination, topic cards) stays the audited
build-time derivation.** Convention: the object's FIRST `lede` section is the
surface's header block (required by the `listing` PageType), rendered through
the surface's existing header furniture; every EXTRA section renders through
the component registry after the list/article — so "put a newsletter signup
below every article" is one `upsert_section` on `page_article`. Per-term
surfaces are ONE object per route family: their copy carries the `%term%`
token, interpolated with each term's display label at build. Seeds:
`scripts/lib/pages-listing-seed-data.mjs` (byte-identical transcriptions).

**Status: 🟢 CONVERTED (all five criteria, credentialed run 2026-07-12)** —
every `ensure` created the store record, all six page ops round-tripped in
production, published (`[skip netlify]` export commits `7956b13`…`b0f8d90`),
contract 6/6, inventory 6/6, `released:true`; store === seed === export
byte-verified (marker-stripped, record_version 11 ×6).

| Object              | Serves                                | Status       | Notes                                                                                                                                           |
| ------------------- | ------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `page_library`      | `/learn/library` (+ pagination)       | 🟢 CONVERTED | `listing`. Header lede ("Library" + blurb); title base + " — Page N" furniture.                                                                 |
| `page_topics_index` | `/learn/topics`                       | 🟢 CONVERTED | `listing`. Header lede (kicker "Education library"); topic cards stay computed from category frontmatter (D§5.5), og image in seo.              |
| `page_topic_detail` | `/learn/topics/<slug>` (every topic)  | 🟢 CONVERTED | `listing`, per-term: heading `%term%`, kicker "Topic"; description pattern in seo.                                                              |
| `page_category`     | `/category/<slug>` (every category)   | 🟢 CONVERTED | `listing`, per-term: heading `%term%`, title "Category '%term%'".                                                                              |
| `page_tag`          | `/tag/<slug>` (every tag)             | 🟢 CONVERTED | `listing`, per-term: heading "Tag: %term%", title "Posts by tag '%term%'".                                                                     |
| `page_article`      | every article page (SinglePost route) | 🟢 CONVERTED | `content_detail`: route-level SEO defaults (robots fallback = config.yaml) + optional sections below the post. Publishes with zero sections.    |

### Shared sections

| Object                   | Used by                         | Status       | Notes                                                                                                                                                                                                              |
| ------------------------ | ------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sec_newsletter_signup`  | `page_home` (via `shared_ref`)  | 🟢 CONVERTED | **All five criteria met 2026-07-10:** store-backed, every permitted op round-tripped in production, published, released.                                                                                           |
| `sec_home_audience_grid` | `page_home` (via `shared_ref`)  | 🟢 CONVERTED | **New + converted 2026-07-10.** "This is for you if…" — `content_grid`, sanctioned `cards` source (curated text cells; replaced the bespoke `checklist` usage). Store-backed, round-tripped, published, released.  |
| `sec_home_start_grid`    | `page_home` (via `shared_ref`)  | 🟢 CONVERTED | **New + converted 2026-07-10.** "Start here" — the SAME `content_grid` type, `query` source (latest posts): one reusable type, two roles by configuration alone. Store-backed, round-tripped, published, released. |
| `sec_about_intro`        | `page_about` (via `shared_ref`) | 🟢 CONVERTED | **New 2026-07-10** (/about decomposition). `bio` — intro heading + copy + portrait photo (the reusable bio type gained a URL `portrait`). Store-backed, round-tripped in production, published, released.          |
| `sec_about_thinking`     | `page_about` (via `shared_ref`) | 🟢 CONVERTED | **New 2026-07-10.** `prose` — "A Different Way of Thinking About Health". Store-backed, round-tripped in production, published, released.                                                                          |
| `sec_about_products`     | `page_about` (via `shared_ref`) | 🟢 CONVERTED | **New 2026-07-10.** `prose` — "Why Most Products Fall Short".                                                                                                                                                      |
| `sec_about_science`      | `page_about` (via `shared_ref`) | 🟢 CONVERTED | **New 2026-07-10.** `prose` — "The Science Behind Real Results" (with list).                                                                                                                                       |
| `sec_about_research`     | `page_about` (via `shared_ref`) | 🟢 CONVERTED | **New 2026-07-10.** `prose` — "From Research to Real Life" (with list).                                                                                                                                            |
| `sec_about_blog`         | `page_about` (via `shared_ref`) | 🟢 CONVERTED | **New 2026-07-10.** `prose` — "Why This Blog Exists" (with list).                                                                                                                                                  |
| `sec_about_note`         | `page_about` (via `shared_ref`) | 🟢 CONVERTED | **New 2026-07-10.** `prose` — "A Personal Note".                                                                                                                                                                   |
| `sec_about_cta`          | `page_about` (via `shared_ref`) | 🟢 CONVERTED | **New 2026-07-10.** `cta_banner` — "Start With the Science" + the two closing actions.                                                                                                                             |

### Navigation

**The only truly CONVERTED objects today** — store-backed and agent-editable via MCP.

| Object            | Role                    | Status       | Notes                                                                                                                                                                                    |
| ----------------- | ----------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nav_header`      | Site header             | 🟢 CONVERTED | Store-backed (record_version ~54), agent-editable — proven by real edits this project. Still carries a field-test description that a store-side `object_patch` + publish should restore. |
| `nav_footer`      | Default footer          | 🟢 CONVERTED | Store-backed, agent-editable; rendered on every page without a footer override. Store review_state is `changes_requested` from an old review never resolved.                             |
| `nav_footer_home` | Homepage footer variant | 🟢 CONVERTED | Store-backed, agent-editable; applied via `page_home.navigationOverrides.footer`.                                                                                                        |

### Singletons & templates

🟢 **`site_drlurie` is CONVERTED (W4, credentialed run 2026-07-11)** — all five
criteria: store-backed in production (create + publish + release
`released:true`; export commit `a20f107`, **store === seed === export
byte-verified**), `set_site_fields` (the type's only op) round-tripped, contract
advertised ≡ exercised, recorded here. Seed `scripts/lib/site-seed-data.mjs`
(byte-identical transcription of the previously hardcoded values), export
`src/data/site/site.json`. **LIVE from the object** (pre-conversion literals as
fallback when the export is absent — `src/utils/site-object.ts`, a deliberately
synchronous eager-glob loader so component evaluation order is unchanged):
brandTokens (every CustomStyles custom property, light + `dark:` keys) ·
logo.text · chrome{showRssFeed, showThemeToggle} · metadataDefaults (title
template, description, ogImage, twitter handle, og site_name) ·
defaultNavigation{header, footer}. **CARRIED but config.yaml stays
authoritative for routing** (Wolf B2): urls · blog{listPath, postsPerPage,
categoryBase, tagBase} — permalink wiring is a later cutover. NOT in the
object: i18n · ui.theme · analytics · googleSiteVerificationId;
chrome.announcement deferred (Wolf B3). (The field-test stubs were deleted in
PR #378.)

🟢 **`tax_drlurie` is CONVERTED (W3, 2026-07-11)** — Wolf's decision: a curated,
agent-editable vocabulary (5 categories + 26 tags distilled from the drifted
frontmatter of 93 posts; approved canonical list + raw→canonical mapping in
`scripts/lib/taxonomy-seed-data.mjs`). **All five criteria met by the
credentialed run 2026-07-11**: store-backed in production, every permitted term
op round-tripped (add/update/deprecate/reactivate/remove), published, released
(`released:true`; export commit `627fa8d`, store === seed === export). Its first
consumer is live automatically: the validation context wires
`resolveTaxonomyTerm`, so `content_grid` query terms now validate against the
real registry. **Step 2 SHIPPED 2026-07-11**: publish-article resolves
category/tags against this registry at publish time (slug resolution +
`merged_into` aliases; unresolvable terms → 422; canonical slugs materialized
into frontmatter; skips gracefully when no registry), all 93 posts' frontmatter
was normalized via the committed `RAW_TO_CANONICAL` map, and the blog renderer
displays term labels from the registry — full §5.5 is live for articles.

**Templates were ACTIVATED + CONVERTED 2026-07-11 (W2.5)** — design-principles
rule 5 ("templates are recipes; PageTypes are law"). The `object_instantiate_template`
MCP tool creates a new page from a recipe through the standard create validation
(`dry_run: true` previews without persisting); a required slot without a
blueprint instantiates from the registry defaultData of its first allowed type.
Three starter recipes are store-backed in production (batched run 2026-07-11 —
all 4 template ops round-tripped + instantiate `dry_run` proven, published, released):

| Object         | appliesTo  | Status       | Notes                                                                                                                                        |
| -------------- | ---------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `tpl_interior` | `standard` | 🟢 CONVERTED | Lede open + prose body + optional cta close (the W1 interior shape). All 4 template ops + instantiate `dry_run` round-tripped in production. |
| `tpl_landing`  | `standard` | 🟢 CONVERTED | Hero open + curated card grid + cta close (campaign shape). Round-tripped in production, published, released.                                |
| `tpl_legal`    | `system`   | 🟢 CONVERTED | One required blueprint-less prose slot — exercises the defaultData fallback. Round-tripped in production, published, released.               |

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

### 2. Real `site` object 🟢 CONVERTED (W4, credentialed run 2026-07-11)

`site_drlurie` is store-backed in production and the layout renders from it
(see "Singletons & templates" above): brand tokens, logo text, chrome toggles,
metadata defaults, and default navigation are agent-editable via
`set_site_fields`; urls/blog are carried in the object while config.yaml stays
authoritative for routing (Wolf B2, 2026-07-11).

### 3. Real `taxonomy` object 🟢 CONVERTED (2026-07-11)

**Wolf decided: curated agent-editable vocabulary** (not a read-only mirror, not
a full article-pipeline cutover). `tax_drlurie` converted via the credentialed
run, and **step 2 SHIPPED 2026-07-11** (see "Singletons & templates" above):
the bounded enforcement hook + the one-time normalization pass + registry
display labels — full §5.5 is live for articles. The full
content_item→ObjectRecord conversion remains deferred as its own wave (OQ-8) —
deliberately NOT a taxonomy prerequisite.

### 4. System pages → page objects 🔵 DONE, in review (PR #380)

`page_privacy`, `page_terms`, `page_404` are built (see the Pages table) via the
process now written down in [`conversion-playbook.md`](conversion-playbook.md).
The `content_item` resolver gap from this batch is CLOSED (2026-07-11, trap 4):
manual grid curation validates against committed content and is agent-usable. The `content_grid` `static`
variant was retired 2026-07-10 (schema + seed script; the sanctioned `cards`
source replaced it — playbook trap 9 is closed).

### 5. Listing pages 🟢 CONVERTED (W6, 2026-07-12)

The `listing` and `content_detail` PageTypes are **defined law** (all five
PageTypeIds implemented), the listing loaders are formalized, the six page
objects shipped with a byte-identical cutover, and Wolf's credentialed run
the same day converted all six (see "Listing & article surfaces" above) —
the biggest remaining MVP chunk is closed.

### 6. Shop module (products + commerce) — S1a BUILT (2026-07-12)

The plan is [`06-shop-module-plan.md`](06-shop-module-plan.md) (Stripe-only v1,
digital goods). **S1a is done**: the `product` object type is live end-to-end in
the sandbox — `product.v1` body schema (fulfillment discriminated union),
`prod_` ids, the `set_product_fields` patch op (with the §3 canonicality funnel:
price cache + Stripe linkage refuse agent patches), the product validation
criteria (slug shape/uniqueness via the live `isSlugTaken` resolver, mode↔fields
coherence, publish-gated Stripe linkage, artifact trust, `commerce_price_sync`
backstop), the materializer (`src/data/site/products/{id}.json`),
`object_contract('product')`, and the **review-required approval flip** (§0.4).
Stripe env keys are pre-marked in the deploy-safety scanner (§8.5). **No product
records exist yet** — the store is empty by design until S2 seeds the shop
surfaces. Next on the critical path: S1b (commerce + commerce-events stores,
event lib) and S1c (checkout session → webhook → token delivery), then the two
S3 MCP tools (`product_set_price`, `order_reissue`) that complete criterion 4.

### Not on the MVP path (noted so they aren't mistaken for gaps)

- **`content_item` / articles** — already functional via the `save_json_blob_*`
  pipeline; intentionally outside the object model.
- **Real `template` objects** — ACTIVATED + CONVERTED at W2.5 (see "Singletons &
  templates"): three starter recipes store-backed in production + the instantiate
  tool live. Agents can create and evolve more freely.
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
   - ~~**`content_item` reference resolution is stubbed** — so a `content_grid` `manual`
     source can't validate against real articles (playbook trap 4).~~ **CLOSED
     2026-07-11**: the validation context resolves content_item ids against
     committed content (`netlify/lib/content-item-index.ts`); manual curation
     is agent-usable.
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

_Last audited: 2026-07-12, `claude/w6-cms-conversion-lus2d7` (W6 listing
surfaces CONVERTED: PRs #408/#409 merged + Wolf's credentialed
`--production --release` run all-green same day — six objects store-backed,
round-tripped, published, `released:true`; 37 objects converted total).
Prior: 2026-07-10 evening, `claude/home-page-conversion-state-6wsc2r`
(home-page family CONVERTED)._
