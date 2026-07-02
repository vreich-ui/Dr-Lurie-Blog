# CMS Architecture — Session 3: Current-Site Mapping & Agent Operability Contract

Date: 2026-07-02. Branch: `docs/cms-architecture-design`. Prerequisites, cited throughout: `01-audit.md` (**A§x.y**) for what exists; `02-architecture-and-schema.md` (**D§x.y**) for the concepts and schemas being applied. No implementation exists for anything here.

**Greenfield disclaimer, stated up front and repeated where it matters:** the agent operability contract in Part 2 is the *first* permissions/capability model this system will have. The audit is unambiguous: today authorization is a binary email allowlist for humans and one shared `x-publish-key` secret for agents, with no roles, no per-object permissions, and no review gates (A§2.12, A§1.8). Nothing below formalizes an existing pattern; it creates one, and it is deliberately designed to *fit into* the existing dual-auth reality (Netlify Identity for humans, publish-key/MCP token for agents, a few endpoints accepting either — A§1.8) rather than assuming a unified identity layer that does not exist.

---

# Part 1 — Current-site mapping

Every real (non-leftover) surface the audit documented, mapped onto the D§2 concepts, using the actual content strings from the repo. Object IDs shown are illustrative but follow the D§3.1/D§5.1 rules (opaque, prefix-typed, site-free); the *content* is verbatim from source.

## 1.0 Object inventory produced by this mapping

| Object | Type | Replaces (audit) |
|---|---|---|
| `site_drlurie` | site | `config.yaml` + `CustomStyles.astro` tokens + `Logo.astro` literal (A§2.10, A§2.13) |
| `page_home` | page (PageType `home`) | `src/pages/index.astro` (A§2.1) |
| `page_about`, `page_start_here`, `page_newsletter`, `page_member_updates`, `page_free_guide`, `page_contact`, `page_shop_preview`, `page_early_access` | page (`standard`) | the eight real hardcoded pages (A§2.4, A§2.9) |
| `page_privacy`, `page_terms` | page (`standard`) | `privacy.md`, `terms.md` (A§2.9) |
| `page_thank_you`, `page_404` | page (`system`) | `thank-you.astro`, `404.astro` (A§2.4, A§2.9) |
| `page_library`, `page_topics_index`, `page_topic_detail`, `page_category`, `page_tag` | page (`listing`) | blog list, topics index/detail, category, tag routes (A§2.5–2.7) |
| `page_article` | page (`content_detail`) | `[...blog]/index.astro` single-post route (A§2.5) |
| `nav_header` | navigation (role `header`) | `headerData` (A§2.2) |
| `nav_footer` | navigation (role `footer`) | `footerData` (A§2.3) |
| `nav_footer_home` | navigation (role `footer`) | homepage `homeFooterData` override (A§2.1) — pending OQ-7 merge decision |
| `sec_newsletter_signup` | section (shared) | the homepage inline Netlify form (A§2.1/A§2.4) |
| `tax_drlurie` | taxonomy | free-string frontmatter vocabulary + `admin-taxonomy` aggregation (A§2.11) |
| `req_*` (existing) | content_item | all articles, unchanged records (A§1.1, D§3.10) |
| — | page_type registry (code) | the informal idioms (A§2.10), per D§3.4 |
| — | component registry (code) | AstroWind widgets + `dl-*` markup implementations (D§2.6) |

Templates: **no Template objects are produced by mapping the current site.** Every existing page is a one-off; the audit found repeated *idioms*, not repeated *section arrangements* (A§2.10). Templates enter when a second page of the same arrangement is wanted (e.g., a second landing-style page). This is stated so nobody invents retroactive templates during migration.

## 1.1 Homepage → `page_home`

`route: '/'`, `pageType: 'home'`, `navigationOverrides.footer: nav_footer_home` (see §1.4). Sections in order, with the audited content:

| # | Audit finding (A§2.1, verbatim source) | Section instance |
|---|---|---|
| 1 | Hero: kicker "Physician-led skin health education", h1 "Healthy Skin for Skincare Newcomers", two paragraphs ("A calmer, clearer way to begin caring for your skin — without complicated routines, product pressure, or trend-led advice." / "Dr. Lurié Skin Care helps newcomers understand the basics of healthy skin…"), buttons **Start Here** → `/start-here`, **Join Newsletter** → `/newsletter` | `{ id: 's_hero', type: 'hero', data: { kicker, heading, body (two paragraphs as RichText), actions: [{label:'Start Here', target:{kind:'page', page:'page_start_here'}, style:'primary'}, {label:'Join Newsletter', target:{kind:'page', page:'page_newsletter'}, style:'secondary'}] } }` |
| 2 | "This is for you if…" mapping `audienceNotes`: "You are new to skincare and want a calm place to begin." / "You want to understand what your skin needs before buying more products." / "You prefer physician-led education over trend-driven routines." / "You want simple explanations that respect both science and everyday life." | `{ id: 's_audience', type: 'checklist', data: { heading: 'This is for you if…', items: [the four strings] } }` |
| 3 | "Start here" grid: kicker "Start here", heading "Five simple places to begin.", intro "Read these in order or choose the question that feels most useful today.", 5 placeholder cards (e.g., "What Healthy Skin Means" — "A plain-language starting point for understanding comfort, resilience, and consistency in your skin.") **not linked to any real post** | `{ id: 's_start_grid', type: 'content_grid', data: { heading, source: { kind:'manual', items:[…] } … } }` — **shape maps; data does NOT.** See §1.7 item 1. |
| 4 | "Meet Dr. Lurié" bio with `trustNotes`: "Physician-led perspective on skin health education." / "MD, PhD in Biophysics with decades of pharmaceutical research and development experience." / "Clear explanations designed for people who are just beginning to care for their skin intentionally." | `{ id: 's_bio', type: 'bio', data: { heading: 'Meet Dr. Lurié', body, trustNotes: [the three strings] } }` |
| 5 | Newsletter signup: inline Netlify form `name="newsletter"` posting to `/thank-you?form=newsletter` (the only real newsletter form on the site) | `{ id: 's_newsletter', type: 'shared_ref', data: { section: 'sec_newsletter_signup' } }` — promoted to a **shared section** (D§2.5) precisely because the audit shows other pages want it and don't have it (`newsletter.astro` has *no form*, A§2.4) |

`sec_newsletter_signup` (shared section object): `{ type: 'newsletter_signup', data: { heading, body?, formName: 'newsletter', consentText? } }`. The global submit-mirroring to `save-opt-in` stays layout chrome, not CMS data (A§2.4; §1.7 item 6).

## 1.2 Header navigation → `nav_header`

`role: 'header'`. Exact current content from `navigation.ts:4-77` (verbatim labels and descriptions):

```
groups:
  - title: 'Start Here'   (parent target: page_home)
      items:
        - 'Home' → page_home
            description: 'A science-first overview of what changes in skin after 60.'
        - 'About Dr. Lurié' → page_about
            description: 'Meet the biophysicist behind the age-aware approach.'
        - 'Start Here guide' → page_start_here
            description: 'Begin with the simplest path through Dr. Lurié skin health education.'
  - title: 'Learn'        (parent target: {kind:'listing', list:'content_index'})
      items:
        - 'Education Library' → {kind:'listing', list:'content_index'}
            description: 'Browse all skin science articles and practical explainers.'
        - 'Topics' → page_topics_index
            description: 'Explore articles grouped by their category frontmatter topics.'
        - 'Free Guide' → page_free_guide
            description: 'Get the structured guide to aging skin and body odor changes.'
  - title: 'Solutions'    (parent target: page_shop_preview)
      items:
        - 'Shop Preview' → page_shop_preview
        - 'Early Access' → page_early_access
        - 'Join Early Access' → page_early_access     ← duplicate target, see §1.7 item 4
actions:
  - { label: 'Join Early Access', target: page_early_access, style: 'primary' }
```

**Mapping-discovered schema amendment (M-1):** header dropdown items carry a `description` string (every item above has one, `navigation.ts:13,18,23,…`), but `NavItem` in D§3.8 has no such field. Amend D§3.8: `NavItem.description?: string`. This is exactly the kind of gap the mapping exercise exists to catch; recorded here rather than silently patched into 02.

Also mapped from the Header but **not** as navigation data (A§2.2): the RSS icon and theme toggle → `site.chrome.showRssFeed / showThemeToggle` (already in D§3.2); `HeaderAuthButton`/`LoginModal` → admin chrome, outside CMS data by design; the search overlay and the mobile-only newsletter CTA → §1.7 items 3 and 5.

## 1.3 Global footer → `nav_footer`

`role: 'footer'`. Exact content from `navigation.ts:79-108`:

```
groups:
  - title: 'Explore'
      items: 'Home' → page_home · 'About' → page_about ·
             'Education' → {kind:'listing', list:'content_index'} · 'Topics' → page_topics_index
  - title: 'Next steps'
      items: 'Free Guide' → page_free_guide · 'Shop Preview' → page_shop_preview ·
             'Early Access' → page_early_access · 'Contact' → page_contact
secondaryLinks (modeled as a group with role hint 'secondary'):
      'Terms' → page_terms · 'Privacy Policy' → page_privacy
socialLinks: [{ label: 'RSS', target: {kind:'asset', href:'/rss.xml'} }]
footNote: 'Educational content only — not medical advice. © Dr. Lurié.'
```

**Mapping note (M-2):** `Footer.astro` distinguishes `links` / `secondaryLinks` / `socialLinks` as three prop shapes (A§2.3). `NavigationBody` (D§3.8) models one `groups` array plus `actions`/`footNote`. Mapping choice: secondary and social become groups with a `slot` hint (`groups[].slot?: 'primary' | 'secondary' | 'social'`) — a second small amendment to D§3.8 recorded here as M-2, preferable to three parallel arrays because it keeps one reorder/patch grammar for all footer content.

## 1.4 Homepage footer override → `nav_footer_home`

Exact content from `index.astro:6-35`: brand `'Dr. Lurié Skin Care'`, descriptor `'Healthy Skin for Skincare Newcomers'`, groups **Start learning** ('Start Here', 'Library' → listing, 'Topics', 'Free Guide') and **Connect** ('About', 'Newsletter'), secondary 'Terms'/'Privacy', RSS, same footNote. Maps to a second Navigation instance referenced by `page_home.navigationOverrides.footer` — the sanctioned data-only variation mechanism (D§3.3, D§5.4). Whether it survives migration or merges into `nav_footer` is **OQ-7, still open** (editorial); both instances are representable, the `<Fragment slot>` code fork is not (D§5.4).

## 1.5 CTAs outside articles

| Audit finding (A§2.4) | Mapping |
|---|---|
| Homepage newsletter form (the only real one) | shared `sec_newsletter_signup` (§1.1 row 5) |
| Contact form (`contact.astro`, AstroWind `Contact` widget, `formName="contact"`, name+email+message+disclaimer) | `page_contact` section `{ type: 'contact_form', data: { formName: 'contact', heading, disclaimer } }` |
| `start-here.astro` two link CTAs → `/learn/library`, `/learn/topics` | `link_list` (or closing `cta_banner`) section on `page_start_here` with two `LinkAction`s |
| `guides/free-guide.astro` single CTA → `/newsletter` (guide itself doesn't exist yet) | `cta_banner` on `page_free_guide`; the missing guide artifact is a content decision, not a mapping problem |
| `member-updates.astro` → `/solutions/early-access`; `solutions/early-access.astro` → `/newsletter`, `/solutions/shop-preview`; `solutions/shop-preview.astro` → early-access, topics; `about.astro` end CTAs → library, free-guide | `cta_banner`/`link_list` sections on the respective Page records, targets as typed `NavTarget.page` refs |
| `thank-you.astro` per-`?form=` message map (keys `contact`, `free-guide`, `newsletter`) | **does not map cleanly** — §1.7 item 2 |
| `NetlifyOptInCapture` global form mirror | **deliberately not CMS data** — §1.7 item 6 |
| `CallToAction` widget uses | only on template leftovers (A§2.4) → no mapping; leftovers have no end-state representation (D§4.3) |

## 1.6 Remaining real pages

| Page | Sections (type sequence) | Notes |
|---|---|---|
| `page_about` | `hero` (no actions) · `prose` ×N (the bespoke sections, A§2.9) · `bio` · `cta_banner` (library + free-guide) | Portrait `<img>` currently loads from external `kugelmedia.netlify.app` (A§2.9) → becomes `bio.portraitAssetRef`, materialized like article media (D§4.2) |
| `page_start_here` | `hero` · `prose` · `link_list` | |
| `page_newsletter` | `prose` · single link CTA today (A§2.4) | End state should presumably include `shared_ref → sec_newsletter_signup` (a newsletter page with no form is the audit's oddity) — **editorial decision, flagged not assumed** |
| `page_member_updates`, `page_early_access` | `prose` · `cta_banner` | Placeholder copy today; mapping is 1:1 |
| `page_free_guide` | `prose` · `cta_banner` | |
| `page_shop_preview` | `hero`/`prose` · `product_preview` (two products, images currently external URLs → asset refs) · `link_list` | |
| `page_contact` | `hero` (from `HeroText`) · `contact_form` · one more literal-props block (`Features2`, A§2.9) | The `Features2` block's content wasn't detailed in the audit — mapped provisionally to `checklist`/`link_list`, **to be confirmed against source at migration**; flagged rather than invented |
| `page_privacy`, `page_terms` | single `prose` section (from the .md bodies) | `MarkdownLayout` retires; content becomes the section body |
| `page_404` | `prose` (+ optional `link_list`) | PageType `system` |
| `page_thank_you` | see §1.7 item 2 | PageType `system` |
| `page_library`, `page_category`, `page_tag`, `page_topics_index`, `page_topic_detail` | PageType `listing` with `defaultQuery` per route (D§3.4), driven by content items + `tax_drlurie` | These pages own almost no copy today (a `Headline` + list, A§2.5–2.7); their Page records mainly exist to make headings/SEO editable and agent-addressable |
| `page_article` | PageType `content_detail`; renders a Content Item (unchanged pipeline, A§1.7) | Not a section-composed page; the Page record owns route-level SEO defaults only |

Taxonomy seed: `tax_drlurie` is initialized from the union of frontmatter categories/tags currently in `src/data/post/` (A§2.6) — the blob-draft aggregation source (A§2.11) is *not* used as seed truth since it contains draft-only strings. Topics remain category presentations (D§5.5); the topics pages reference terms, no Topic objects exist.

## 1.7 Things that do NOT map cleanly (explicit, per session instructions)

1. **The homepage "Start here" grid content.** The *shape* maps to `content_grid`, but the five cards are fiction — placeholder titles/descriptions with no backing posts (A§2.1, A§2.13). There is nothing for `source.items` to reference. Migration must either (a) write/designate five real articles and reference them, or (b) switch to `source: {kind:'query'}`. That is an editorial decision; the mapping cannot manufacture it.
2. **`thank-you.astro`'s query-param behavior.** A single static page whose copy switches on `?form=` via a hardcoded map (A§2.4) is *behavior*, not section data. Resolution options: (a) a new `system`-only section type `form_thank_you` whose `data` is the message map keyed by `formName` (one page, behavior in the component, copy in data — consistent with D§4.2's "interactivity whose inputs arrive via data"); or (b) three static thank-you pages and form-specific redirects. **(a) is recommended** (fewer routes, forms already carry `formName`), recorded as amendment **M-3** adding `form_thank_you` to the D§3.5 union. Not silently resolved into 02 — listed here as a mapping product.
3. **The header search overlay.** It is chrome (lives in `Header.astro` with its own client engine, A§2.2/A§2.8), not a page section; the D§3.5 `search` section type presumes a page hosting it. Mapping: the overlay's configuration (enabled, `indexRoute`, placeholder copy) belongs on `site.chrome` — amendment **M-4**: `site.chrome.search?: { enabled: boolean; indexRoute: string; placeholder?: string }`. The `search` *section type* stays available for an optional future `/search` page but maps to nothing today (no search page exists, A§2.8).
4. **The Solutions dropdown duplication.** 'Early Access' and 'Join Early Access' are two items with identical target `/solutions/early-access`, plus the header action targets it a third time (`navigation.ts:48-76`). The mapping carries all three faithfully; flagging the duplication for editorial cleanup — the contract's nav validation (Part 2, §2.3-Navigation) will *warn* on duplicate targets within a group, not reject them.
5. **The mobile-only "Join Newsletter" CTA** hardcoded in `Header.astro:210-216` (A§2.2). `NavigationBody.actions` has no viewport scoping, and adding responsive variants to nav data is presentation leaking into structure. Options: (a) accept it as a normal action (shows on desktop too), (b) drop it (newsletter is reachable via nav), (c) add `LinkAction.visibility?: 'all'|'mobile'|'desktop'`. **Flagged as open (labelled OQ-11)** — smallest schema surface wins unless Wolf wants (c); the contract below is unaffected by the choice.
6. **`NetlifyOptInCapture` and analytics/theme scripts.** Deliberately *not* CMS objects: they are layout infrastructure with no editorial content (A§2.4). Listed so the boundary is a decision, not an omission.
7. **Admin surfaces and Decap.** The `/admin/*` workspace maps to nothing (it is the tool, not the content); Decap remains slated for removal (OQ-10, D§7).

Mapping verdict: every editorial surface the audit found lands on an existing concept; four small schema amendments (M-1 description, M-2 group slots, M-3 `form_thank_you`, M-4 chrome search) and one new open question (OQ-11 viewport-scoped actions) fall out. Nothing required a new top-level concept — the D§2 set held.

---

# Part 2 — Agent operability contract

## 2.0 Foundations

**Auth reality (greenfield restated).** Two principal classes, exactly as they exist today (A§1.8): humans authenticate with Netlify Identity bearer tokens against `admin-object-*` endpoints; agents authenticate with the shared `x-publish-key` (HTTP) or MCP transport token against the object verbs. Attribution for agents is self-declared `agent_name` recorded on history/review entries (today's trust model, A§1.2); per-agent credentials remain **OQ-3** — §2.6 describes how the matrix tightens if it lands. Roles for humans (`admin`/`publisher`/`editor`, D§3.9) gate the human side; the agent side is gated by this contract's per-type action matrix, enforced server-side where the key/token is verified (D§5.8). **None of this exists yet** — there is no role, no matrix, no review gate in the current system (A§2.12).

**Verb surface** (generalizing the audited `save_json_blob_*` discipline, A§1.8, D§5.8). All verbs are exposed both as MCP tools and publish-key HTTP actions; humans get the same operations via identity-auth endpoints:

```
object_get            { object_type, object_id }                          → record (draft state)
object_list           { object_type, filters? }                           → summaries
object_validate       { object_type, object_id, candidate_patch? }        → readiness report (dry-run)
object_create         { object_type, site, body, requested_id? }          → record
object_checkout       { object_type, object_id, lease_seconds? }          → lock_token   | 423 + holder
object_refresh_lock   / object_checkin                                    (as today, A§1.2)
object_patch          { object_type, object_id, lock_token,
                        expected_record_version, ops: PatchOp[] }         → { version, content_revision,
                                                                             validation_summary }
object_submit_review  { object_type, object_id, lock_token, note? }       → review state 'open'
object_publish_by_time{ object_type, object_id, lock_token,
                        published_time /* ISO | null | omitted=now */ }   → publish receipt | gate error
```

Article-specific tools (`save_json_blob_*`, per-agent `{agent}_update_output`, artifact tools) remain untouched for compatibility (D§5.8); `content_item` is *also* reachable through the generic verbs via the adapter (D§1).

**Typed patch grammar.** `object_patch` accepts typed operations, not raw record replacement — preserving the field-scoped write discipline and meaningful history of `admin-update-node` (A§1.3). Per-family ops:

```
Pages / shared sections:
  set_page_meta        { fields: Partial<seo|title|route…> }
  upsert_section       { section: SectionInstance, position?: number }
  update_section_data  { section_id, fields: Partial<data> }      ← the Ask-AI/Accept target
  move_section         { section_id, to_index }
  set_section_visibility { section_id, visibility: 'public'|'hidden' }
  remove_section       { section_id }
Navigation:
  set_nav_meta         { brand?, footNote? }
  upsert_group         { group, position? } · move_group · remove_group
  upsert_item          { group_id, item: NavItem, position? }
  update_item          { group_id, item_id, fields } · move_item · remove_item
  upsert_action        { action, position? } · remove_action
Taxonomy:
  add_term             { kind, term }                 (status 'active')
  update_term          { kind, term_id, fields: {label?, description?, slug?} }
  deprecate_term       { kind, term_id, merged_into? }
Site:
  set_site_fields      { fields: deep-partial SiteBody }   (validated per-field)
Template:
  set_template_meta · upsert_slot · move_slot · remove_slot
Content item:
  existing article patch surface unchanged (A§1.8); generic ops apply only to
  envelope-level fields via the adapter (D§1)
```

Every op application: requires active lock + `expected_record_version` (423 / 409 exactly as today, A§1.2); bumps `version`; bumps `content_revision` iff it mutates `body` (D§3.1); appends one history entry `{action: op name, actor, details: {before, after}}` — the per-op before/after is what the review surfaces (§2.4) render.

**Universal state machine for an agent-initiated change:**

```
draft ──checkout──▶ locked ──patch×N──▶ dirty ──validate──▶ eligible
   ──submit_review──▶ review.open ──(human decision)──▶ approved | changes_requested
approved + policy(type) ──publish_by_time──▶ published (export committed, then stamped, D§5.6)
any body write after approval ⇒ review reopens (content_revision moved, D§3.9)
checkin at any point releases the lock; review state survives checkin
```

**What "safe" means, globally** (per-type additions in §2.3). An agent write is *eligible for review* only if all of the following pass — these run inside `object_patch` (hard failures reject the op) and again as `object_validate` (full report):

1. **Schema validity** — per-type zod, registry-owned for sections (D§3.5); RichText constrained to the existing sanitizer allowlist `p,br,strong,em,a,ul,ol,li,h2,h3`, http(s)-only links (A§1.5).
2. **ID discipline** — per-type validators; `content_item` keeps `validateRequestId` verbatim (D§3.1; the A§1.9 autogen-mismatch class).
3. **Reference integrity** — every `NavTarget.page` resolves to an existing page; `shared_ref` targets exist and are `section` objects; `content_grid` queries reference `active` taxonomy terms; taxonomy strings on content items resolve via `merged_into` aliases (D§5.5).
4. **Reader safety** — `notes` and any private/internal fields never appear in renderable fields (generalizing `assert-reader-safe`, A§1.1).
5. **Media/artifact trust** — asset refs must be Major-Key index-trusted references, no data URIs, no arbitrary remote URLs (exactly the `admin-patch-workflow` validation, A§2.12/A§1.8; materialization per D§4.2).
6. **Structural invariants** — a page that is (or is about to be) published keeps ≥1 visible section (the direct analogue of `article_body.v1`'s "≥1 public node" rule, A§1.1); PageType `requiredSections` present, `allowedSections` respected (D§3.4).

## 2.1 The action vocabulary

`inspect` (get/list) · `validate` (dry-run) · `create` · `update` (field-level patch ops) · `reorder` (move ops — same patch channel, distinct review surface) · `hide`/`show` (visibility ops) · `submit for approval` · `publish`/`unpublish`/`schedule` (one verb, D§5.6) · `archive` (status op). Lock verbs wrap all mutating actions.

## 2.2 Per-type contract matrix (agent capabilities)

✅ = agent may perform · ⛔ = agent may not (human/code only) · R = requires review approval before it takes effect at publish · n/a = action meaningless for the type

| Action → / Type ↓ | inspect | create | update | reorder | hide/show | validate | submit review | publish |
|---|---|---|---|---|---|---|---|---|
| **content_item** (articles) | ✅ | ✅ | ✅ | ✅ (nodes) | ✅ (visibility) | ✅ | ✅ (optional) | **✅ direct** |
| **page** | ✅ | ✅ | ✅ | ✅ (sections) | ✅ | ✅ | ✅ | ✅ **after approval** (R) |
| **section** (shared) | ✅ | ✅ | ✅ | n/a | ✅ | ✅ | ✅ | ✅ **after approval** (R) |
| **template** | ✅ | ✅ | ✅ | ✅ (slots) | n/a | ✅ | ✅ | ✅ **after approval** (R) |
| **navigation** | ✅ | ⛔¹ | ✅ | ✅ (items/groups) | ✅ (item-level)² | ✅ | ✅ | **⛔ human-executed** (R) |
| **taxonomy** | ✅ | ⛔¹ | ✅ (add/update/deprecate terms) | n/a | via deprecate | ✅ | ✅ | **⛔ human-executed** (R) |
| **site** | ✅ | ⛔¹ | ✅ | n/a | n/a | ✅ | ✅ | **⛔ human-executed** (R) |
| **page_type** (code registry) | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | n/a | n/a | n/a |
| **component definition** (code registry) | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | n/a | n/a | n/a |

¹ Singletons/near-singletons: the Site object, the taxonomy registry, and the standard navigation instances are created once at migration; agents modify, they don't mint. (A new footer *variant* for a page — the `nav_footer_home` pattern — is the one legitimate nav-creation case: allowed, but its first publish is human-executed like all nav publishes.)
² Nav item hide/show = removing/adding from the draft; there is no per-item visibility flag — an unpublished draft change is invisible by construction.

**"Component instance" from the session brief:** component *definitions* are code — inspect-only via a read-only registry endpoint (D§3.4-style exposure). Component *instances* are Section instances: inline ones are governed through their owning **page** (one lock, one review — the D§5.2 record-level decision), shared ones through their own **section** object. There is no separately addressable "component instance" beyond these two, by design.

**Why the publish column differs by type (the deliberate three-tier split):**

- **Tier 1 — `content_item`: direct agent publish.** This is today's operating reality (`publish_by_time` is the canonical article path, A§1.6/A§1.8) and the audit's baseline of "articles are already partly agent-operable." Blast radius is one URL; safety comes from the publish-time validation stack (artifact trust, taxonomy resolution, readiness). Preserving parity here is a hard requirement — the contract must not regress the working pipeline. Review stays available but optional (policy knob, D§3.9).
- **Tier 2 — `page` / `section` / `template`: agent may execute publish, but only with an approval pinned to the current `content_revision`** (D§3.9). Blast radius is one page (or the pages referencing one shared section — surfaced at review, §2.4). Once a human has approved exactly this content, letting the agent pull the trigger adds no risk the approval didn't already accept, and keeps agents useful for "approve now, go live at 9am" flows (schedule).
- **Tier 3 — `navigation` / `taxonomy` / `site`: publish is human-executed, always.** Radius is every page simultaneously (A§2.2–2.3: one nav object feeds the whole site; taxonomy drives routes and validation; site drives brand/metadata globally). Approval pins content, but *executing* a site-wide change is kept as a human act as defense in depth — an agent holding a stale-but-technically-valid approval should not be able to time a global change. Agents do everything up to and including the request; a `publisher`/`admin` executes.

## 2.3 Per-type specifics: gates, review placement, safety

For each type: what the agent calls, what gates it, where human review sits, and what "safe" adds beyond §2.0's global checks.

### content_item (articles)

- **Verbs:** existing tool surface unchanged (checkout → `patch_agent_output`/`patch_canonical_input` → `mark_agent_complete` → `publish_by_time` → checkin, A§1.8); generic verbs reach envelope fields through the adapter (D§1).
- **Gates:** lock + optimistic versions (as today); publish requires the A§1.6 validation stack to pass.
- **Review:** optional; when policy enables it, the human surface is the existing block editor — field-level word-diff Accept/Discard (A§1.3) and Ask-AI (A§1.4), unchanged.
- **Safe (additions):** everything `publish-article.ts` already enforces (path/slug rules, sharp-decode image validation, artifact materialization, no raw refs in committed markdown — A§1.6) plus taxonomy term resolution with aliases (D§5.5). *This tier's safety bar is the template for everything else.*

### page

- **Verbs:** `object_checkout(page, page_home)` → patch ops (`update_section_data`, `upsert_section`, `move_section`, `set_section_visibility`, `set_page_meta`) → `object_validate` → `object_submit_review` → (approval) → `object_publish_by_time` → `object_checkin`.
- **Gates:** lock covers the whole page including inline sections (D§5.2 — OQ-1 branch in §2.6); publish gated on approval pinned to current `content_revision`; first-publish and every-publish both require approval (pages default to review-required, D§3.9).
- **Review placement:** two surfaces on the same review — (a) **field diffs** for `update_section_data` ops: the existing word-diff/side-by-side overlay per changed field (A§1.3), rendered per section; (b) **structural diff** for `upsert/move/remove/visibility` ops: before/after ordered section list (see §2.4 for justification). The publish gate shows the draft-vs-published composite (D§5.7).
- **Safe (additions):** §2.0 items 3/6 in full — route uniqueness across the site's pages; `pageType` exists in the registry and `allowedSections`/`requiredSections` hold; `navigationOverrides` targets are published navigation objects; every `LinkAction`/`NavTarget` resolves; ≥1 visible section if published; `content_grid` manual items reference existing content items (the §1.7-1 placeholder situation becomes *invalid data* under this contract — it cannot recur).

### section (shared)

- Same verb flow and review surfaces as page (it is a one-section page record in practice).
- **Gates:** as page, plus: publish review displays the **affected-pages list** (every page holding a `shared_ref` to it, D§5.7) — approving a shared section is approving its every appearance.
- **Safe (additions):** the target invariant of `shared_ref` consumers is re-checked (a type change to the shared section re-validates each referencing page's `allowedSections`); deleting/archiving a shared section is rejected while any published page references it (reference counting at validate time).

### template

- **Verbs:** patch ops on slots/blueprints; used at page creation (instantiation copies, D§3.6), so publishing a template affects only *future* instantiations.
- **Gates:** approval before publish (Tier 2). Rationale: templates are editorial policy; wrong blueprints multiply.
- **Safe (additions):** every slot's `allowed` types exist in the component registry; blueprints validate against their type's zod; `appliesTo` PageTypes exist; no `required` slot without a blueprint or clear editor hint.

### navigation

- **Verbs:** group/item/action patch ops (§2.0); reorder is first-class (`move_item`, `move_group`).
- **Gates:** approval on every publish + **human-executed publish** (Tier 3).
- **Review placement:** **tree diff** — before/after of groups→items with per-item field diffs (labels/descriptions via the standard side-by-side short-field view, A§1.3); *not* a word-diff of the whole structure (§2.4). Publish shows affected surface = all pages (site chrome) plus any page overrides pointing at this instance.
- **Safe (additions):** every item target resolves; targets of kind `page` must point at *published* pages at publish time (a nav link to an unpublished page 404s — hard failure), with a warn-only variant during drafting; empty groups rejected; depth ≤ 2 (current Header renders one dropdown level, A§2.2); duplicate targets within a group → warning not rejection (the audited real nav has them, §1.7-4 — the contract must not declare the current site invalid).

### taxonomy

- **Verbs:** `add_term`, `update_term`, `deprecate_term` (with optional `merged_into`).
- **Gates:** approval on every publish + human-executed publish (Tier 3). Term *addition* is the common agent case (an agent wants a new tag for an article) — still Tier 3 because publishing the registry changes validation behavior site-wide; the worked example (§2.5-C) shows the resulting flow is still fully agent-drivable up to the final human click.
- **Review placement:** term-level field diffs for label/description edits; **impact preview** for `deprecate_term`/slug changes: count + list of published content items whose frontmatter strings resolve to the term (computable from the derived exports; D§5.5), shown to the approver. Justification in §2.4.
- **Safe (additions):** slug unique per kind; slug shape `^[a-z0-9]+(?:-[a-z0-9]+)*$` (the existing slug rule, A§1.6); `merged_into` targets exist, are `active`, and form no cycle; deprecating a term with live usage *requires* `merged_into` (no stranding — the A§2.6 rename-strands-posts failure made structurally impossible).

### site

- **Verbs:** `set_site_fields` deep-partial patches (brand tokens, metadata defaults, chrome flags incl. M-4 search config, `defaultNavigation` bindings, blog config).
- **Gates:** approval on every publish + human-executed publish (Tier 3 — this object *is* the blast radius).
- **Review placement:** field diffs (short-field side-by-side — brand token hex values, titles); `defaultNavigation` rebinding shows which nav instance gains/loses site-wide effect.
- **Safe (additions):** `defaultNavigation.*` reference published navigation objects of the right `role`; brand token values parse as colors/font stacks; `blog` config values keep the routes the listing PageTypes bind to (changing `listPath` flags every listing page for re-materialization — surfaced in the impact preview).

### page_type / component definitions (code registries)

- **Inspect only** for agents: `registry_get('page_type' | 'component')` returns definitions including per-type zod as JSON Schema — this is how an agent learns what fields a `hero` accepts before patching one (and how Ask-AI's forced-tool schema is generated, D§5.7). All mutation is a code change (OQ-4 branch in §2.6).

## 2.4 Review surfaces — same pattern where possible, different where justified

The session constraint: the article diff/Accept/Discard pattern is the default; deviations must be argued. Three surfaces, one state machine (all write the same `ReviewState`, D§3.9):

1. **Field diff (existing, default).** Word-level for prose >80 chars, side-by-side for short fields — reused byte-for-byte from `ai-suggestion.ts` behavior (A§1.3) for every `update_section_data`/`update_item`/`update_term`/`set_site_fields` op, on every object type. Accept applies the op under lock; Discard drops it. This covers the large majority of agent edits (copy changes).
2. **Structural diff (new surface, same semantics).** For `upsert/move/remove` ops on sections, nav items/groups, template slots: a before/after ordered list (tree, for nav) with added/removed/moved badges, Accept/Discard per op where ops are independent, atomic accept where they aren't (a move + a dependent visibility change). **Justification for deviating:** `diffWords` over a serialized structure is noise — the audit's diff mechanism was built for prose fields (A§1.3), and "bio moved above content_grid" has no meaningful word-level rendering. The *semantics* (agent proposes → human sees exact change → Accept writes under lock → history entry) are identical; only the rendering differs. This is the "reorder homepage sections" case named in the brief.
3. **Impact preview (new surface, additive).** For blast-radius actions — publishing shared sections/nav/site, `deprecate_term`, slug/route changes — the review additionally shows *what will be affected* (pages referencing the object; published items whose terms resolve here; listing routes rebound). **Justification:** the approver's question for these actions is not "is this text right?" but "do I understand what this touches?" — no diff rendering answers that. It supplements, never replaces, surfaces 1–2.

Ask-AI (A§1.4) generalizes across all of it unchanged: read-only suggestion endpoint per object type, forced-tool schema generated from the registry zod (D§5.7), suggestions land as surface-1 field diffs.

## 2.5 Worked examples (end-to-end, concrete)

**A. Agent tightens the homepage hero copy.**

```
object_checkout   {object_type:'page', object_id:'page_home'}            → lock_token L
object_patch      {…, lock_token:L, expected_record_version:14, ops:[
                    {op:'update_section_data', section_id:'s_hero',
                     fields:{ body:'<p>A calmer, clearer way to begin…</p>' }}]}
                  → {version:15, content_revision:8, validation_summary: ok}
object_validate   {object_type:'page', object_id:'page_home'}            → report: 0 missing, 0 warnings
object_submit_review {…, note:'Tightened hero paragraph per brief'}      → review.state:'open'
   … human reviews: surface 1 (word diff on body), decision approve
     → review.state:'approved', decisions[+1].content_revision:8
object_publish_by_time {…, lock_token:L}       → gate check: type=page (Tier 2),
     approval pinned to content_revision 8 == current 8 → allowed
     → materialize pages/page_home.json → git commit → stamp+receipt (D§5.6)
object_checkin
```

Post-state: `version:17` (publish write bumped it), `content_revision:8` (unchanged by publish, D§3.1), `publication.published_time` set, receipt on record, history shows checkout/patch/submit/approve/publish/checkin with actors.

**B. Agent reorders the homepage and hides the checklist.**

```
ops:[ {op:'move_section', section_id:'s_bio', to_index:1},
      {op:'set_section_visibility', section_id:'s_audience', visibility:'hidden'} ]
```

Validation: page stays ≥1 visible section ✅; PageType `home` has no `requiredSections` violated ✅. Review renders surface 2: ordered list `s_hero → s_audience(hidden) → s_bio…` vs before, two independent ops → separately acceptable. If the human accepts the move but discards the hide, only the accepted op survives (the discard rewrites the draft under the reviewer's authority — one more `set_section_visibility` op authored by the human, recorded as such). Publish then follows example A's gate.

**C. Agent introduces a new tag and uses it on an article.**

```
1  object_checkout {taxonomy, tax_drlurie} → L1
2  object_patch    {…, ops:[{op:'add_term', kind:'tag',
                     term:{slug:'sunscreen', label:'Sunscreen'}}]}     (term_id minted server-side)
3  object_submit_review → human approves (surface 1; no impact preview needed for add)
4  — HUMAN executes object_publish_by_time on tax_drlurie (Tier 3) →
     taxonomy.json re-materialized, committed
5  object_checkin {taxonomy}
6  agent proceeds on the article exactly as today (A§1.8):
     save_json_blob_checkout_request → patch publish_payload.tags += 'sunscreen'
     → save_json_blob_publish_by_time (Tier 1, direct) → checkin
     publish-time validation resolves 'sunscreen' against the now-published registry (D§5.5) ✅
```

The only human act is step 4 — deliberate (Tier 3), and the agent's article flow (step 6) is unchanged from the audited pipeline. If the agent skips steps 1–5 and just writes an unknown tag string, article publish fails validation with a machine-readable "unresolved term" error naming the fix — that failure mode replaces today's silent vocabulary drift (A§2.11).

## 2.6 Contract under the open questions (flagged, both branches described)

- **OQ-1 (sub-object locking).** This contract assumes one lease per record (D§5.2): an agent editing `s_hero` blocks a human editing `s_bio` on the same page for ≤15 min (or until checkin). If OQ-1 resolves to per-section leases, the contract changes mechanically: `object_checkout` gains an optional `scope: {section_id}`; patch ops carry section-scoped tokens; 423 conflicts become per-section; review/approval stays record-level (approvals pin `content_revision`, which stays record-scoped). The action matrix, gates, and review surfaces are unchanged. If it resolves to "factor contended sections into shared objects," nothing changes at all — that pressure valve is already in the contract (shared sections have their own locks).
- **OQ-3 (per-agent credentials).** Today the matrix is enforced against *the agent class as a whole* (one shared key — any agent can do what any agent can do, attribution self-declared, A§1.8). With per-agent tokens, the same matrix gains a per-principal dimension (e.g., a content-pipeline agent scoped to `content_item` only; a site-ops agent allowed Tier 2 publishes). The verb surface and per-type contract do not change; only *whom* each ✅ applies to becomes enforceable. `Principal.auth` already carries the slot (D§3.9).
- **OQ-4 (PageType as data).** If PageTypes become blob objects, they enter the matrix as a Tier 3 row (agent update/submit; human-executed publish — route/loader blast radius). Until then: inspect-only, as specified.
- **OQ-6 (persisted proposals).** This contract routes agent changes through the live draft under lock (today's model, A§1.3/A§1.8) with review state on the record. If persisted proposal objects land, `object_patch` gains a sibling `object_propose` (no lock, no draft mutation); review surfaces render the proposal instead of draft-vs-history ops; Accept applies it as patch ops under a reviewer-held lock. The matrix's ✅/⛔ columns are unaffected; "update" simply gains a second, lock-free entry path. Until then, agents that cannot obtain the lock wait or escalate — same as human editors (A§1.2).
- **OQ-2 (scheduled publish).** `object_publish_by_time` with a future timestamp is allowed wherever publish is allowed (the gate checks are identical); *going live* still depends on a rebuild at/after that time. The contract records the receipt with `deployStatus` so an agent can detect "stamped but not yet built" and re-trigger — but the rebuild mechanism itself remains OQ-2.
- **OQ-7 (footer merge) and OQ-11 (viewport-scoped actions, new — §1.7-5)** affect mapping content, not the contract: either resolution changes which Navigation instances exist, not what agents may do to them.

## 2.7 Compliance index (session constraints → where satisfied)

| Constraint | Where |
|---|---|
| Mapping uses actual audited names/content | §1.1–1.6 (verbatim strings from `index.astro`, `navigation.ts`, audit citations per row) |
| Non-fitting findings flagged, not forced | §1.7 (7 items), amendments M-1…M-4, OQ-11 |
| Contract grounded in the mapping | §2.3 examples reference `page_home`/`s_hero`/`nav_footer_home`/`tax_drlurie`; §2.5 worked examples operate on mapped objects |
| Greenfield honesty | Preamble, §2.0, §2.2 rationale (no existing roles/matrix, A§2.12) |
| Dual-auth fit, no unified identity assumed | §2.0 (verbs exposed per principal class; enforcement at key/token verification, D§5.8) |
| Article review pattern as default; deviations justified | §2.4 (surface 1 default; surfaces 2–3 argued) |
| Open questions not silently resolved | §2.6 (OQ-1/2/3/4/6/7 branches); OQ-11 added |
| No sequencing/phasing | none present; migration mentions are decision-flags only (§1.6–1.7) |
