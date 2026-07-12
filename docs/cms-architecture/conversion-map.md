# Conversion Map — every actual and potential object, as a tree

> **What this is (Wolf, 2026-07-10):** the complete object universe of the
> Dr-Lurié Astro project — every object that exists, every surface that still
> needs to become one, and every _potential_ object that can be composed from
> others. One node per object: its **attributes**, what it **depends on**, what
> **depends on it**, its **status**, and a **PROPOSED conversion priority**.
> This document exists for Wolf to set **boundaries, relationships, and
> priority** — the priority column is a proposal; edit it, and agents follow
> the edited order.
>
> Status marks match [`object-inventory.md`](object-inventory.md):
> 🟢 CONVERTED (all five playbook criteria) · 🟣 RENDERS (export only — a
> rendered stub) · 🔴 TODO (no object at all) · 🔵 optional · ⚪ potential
> (does not exist; composable from other objects) · ⛔ never an object.
>
> Machine truth for full field schemas is `object_contract('<type>')` — the
> attribute lists here are the human summary, not the schema.
> **How to convert any node:** [`conversion-playbook.md`](conversion-playbook.md)
> (the driver-centric recipe). Record results in `object-inventory.md` +
> `state-of-play.md`, and keep THIS tree's status marks current in the same
> change.

## The tree

```text
site_drlurie ─ SITE SINGLETON ─ 🟢 CONVERTED (W4, credentialed run 2026-07-11; export commit a20f107)
│   the root everything hangs off; seed scripts/lib/site-seed-data.mjs → export src/data/site/site.json
│   LIVE from the object (pre-conversion literals as fallback when the export is absent):
│     brandTokens (every CustomStyles custom property, light + dark:` keys) · logo.text ·
│     chrome{showRssFeed, showThemeToggle} · metadataDefaults (title template, description,
│     ogImage, twitter handle, og site_name) · defaultNavigation{header, footer} (D§5.4:
│     the ONLY place default menus bind)
│   CARRIED but config.yaml stays authoritative for routing (Wolf B2, 2026-07-11): urls ·
│     blog{listPath, postsPerPage, categoryBase, tagBase} — permalink wiring is a later cutover
│   NOT in the object (still config.yaml/code): i18n · ui.theme · analytics ·
│     googleSiteVerificationId · trailingSlash; chrome.announcement deferred (Wolf B3)
│   dependents: EVERY page (Layout/Metadata.astro), rss.xml, sitemap, robots directives
│
├── CHROME — navigation objects (type: navigation)
│   ├── nav_header ─ 🟢 CONVERTED
│   │     attributes: brand · groups[] > items[] (menu, depth ≤ 2) · actions[] (CTA budget 3, warn-only)
│   │     depends on: target refs → pages (page-kind must be published) / routes / listing
│   │     dependents: every page's header
│   ├── nav_footer ─ 🟢 CONVERTED — default footer; dependents: every page without an override
│   ├── nav_footer_home ─ 🟢 CONVERTED — dependents: page_home via navigationOverrides.footer
│   └── ⚪ announcement ─ potential ─ priority W-later
│         Announcement.astro widget exists in the codebase but is not rendered anywhere today.
│         If revived: a small site-level object (message, link, on/off) — never hardcode it.
│
├── PAGES — type: page (route + seo + navigationOverrides + ordered sections[])
│   page attributes (all pages): route · pageType · title · seo{title, description, ogImage,
│     robots} · navigationOverrides{header?, footer?} · template(provenance) · sections[]
│   page depends on: every shared_ref target section · navigationOverrides nav objects ·
│     (via content_grid/content_embed sections) the content_item pipeline
│   NEW pages are fully agentic (2026-07-11): the object-page catch-all serves any
│     published Page object at its route with zero code (file routes/article
│     permalinks/blog·topics·admin prefixes excluded, skips warned at build)
│   │
│   ├── page_home ─ / ─ 🟢 CONVERTED (2026-07-10, all five criteria)
│   │   ├── s_hero ─ hero (inline) ─ kicker · heading · body(rich) · actions[LinkAction]
│   │   ├── s_audience ─ shared_ref → sec_home_audience_grid 🟢
│   │   ├── s_startgrid ─ shared_ref → sec_home_start_grid 🟢
│   │   ├── s_bio ─ bio (inline) ─ kicker · heading · body · trustNotes[] · disclaimer ·
│   │   │     portraitAssetRef (unused → MEDIA) · anchor
│   │   └── s_newsletter ─ shared_ref → sec_newsletter_signup 🟢
│   │
│   ├── LEDE FAMILY ─ 5 interior pages ─ 🟢 CONVERTED (W1, batched run 2026-07-11)
│   │   │   (scripts/lib/pages-interior-seed-data.mjs; store-backed, round-tripped, published,
│   │   │   released). page_newsletter is a plain lede (shared newsletter section optional later).
│   │   ├── page_start_here ─ /start-here ─ [lede]
│   │   ├── page_member_updates ─ /member-updates ─ [lede]
│   │   ├── page_newsletter ─ /newsletter ─ [lede]   (candidate: + shared_ref → sec_newsletter_signup)
│   │   ├── page_free_guide ─ /guides/free-guide ─ [lede]
│   │   └── page_early_access ─ /solutions/early-access ─ [lede]
│   │         lede attributes: kicker · heading · body(rich) · actions[] · anchor
│   │
│   ├── SYSTEM PAGES ─ 🟢 CONVERTED (W1, batched run 2026-07-11) (same combined batch +
│   │   │   driver run as the lede family; store-backed, round-tripped, published, released)
│   │   ├── page_privacy ─ /privacy ─ [prose]   prose: body (p/h2/h3/ul/ol allowlist)
│   │   ├── page_terms ─ /terms ─ [prose]
│   │   └── page_404 ─ /404 ─ [cta_banner]   cta_banner: heading · body · actions[]
│   │
│   ├── page_about ─ /about ─ 🟢 CONVERTED (2026-07-10) ─ decomposed off the bespoke `about`
│   │   │   anti-pattern into 8 standalone shared sections of REUSABLE types (the design-
│   │   │   principles win); a `standard` page of 8 shared_refs. Store-backed, round-tripped
│   │   │   in production, published, released. (The bespoke `about` TYPE was retired 2026-07-10.)
│   │   ├── s_intro ─ shared_ref → sec_about_intro 🟢 ─ bio (heading + copy + portrait photo)
│   │   ├── s_thinking ─ shared_ref → sec_about_thinking 🟢 ─ prose
│   │   ├── s_products ─ shared_ref → sec_about_products 🟢 ─ prose
│   │   ├── s_science ─ shared_ref → sec_about_science 🟢 ─ prose (list)
│   │   ├── s_research ─ shared_ref → sec_about_research 🟢 ─ prose (list)
│   │   ├── s_blog ─ shared_ref → sec_about_blog 🟢 ─ prose (list)
│   │   ├── s_note ─ shared_ref → sec_about_note 🟢 ─ prose
│   │   └── s_cta ─ shared_ref → sec_about_cta 🟢 ─ cta_banner (heading + body + actions)
│   │
│   ├── FORM PAGES ─ 🟢 CONVERTED (W2, batched run 2026-07-11) — store-backed, published, released.
│   │   │   All three bespoke per-page section types are now retired: the palette is
│   │   │   fully generic (design-principles rule 1 satisfied).
│   │   ├── page_contact ─ /contact ─ decomposed into 3 inline GENERIC sections:
│   │   │     lede{kicker,heading} · contact_form{formName,heading,subtitle,description,
│   │   │       disclaimer} (the fixed name/email/message field set is furniture) ·
│   │   │       content_grid{cards[{icon,title,description}]} ("How we can help", icons
│   │   │       added to the card cell). Bespoke `contact` type RETIRED. Scoped rule-4
│   │   │       visual diff on /contact; local round-trip proven.
│   │   └── page_thank_you ─ /thank-you ─ one `form_confirmation` section (the `thank_you`
│   │         type RENAMED to the reusable post-submit type; ?form= swap script unchanged).
│   │         eyebrow · heading · message · formMessages[{form,heading,message}] · actions[].
│   │         Renders byte-identically; local round-trip proven. Depended on by form redirects.
│   │
│   ├── HAND-CODED PAGES ─ 🔴 TODO ─ priority W5 (need NEW REUSABLE section types first —
│   │   │   see PALETTE ⚪ nodes; per design-principles, no new per-page types)
│   │   ├── page_pricing ─ /pricing ─ composes widgets: HeroText · Pricing · FAQs · Steps ·
│   │   │     Features3 · CallToAction → target objects: hero + ⚪pricing_table + faq +
│   │   │     ⚪steps + ⚪feature_grid + cta_banner
│   │   ├── page_services ─ /services ─ widgets: Hero · Content · Features2 · Testimonials ·
│   │   │     CallToAction → target objects: hero + ⚪content_split + ⚪feature_grid +
│   │   │     testimonial + cta_banner
│   │   └── page_shop_preview ─ /solutions/shop-preview ─ bespoke markup + scoped <style> →
│   │         target: product_preview (type exists; ProductCard[]) + prose/cta; needs the
│   │         functional-equivalence gate (known-inert-diffs.md) for the scoped style
│   │
│   ├── LISTING SURFACES ─ 🟣 RENDERS + SEEDED (W6 built 2026-07-12; awaiting the
│   │   │   credentialed run) ─ pageType 'listing'/'content_detail' are now DEFINED law:
│   │   │   the page objects own headings/copy/SEO (first lede = the header block;
│   │   │   extra sections render after the list via the registry), the query machinery
│   │   │   stays the audited build-time derivation. Per-term surfaces are ONE object
│   │   │   per route family with `%term%` pattern copy interpolated at build.
│   │   │   Seeds: scripts/lib/pages-listing-seed-data.mjs · byte-identical cutover.
│   │   ├── page_library ─ /learn/library ─ 🟣 [lede] ─ the blog index + pagination
│   │   ├── page_category ─ /category/[category] ─ 🟣 [lede "%term%"] ─ per-category listing
│   │   ├── page_tag ─ /tag/[tag] ─ 🟣 [lede "Tag: %term%"] ─ per-tag listing
│   │   ├── page_article ─ /%slug% ─ 🟣 content_detail ─ SEO defaults for EVERY article +
│   │   │     optional sections below the post (publishes with ZERO sections —
│   │   │     minVisibleSections 0; the SinglePost furniture is untouched)
│   │   ├── page_topics_index ─ /learn/topics ─ 🟣 [lede] ─ topic cards stay computed
│   │   │     from category frontmatter (D§5.5 — no Topic entity)
│   │   └── page_topic_detail ─ /learn/topics/[topic] ─ 🟣 [lede "%term%"]
│   │
│   ├── DEMO PAGES ─ ⛔ not conversion targets — deletion candidates
│   │     /homes/mobile-app · /homes/personal · /homes/startup (Astrowind starter demos)
│   └── ADMIN SURFACES ─ ⛔ never objects ─ /admin/** (tooling that EDITS objects)
│
├── SHARED SECTIONS — type: section (standalone single-instance wrapper; reused via shared_ref)
│   ├── sec_newsletter_signup ─ 🟢 CONVERTED ─ newsletter_signup: kicker · heading · body ·
│   │     formName('newsletter' → Netlify form) · consentText · anchor
│   │     dependents: page_home (candidate: page_newsletter, any future landing page)
│   ├── sec_home_audience_grid ─ 🟢 CONVERTED ─ content_grid · cards source (curated text cells)
│   ├── sec_home_start_grid ─ 🟢 CONVERTED ─ content_grid · query source ─ depends on:
│   │     content_item pipeline (published posts feed the cards)
│   └── ⚪ future shared sections ─ any section worth "edit once, changes everywhere"
│         (e.g. a sec_cta_free_guide reused across interior pages)
│
├── SECTION-TYPE PALETTE — code registry (one schema + component + editor hints per type);
│   │   NOT store objects themselves — the vocabulary pages/sections are composed FROM.
│   │   Adding a ⚪ type is code work (one union member + one registry module + one component).
│   ├── reusable, exist: hero · lede · prose · checklist(now unused on home; keep or retire) ·
│   │     content_grid(query|manual|cards; cards cells now take an optional `icon` —
│   │       covers the "how we can help" feature-grid shape) · card(leaf; block-tree later) ·
│   │     bio(now with optional URL `portrait` — the reusable "person intro", used on home + about) ·
│   │     newsletter_signup · testimonial · cta_banner · faq · link_list · product_preview ·
│   │     contact_form(now with optional subtitle/description) · form_confirmation(the reusable
│   │       post-submit type, ex-`thank_you`) · search · content_embed
│   ├── bespoke single-use types: NONE — the palette is fully generic as of 2026-07-11
│   │     (`about` retired 2026-07-10; `contact` retired + `thank_you`→`form_confirmation` 2026-07-11)
│   ├── wrapper: shared_ref (pointer, never rendered itself)
│   └── ⚪ needed by W5 (design them REUSABLE, agent-configurable):
│         pricing_table (tiers[] as card-like cells) · steps (ordered step cells) ·
│         feature_grid (icon+title+text cells; covers Features2/Features3) ·
│         content_split (Content widget: text + image/aside) ·
│         (maybe) brand_row / stats if those widgets ever go live
│
├── TAXONOMY ─ singleton (tax_drlurie) ─ 🟢 CONVERTED (W3, credentialed run 2026-07-11)
│     kinds: category (a.k.a. topic) · tag; term: term_id · slug · label · description? ·
│       status(active|deprecated) · merged_into?
│     DECISION (Wolf, 2026-07-11): curated agent-editable vocabulary — 5 categories +
│       26 tags distilled from the 93 posts' drifted frontmatter (Wolf approved the
│       canonical list + raw→canonical mapping; scripts/lib/taxonomy-seed-data.mjs).
│       Registry = source of truth for OBJECT-SIDE consumers from day one (the store
│       validation context wires resolveTaxonomyTerm automatically, so content_grid
│       query terms validate live). STEP 2 SHIPPED 2026-07-11: the bounded
│       publish-article hook resolves article terms against this registry (slug +
│       merged_into aliases; unresolvable → 422 TAXONOMY_TERMS_UNRESOLVED; canonical
│       slugs materialized into frontmatter; skips gracefully when no registry), all
│       93 posts normalized via RAW_TO_CANONICAL, and the blog renderer displays term
│       labels from the registry. Full content_item→ObjectRecord conversion stays
│       deferred as its own wave (OQ-8) — explicitly NOT a taxonomy prerequisite.
│     CONVERTED by the credentialed run 2026-07-11: store-backed, all 5 term ops
│       round-tripped in production, published, released (export commit 627fa8d;
│       store === seed === export). resolveTaxonomyTerm is live — content_grid
│       query terms now validate against the real registry.
│     dependents: content_grid queries · listing pages · learn/topics · rss categories
│
├── CONTENT_ITEM (articles) ─ separate pipeline ─ 🔵 deliberately OUTSIDE the object model (MVP boundary)
│     attributes (frontmatter today): title · slug · excerpt · publishDate/published_time ·
│       category? · tags[] · metadata{description} · image? · body (markdown today →
│       Contentful Rich Text later, core-structure task 8)
│     dependents: content_grid (query/manual) · content_embed · listings · rss.xml ·
│       search.json · related posts
│     ✅ enabler CLOSED (2026-07-11): the content_item resolver validates manual grid
│       picks against committed content (trap 4); render skips+warns on temporal drift.
│       Manual article curation in content_grid is agent-usable NOW.
│
├── TEMPLATES ─ type: template ─ 🟢 CONVERTED (W2.5, batched run 2026-07-11)
│     machinery LIVE end-to-end: template.v1 schema (name · appliesTo[pageTypes] ·
│       slots[{slotId, allowed[], required, repeatable, blueprint}]) · 4 patch ops ·
│       validation · materializer · the `object_instantiate_template` MCP tool
│       (instantiate verb: deep-copy slot blueprints → new page body via the standard
│       create path; required slot without blueprint → registry defaultData of its
│       first allowed type; stamps page.template provenance; dry_run previews without
│       persisting)
│     ├── tpl_interior ─ standard ─ lede + prose + optional cta (the W1 interior shape)
│     ├── tpl_landing  ─ standard ─ hero + curated card grid + cta (campaign shape)
│     └── tpl_legal    ─ system   ─ one required blueprint-less prose slot (exercises
│           the defaultData fallback)
│     seeds: scripts/lib/templates-seed-data.mjs · store-backed in production (all 4 ops
│       round-tripped + instantiate dry_run per recipe) · published · released 2026-07-11
│     boundary: recipes only — creation-time copy, never live-binding; PageType registry
│       stays the enforced law; behavior stays in generic components
│
├── MEDIA / ARTIFACTS ─ artifact store (images, PDFs) ─ 🔵 pipeline exists (upload/trust);
│     refs consumed by: bio.portraitAssetRef · about.portrait · product cards · article images
│     gap: trusted-artifact resolver on the RENDER path (embedded-asset-block later)
│
├── FORMS (Netlify forms: 'newsletter', contact) ─ ⚪ potential form object (formName +
│     field definitions); today form shape lives inside newsletter_signup /
│     contact_form section data — sufficient for MVP; a standalone form object only if
│     forms multiply
│
└── DERIVED ENDPOINTS ─ ⛔ never objects — re-generated from the above at build:
      rss.xml · search.json · sitemap-index.xml · robots.txt
```

## Potential objects composable from existing objects (no new code, or nearly none)

| ⚪ Potential object               | Composed of                                                                  | Unlocked by                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Topics hub as a page object       | page + one `content_grid` (query source, per category)                       | W3 taxonomy (or now, with hardcoded category slugs)                                                 |
| Any campaign/landing page         | page + hero + content_grid + cta_banner + shared newsletter section          | nothing — possible TODAY, and **served live automatically** (the object-page catch-all, 2026-07-11) |
| Newsletter page with live signup  | page_newsletter + `shared_ref → sec_newsletter_signup`                       | W1                                                                                                  |
| Curated "start here" grid         | sec_home_start_grid switched `query → manual + fallback`                     | nothing — possible TODAY (resolver closed 2026-07-11)                                               |
| Related-content strip on any page | `content_grid` (query by tag/category) placed via `upsert_section`           | W3 taxonomy for term filters                                                                        |
| Shared CTA reused across pages    | new section object (cta_banner) + `shared_ref` from N pages                  | nothing — TODAY                                                                                     |
| Article with embedded objects     | content_item body as Rich Text with `embedded-entry-block → section objects` | W7 (rich text)                                                                                      |

## PROPOSED conversion order (Wolf: edit this table — it is the queue)

| Wave       | What                                                                                                                                                                                                                       | Why this order                                                                       | Size |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---- |
| W1         | ✅ CONVERTED (batched run 2026-07-11): Lede family (5 pages) + system pages (3 pages) — store-backed, published, released                                                                                                  | Everything but the store record already exists; pure driver work, proves the factory | S    |
| W1-enabler | ✅ DONE (2026-07-11): `content_item` resolver — manual grid curation validates against committed content; render skips+warns on drift                                                                                      | Unblocks manual curation everywhere; small and high-leverage                         | S    |
| W2         | ✅ CONVERTED (batched run 2026-07-11): /contact → lede + contact_form + content_grid(icons); /thank-you → form_confirmation. Last bespoke types (`contact` retired, `thank_you`→`form_confirmation`) gone                  | Rendered stubs today; the last bespoke types retire with them                        | S-M  |
| W2.5       | ✅ CONVERTED (batched run 2026-07-11): `object_instantiate_template` verb + 3 starter recipes, store-backed in production                                                                                                  | Machinery is built and dormant; makes new specialty pages a zero-code agent action   | M    |
| W3         | ✅ DONE (credentialed run + step 2, 2026-07-11): tax_drlurie converted; publish-article enforcement hook + 93-post frontmatter normalization + registry display labels shipped — full §5.5 live for articles               | Unlocks term-filtered grids, listings, topics hub                                    | M    |
| W4         | ✅ CONVERTED (credentialed run 2026-07-11): site_drlurie store-backed; brandTokens/logo/chrome/metadataDefaults/defaultNavigation render from the object; urls/blog carried (config.yaml authoritative for routing per B2) | Makes global config agent-editable; removes config.yaml as a second source of truth  | M    |
| W5         | RE-GROUNDED in the shop module (2026-07-12 — see [`06-shop-module-plan.md`](06-shop-module-plan.md)): /pricing renders pricing_table tiers FROM product objects; shop-preview → content_split; /services awaits Wolf's copy-or-delete call (its current text is Astrowind lorem, audit A§2.13). The ⚪ types mint with real content, after S1–S3 of the shop build. **S1a DONE 2026-07-12: `product` is the eighth object type** (schema, verbs, validation, contract, review-required flip, §3 price funnel — sandbox-proven); store empty until S2 seeds | New reusable section types (pricing_table, steps, feature_grid, content_split)       | M-L  |
| W6         | 🟣 BUILT + SEEDED (2026-07-12): listing/content_detail PageTypes defined; 6 page objects (library, topics ×2, category, tag, article) seeded + wired, byte-identical cutover, local round-trip green — one credentialed run from CONVERTED | Biggest chunk; formalizes listing loaders; connects pages ↔ articles                | L    |
| W7         | Articles onto Contentful Rich Text (+ embeds, assets)                                                                                                                                                                      | Post-MVP by standing decision                                                        | L    |
| any        | Housekeeping: delete /homes/\* demos · retire `checklist` type (or keep as reusable) · archive/unpublish MCP verbs · announcement object if wanted                                                                         | Independent, non-blocking                                                            | S    |

**Keep this file current:** whenever an object converts, flip its mark here AND
in `object-inventory.md` in the same change (same rule, two views: the
inventory is flat per-object bookkeeping; this map is the relationship truth).
