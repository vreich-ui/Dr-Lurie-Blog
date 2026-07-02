# CMS Architecture — Session 4: Phased Implementation Plan

Date: 2026-07-02. Branch: `docs/cms-architecture-design`. Prerequisites, cited throughout: `01-audit.md` (**A§**), `02-architecture-and-schema.md` (**D§**), `03-mapping-and-agent-contract.md` (**C§**). This is sequencing only — every schema, contract rule, and mapping referenced here is already fixed in those documents and is not re-litigated.

**Correction to the session brief, flagged rather than worked around:** the brief lists schema amendments "M-1 through M-4." Session 3 as committed contains **five** amendments — M-5 (`groups[].target?: NavTarget`, C§1.2) was added during PR review after the audit showed the header's top-level 'Start Here'/'Learn'/'Solutions' entries are themselves links. This plan treats **M-1…M-5** as the current schema. M-5 lands in Phase 2 with the rest of the navigation schema; omitting it would ship a navigation cutover that silently drops three clickable targets.

**Standing rules, restated as plan invariants:**

- The live site builds statically from git and must keep doing so at every phase boundary (A§1.7). Every phase ends with `npm run build` green and — for cutover phases — a built-HTML diff against the pre-cutover build (see Part 2).
- **Articles are untouched.** No phase alters the article pipeline's workflow, tools, storage, or publish mechanics (Tier 1 parity, C§2.2). The single, narrow exception — additive taxonomy validation *inside* `publish-article` — is isolated in Phase 5 and explicitly gated (see Phase 5 and the Gap Notes).
- **No Template migration exists** (C§1.0: every current page is a one-off). Templates appear once, late, as a *new capability* (Phase 6).
- The tier gating model and `content_revision` pinning are cross-cutting infrastructure and are built **once, before any surface goes live under review** — that is Phase 1's entire reason to exist, per the brief's binding input 5.

---

# Part 1 — Ordered phases

Overview (each phase = independently shippable, site fully functional at its boundary):

```
P0  Object store & verbs            (additive; zero public-site change)
P1  Publish/review infrastructure   (additive; zero public-site change)
P2  Navigation + footers  ── first live cutover (Tier 3)
P3  Homepage as first Page object   (sections + CTAs live, Tier 2)
P4  Remaining static pages          (+ thank-you/contact resolutions)
P5  Site object + Taxonomy registry (Tier 3; the one article-adjacent step)
P6  Listings, Template capability, search page, cleanup & deferred items
```

Wolf's own example instructions become executable at: "update the footer CTA" → end of **P2**; "move the newsletter signup" → end of **P3**; "add a testimonial section" → **P3 + one registry module** (the registry is designed for exactly this addition, D§3.5).

---

## Phase 0 — Object store & generic verbs (foundation, no consumers)

**Goal:** the `ObjectRecord` envelope and agent/human verb surface exist and round-trip, with nothing on the public site aware of them.

**Scope (concepts):** `site-objects` blob store + key/index scheme (D§1); `ObjectRecord` envelope incl. `content_revision` (D§3.1); generalized lock endpoint (parameterize the blob key that `admin-workflow-lock.ts` hardcodes today, A§1.2/D§3.1 Δ-note); verbs `object_get/list/create/checkout/refresh/checkin/patch/validate` (C§2.0) exposed both as MCP tools and identity-auth admin endpoints (dual-auth pairing, D§5.8); typed patch grammar with `{before, after}` history entries — invertibility required per op (C§2.4 Discard semantics); per-type ID validators as creation ceiling (D§3.1, the C§2.0 safety item 2); zod schemas for `navigation` and `page`/`section` bodies including amendments M-1/M-2/M-5 (C§1.2–1.3) **plus one transitional variant this plan adds: `NavTarget` gains `{kind:'route', href: string}`** (site-relative), required by the P2→P3 bridge — without it, P2's seed would be schema-invalid (see Gap note 2 for its full lifecycle: introduced P0, consumed P2, upgraded P3/P4, removed P6).

**Depends on:** nothing.

**Why here:** everything else calls these verbs; and per D§1 the whole design is "the article envelope, generalized" — building the envelope first is what keeps later phases from each inventing a slice of it. The `workflows`-store adapter for articles (D§1) is *deliberately excluded* — articles stay on their own tools (Tier 1); the adapter is deferred with OQ-8 (see Deferred register).

**Rollback safety:** total. No public code path reads the store; deleting the functions and store returns the system to today. Site output byte-identical throughout.

**Exit criteria:** create → checkout → patch (with inverse replay) → validate → get round-trips for a test `page` and `navigation` object; 423/409 conflict behavior matches the audited lock/version semantics (A§1.2); MCP `object_*` tools callable with the existing publish key.

---

## Phase 1 — Publish/review infrastructure (cross-cutting, before any rollout)

**Goal:** the canonical publish operation and the review machinery exist end-to-end for a test object, so that when P2 flips the first real surface, it goes live under real gates — not with gating bolted on later. This is the brief's binding input 5, honored as its own phase.

**Scope (concepts):** canonical `object_publish_by_time` with the **export-first-then-stamp ordering and failure semantics** (D§5.6): shared materializer writing `src/data/site/*.json` with `__generated` markers (D§1), Git Data API committer generalized from `publish-article.ts:1717-1768` (A§1.6), single stamp+receipt write after commit; tier gate enforcement (Tier 1/2/3 matrix, C§2.2) including approval-pinned-to-`content_revision` checks (D§3.9); `object_submit_review` + `ReviewState` + role gates on the human side (`ROLE_EMAILS_*` minimal extension of `ADMIN_EMAILS`, D§3.9 — OQ-5 resolved provisionally to env vars for single-site, flagged); review surfaces 1 and 2 — field diff reusing the shipped `ai-suggestion.ts` diff components (A§1.3), structural diff (before/after ordered list, C§2.4) — in a minimal admin objects editor generalized from the `publish.astro` patterns (lock bar, per-block toolbar, history — A§1.5/A§1.3); Discard as compensating inverse write (C§2.4); Astro loader plumbing (content collections over `src/data/site/`) landed but **consumed by nothing yet**.

Deliberately *not* in scope: impact preview (surface 3) beyond a stub — its real content ("pages affected") needs Page objects, which don't exist until P3; P2 ships nav with the honest static message "affects all pages" (true today, A§2.2–2.3) and the full computed preview arrives in P3.

**Depends on:** P0 (verbs, envelope, history).

**Why here:** between the store (P0) and the first cutover (P2) because gating is worthless without objects to gate and dangerous to retrofit after surfaces are live — exactly the piecemeal risk the brief names.

**Rollback safety:** total; still zero public consumers. The loader plumbing reads files that don't exist yet (empty collection = no-op).

**Exit criteria:** a test page object completes draft → patch → validate → submit → approve (field + structural surfaces both exercised, Discard exercised with an inverse) → publish → derived JSON committed → receipt on record; a Tier 3 publish attempt by an agent principal is refused; an approval is correctly invalidated by a subsequent body write and *not* by lock activity or the publish stamp (the D§3.1/D§5.6 invariants, which survived four adversarial review rounds on this PR — treat them as load-bearing).

---

## Phase 2 — Navigation + footers: first live cutover (Tier 3)

**Goal:** header nav, global footer, and the homepage footer variant are CMS objects; `Header.astro`/`Footer.astro` render from published derived JSON; "update the footer CTA" is an agent-drivable operation with human-executed publish.

**Scope (concepts):** Navigation objects `nav_header`, `nav_footer`, `nav_footer_home` seeded verbatim from `navigation.ts` and `index.astro`'s `homeFooterData` per the C§1.2–1.4 mapping (labels, descriptions (M-1), group slots (M-2), group targets (M-5), typed `NavTarget`s — with would-be `page` targets seeded as the transitional `{kind:'route', href}` variant that P0 added to the validators for exactly this purpose, since no Page objects exist until P3; see Gap note 2); nav patch ops + safety validation (targets resolve, no empty groups, depth ≤ 2, duplicate-target *warning* — C§2.3-Navigation, honoring the audited triple 'Early Access' duplication, C§1.7-4); Tier 3 publish flow live for real.

**Cutover mechanics** (see Part 2 for the general pattern): `PageLayout.astro` stops importing `navigation.ts` and feeds Header/Footer from the derived JSON loader; `index.astro`'s `<Fragment slot="footer">` override is replaced by rendering `nav_footer_home` — **interim:** the instance choice is hardcoded in `index.astro` until P3 gives the homepage a Page record with `navigationOverrides.footer` (C§1.4). This interim is a one-line, clearly-marked bridge; flagged here so P3 remembers to remove it.

**Depends on:** P1 (Tier 3 gating, structural-diff review, publish op).

**Why first among the target surfaces:** lowest-risk, highest-symbolism cutover. The audit shows nav content is *already pure config* (`headerData`/`footerData`, A§2.2–2.3) and `Footer.astro` is *already a pure prop-driven renderer* (A§2.3) — so this cutover changes who feeds props, not what renders. It also retires audit fork #6 (the two-footer code fork) via data (D§5.4), and it is one of Wolf's three example instructions. Doing the easiest real surface first proves the whole pipeline (seed → edit → review → human publish → build) with minimal markup risk.

**Rollback safety:** single revert of the cutover commit restores `navigation.ts` consumption (the file is deleted only in this phase's *cleanup step, after* the cutover has survived a production deploy; until then it remains in-tree, unreferenced by real pages). **Cleanup-ordering caveat (verified against source):** two template leftovers still import `~/navigation` — `LandingLayout.astro:5` and `homes/saas.astro:11` — and Astro builds unlinked pages, so deleting `navigation.ts` alone would break the build two phases before P4's leftover sweep. And the chain continues one hop: all six `src/pages/landing/*.astro` demos import `LandingLayout.astro`, so deleting the layout without its importers breaks the build the same way. P2's cleanup commit therefore deletes the **whole dependency chain together**: `navigation.ts` + `homes/saas.astro` + `LandingLayout.astro` + the six `landing/*.astro` demos (all unlinked AstroWind leftovers, A§2.9 — zero-risk deletions that merely pull a slice of P4's sweep forward). Rule made explicit for the remaining phases: *a cleanup commit deletes a file only together with everything that imports it* — verified by building. P4 sweeps whatever leftovers remain. Derived JSON is inert when unreferenced.

**Exit criteria:** built-HTML diff of header/footers vs. pre-cutover build is empty (modulo attribute ordering); an agent `update_item` on a footer CTA label flows through structural/field review to a human-executed publish and appears on the live site; `navigation.ts` deleted; OQ-7 (merge `nav_footer_home` or keep) presented to Wolf — either answer is pure data by now, blocking nothing.

**§1.7 items handled here:** #4 (duplicate 'Early Access' targets → carried faithfully, warn-not-reject, editorial cleanup offered); #5/OQ-11 (mobile-only newsletter CTA → **decision point in this phase**: default is option (a) plain action unless Wolf picks the viewport flag — the cutover cannot proceed past the Header without *some* answer, so it is scheduled, not silently defaulted... with (a) as the recorded recommendation).

---

## Phase 3 — Homepage as the first Page object (sections + CTAs live, Tier 2)

**Goal:** `page_home` exists with the five mapped sections; `index.astro` is a thin loader; the component registry v1 renders it; "move the newsletter signup" and "add a testimonial section" become real operations.

**Scope (concepts):** PageType registry v1 (`home`, `standard`, `system` stubs — D§3.4); component registry v1 with exactly the types the homepage needs: `hero`, `checklist`, `content_grid`, `bio`, `newsletter_signup`, `shared_ref` (D§3.5, C§1.1) — implementations extracted from the existing `index.astro` markup (the `dl-*` idiom becomes registry components, D§2.6); shared section `sec_newsletter_signup` (first shared object, with reference counting live — C§2.3-section); `page_home` seeded per C§1.1 with verbatim content; renderer boundary per D§4.2–4.3 (`data`/`resolved`/`ctx` props, visibility filtering, published_time gate extended to pages); Tier 2 publish flow live (agent publish after pinned approval); full impact preview (surface 3) now computable (pages referencing shared sections); P2's interim footer-instance hardcode replaced by `page_home.navigationOverrides.footer`; nav `route` targets upgraded to `page` targets for pages that now exist.

**Explicit data resolution (no silent clean-data assumption):** the "Start here" grid placeholders (C§1.7-1) are **invalid under the contract** (`content_grid` manual items must reference real content items, C§2.3-page) — and reference-integrity checks reject such data at patch time, not just publish time (C§2.0), so the placeholder state cannot even be *seeded* as a manual list. It also cannot be hidden away: the renderer filters by visibility (D§4.3), so a hidden section would drop the grid from the built page and break this phase's empty-HTML-diff requirement. Therefore: **the Wolf decision — (a) designate/write five real articles or (b) switch to `source:{kind:'query'}` — is a precondition of the homepage cutover step**, scheduled at the start of P3 so it has the whole phase's runway. Fallback if the decision stalls and the cutover must not: a deliberately transitional `content_grid` variant `source:{kind:'static', cards:[{title, description}]}` that renders the audited placeholder copy verbatim (byte-identical output), is publish-valid, and is marked deprecated-on-arrival with its removal tied to the decision task. Either path keeps the live page unchanged at cutover; neither smuggles the invalid manual-refs state into the store.

**Depends on:** P2 (nav objects exist for `navigationOverrides` and page-target upgrades; Tier flows proven).

**Why here:** the homepage is the brief's priority surface and the mapping's richest page (five section types); doing it immediately after nav means the registry is built against real, audited content rather than invented examples — and every subsequent page (P4) reuses these types with diminishing marginal work.

**Rollback safety:** revert the `index.astro` cutover commit → hardcoded homepage returns; `page_home` record and derived JSON stay inert. The old inline arrays are deleted only in cleanup after a production deploy survives.

**Exit criteria:** built-HTML diff empty for `/` — which requires the grid decision resolved *or* the transitional static-cards variant in place (see above; a hidden or missing grid fails this criterion by construction); agent flow of C§2.5 example A (hero copy) and example B (reorder + hide, with a Discard-inverse exercised) run end-to-end against production; a `testimonial` registry module can be added and used on a draft without touching any file outside the registry (proves the "add a testimonial section" promise mechanically); no `route`-kind nav targets remain for pages that now exist as objects.

---

## Phase 4 — Remaining static pages (+ the awkward ones, resolved explicitly)

**Goal:** all eleven remaining real static pages are Page objects; the two behavior-shaped mapping leftovers are resolved; template-leftover files deleted.

**Scope (concepts):** Page records per C§1.6: `page_about`, `page_start_here`, `page_newsletter`, `page_member_updates`, `page_free_guide`, `page_contact`, `page_shop_preview`, `page_early_access`, `page_privacy`, `page_terms`, `page_404`, `page_thank_you`. New registry types: `prose`, `link_list`, `cta_banner`, `contact_form`, `product_preview`, `form_thank_you` (amendment M-3). External-URL images (about portrait, shop-preview products — C§1.6) become asset refs materialized through the artifact path (D§4.2, C§2.0 safety item 5).

**Explicit resolutions of C§1.7 items:**
- **#2 `thank-you.astro` query-param map** → implemented as the `form_thank_you` section type (M-3, the recommended option (a)): behavior in the component, per-form copy in `data`. Resolved here because the type ships in this phase's registry batch.
- **Contact `Features2` block (C§1.6)** → this phase *begins* with the deferred source check (read the actual `Features2` props in `contact.astro`) and maps it to `checklist`/`link_list`/new-type accordingly. Scheduled as the phase's first task precisely because the mapping flagged it unconfirmed — no seed is written from guesses.
- **`page_newsletter` without a form (C§1.6)** → decision point for Wolf: add `shared_ref → sec_newsletter_signup` or keep link-only. Data-only either way; recorded, not assumed.
- **Template-leftover deletion** (A§2.9: the remaining `homes/*` demos, `services`, `pricing`, and the unused `CallToAction`-widget usages — `landing/*`, `LandingLayout.astro`, and `homes/saas.astro` were already deleted as one dependency chain in P2's cleanup): safe to delete once no real page depends on widget files being present; scheduled here (not earlier) so deletions never interleave with cutovers of pages that still render; same rule as P2 — each deletion commit removes a file together with all its importers, verified by building.

**Depends on:** P3 (registry, PageType/loader machinery, Tier 2 flow — this phase is P3's pattern × 12 with new leaf types).

**Why here:** pure breadth after depth; nothing in it is architecturally novel, so it sequences after the one-page proof and before the config-layer work that would otherwise have to keep special-casing hardcoded pages.

**Rollback safety:** per-page cutover commits, individually revertible; same delete-only-after-deploy-survives discipline.

**Exit criteria:** every route the audit lists as "real" (A§2.13) renders from a Page object; built-HTML diffs empty per page; `MarkdownLayout` retired (privacy/terms are `prose` sections, C§1.6); zero references to leftover template files remain.

---

## Phase 5 — Site object + Taxonomy registry (Tier 3; the article-adjacent step)

**Goal:** site identity and vocabulary become governed objects; the last hand-edited config sources retire.

**Scope (concepts):**
- **Site:** `site_drlurie` seeded from `config.yaml` + `CustomStyles.astro` tokens + `Logo.astro` literal (C§1.0, A§2.13); derived export feeds the existing `astrowind:config` virtual-module plumbing (D§2.1 — the injection mechanism survives, its source changes); chrome flags incl. M-4 `chrome.search` (the header overlay's config, C§1.7-3); `defaultNavigation` bindings (retiring P2's site-level assumptions); Tier 3 flow with field-diff review.
- **Taxonomy:** `tax_drlurie` seeded from the union of committed frontmatter categories/tags (C§1.6 — explicitly *not* from the drift-y blob aggregation, A§2.11); term patch ops + safety (slug rules, `merged_into` requirements — C§2.3-taxonomy); editor autocomplete re-pointed from `admin-taxonomy` to the registry; `admin-taxonomy.ts` retired (the drift engine removal, D§5.5); listing/topics pages (still on today's frontmatter derivation until P6) unaffected.
- **The one article-pipeline touch, isolated and gated:** the contract requires article publishes to resolve terms against the registry with `merged_into` aliases (C§2.3-content_item, D§5.5). That is an *additive validation inside `publish-article`* — technically a change to the article path the plan otherwise never touches. Handling: **warn-only first** (publish succeeds, response carries `unresolved_term` warnings — the existing warnings channel, A§1.6), promoted to **enforcing** only after a Wolf-approved observation window with zero false rejections. This is called out as the plan's single deliberate exception to invariant "articles untouched" — see Gap Notes.

**Depends on:** P4 (all pages are objects, so Site's `defaultNavigation`/chrome changes have uniform consumers; no hardcoded page needs special-casing).

**Why here:** highest blast radius, lowest urgency — nothing in Wolf's example instructions needs it, and by now the Tier 3 flow has run for months on nav. Sequencing it after P4 also means brand-token changes re-materialize *all* page exports through one mechanism instead of a mixed fleet.

**Rollback safety:** Site cutover is one commit (config.yaml consumption → derived JSON consumption) with config.yaml retained until deploy-survives; taxonomy enforcement is warn-only until explicitly promoted, and demotion is a flag flip.

**Exit criteria:** `config.yaml`, `CustomStyles.astro` literals, and the `Logo.astro` hardcode retired; a taxonomy term rename via `merged_into` re-materializes affected exports and the impact preview lists the affected published items (C§2.4 surface 3); article publishes emit correct term warnings in warn-only mode.

---

## Phase 6 — Listings, Template capability, search page, cleanup & deferred register

**Goal:** the long tail, plus the capabilities that were deliberately *not* migrations.

**Scope:** listing Page records (`page_library`, `page_topics_index`, `page_topic_detail`, `page_category`, `page_tag`) making headings/SEO editable while the query machinery stays the audited build-time derivation (A§2.5–2.7, D§3.4) — topics remain category presentations, no Topic entity (D§5.5); `page_article` (`content_detail`) for route-level SEO defaults (C§1.6); **Template capability** as a new feature — create/instantiate per D§3.6, with zero migration backlog by C§1.0's finding; optional `/search` page using the `search` section type (the overlay stays chrome via M-4 — C§1.7-3); Decap CMS removal (OQ-10, confirmed with Wolf, A§2.12); SSR draft-preview route if OQ-9 resolves favorably (one-registry preview, D§4.4) — otherwise deploy-preview builds remain the preview story.

**Depends on:** P5 (taxonomy registry live for listing/topic term labels; Site object for chrome/search config).

**Why last:** everything here is either low-traffic surface (listings own almost no copy today, C§1.6), net-new capability (Templates, search page), or removal (Decap). None of it is on the path of Wolf's example instructions.

**Rollback safety:** per-item, as before; Templates and search page are additive features with no cutover risk.

**Exit criteria:** every object type in the C§2.2 matrix exists in production with its contract tier enforced; zero `route`-kind targets remain in any published navigation and the transitional variant is removed from the validators (Gap note 2's lifecycle closed); the transitional static-cards `content_grid` variant, if it was ever used, is retired; the Deferred register (below) is empty or re-triaged.

---

## Where each session-3 §1.7 item lands (completeness check)

| C§1.7 item | Phase | Treatment |
|---|---|---|
| 1. Homepage grid placeholders | **P3** | Wolf decision (real articles vs. query) is a cutover precondition; transitional renderable static-cards variant as the stall fallback — never hidden, never seeded as invalid manual refs |
| 2. thank-you `?form=` map | **P4** | `form_thank_you` type (M-3) |
| 3. Header search overlay | **P5** (config via M-4) + **P6** (optional page) | Chrome config on Site; section type only if a search page is wanted |
| 4. 'Early Access' duplicate targets | **P2** | Seeded faithfully; warn-not-reject; editorial cleanup offered |
| 5. Mobile-only newsletter CTA (OQ-11) | **P2** | Scheduled decision at Header cutover; recommendation = plain action |
| 6. `NetlifyOptInCapture` / analytics chrome | never | Deliberately not CMS objects (C§1.7-6); no phase touches them |
| 7. Admin surfaces / Decap | **P6** | Decap removal (OQ-10); admin workspace is tooling, not content |

## Gap notes (things sequencing exposed, flagged per the session constraint)

1. **Taxonomy enforcement vs. "articles untouched."** The contract (C§2.3, C§2.5-C) requires article publish-time term resolution, which cannot be implemented without an additive change inside `publish-article`. Sessions 2–3 did not spell out that this crosses the articles-untouched line. The plan isolates it in P5 with warn-first/enforce-later and names it as the sole exception. If Wolf wants absolute pipeline freeze, the alternative is enforcing terms only for *new* publishes routed through the generic verbs — weaker, but zero article-path change; decision belongs to P5.
2. **Nav targets before Pages exist.** The contract validates `NavTarget.page` refs against Page objects (C§2.0 item 3), but P2 ships navigation before P3 creates any Page — and D§3.8's `NavTarget` union has no variant that could express "this route, no object yet." The plan therefore **adds a transitional schema variant** rather than shipping schema-invalid seeds or dragging Page stubs into P2: `{kind:'route', href}` enters the validators in **P0**, is the seed form for page-like targets in **P2**, is upgraded to `page` refs as the referenced pages materialize (**P3** for the homepage-adjacent set, **P4** for the rest, **P6** for 'Topics'/listing pages — the last consumers), and is **removed from the validators in P6 cleanup**, whose exit criteria require zero `route`-kind targets in any published navigation. C§ didn't specify this ordering wrinkle; recorded here so the P2 seed doesn't get built to an impossible validation rule.
3. **Impact preview timing.** Surface 3 (C§2.4) is contractually part of Tier 3 review, but its content is degenerate until Pages exist. P2 ships it as a static truthful statement; P3 completes it. Flagged so nobody reads P2 as having quietly skipped a contract requirement.
4. **M-count drift in the brief** (M-1…M-4 vs. the committed M-1…M-5) — corrected at the top of this document.

## Deferred register (explicitly not scheduled, with owners-to-be)

- OQ-1 per-section locking — revisit only on real contention evidence (D§7); contract branch already written (C§2.6).
- OQ-2 scheduled-publish rebuild trigger — ops decision; receipts already expose "stamped but unbuilt" (C§2.6).
- OQ-3 per-agent credentials — unblocks per-principal matrix enforcement (C§2.6); no phase depends on it.
- OQ-6 persisted proposals — would simplify Discard (C§2.4); additive later.
- OQ-8 workflows-store adapter/migration for articles — deferred with articles-untouched; the generic verbs simply don't serve `content_item` until this lands (D§1's adapter requirement stands).
- OQ-9 SSR draft preview — P6 candidate, feasibility-gated.
- CI does not run the test suite (A§1.9) — recommendation: enable `npm test` in CI in P0, since P0–P1 are exactly the kind of pure-backend work the existing suite pattern covers. Not a CMS phase; recorded because the audit flagged it and this plan adds a lot of testable surface.

---

# Part 2 — Migration approach: parallel-path cutover with build-diff verification

**Decision: parallel-path (strangler-fig) cutover, surface by surface — not like-for-like in-place rewrites, not a big-bang.** The new system (store → verbs → review → publish → derived JSON → loaders) is built entirely alongside the running site (P0–P1 touch zero public code); each surface then cuts over in a single commit that changes *where an existing renderer gets its props*, and old sources are deleted only after the cutover survives a production deploy.

**Why this fits what the audit found, specifically:**

1. **The build model makes parallel data free.** The site builds statically from committed files (A§1.7). Derived JSON in `src/data/site/` is completely inert until a component reads it — so the entire pipeline, including real publishes committing real JSON, can run in production *before* any pixel depends on it. A parallel path costs nothing and proves everything.
2. **The renderers are closer to "pure" than the pages are.** The audit's key structural finding is asymmetric: *components* like `Footer.astro` are already fully prop-driven (A§2.3) and `Header.astro` renders whatever `headerData` shape it's given (A§2.2) — it's the *pages and config files* that hardcode content (A§2.1, A§2.13). So the cheapest safe move is to keep the proven markup and swap its feed: cutover = re-plumbing props, not rewriting renderers. Like-for-like rewriting of each section *inside* the old system would spend effort with no CMS at the end; big-bang would violate the every-boundary-functional invariant and discard the audit's asymmetry.
3. **Verbatim extraction enables mechanical verification.** Because seeds are copied verbatim from source (the C§1 mapping is string-exact by construction), the built HTML before and after a cutover must be identical. The verification step for every cutover commit: build both trees, diff the built pages (`dist/`), require an empty diff modulo attribute ordering/whitespace. This converts "did the migration change the site?" from judgment into a mechanical check — the same philosophy as the existing `validate-upload-images.mjs` build gate (A§1.9).
4. **The article precedent is the same pattern.** Articles already work exactly this way: authoritative blobs, derived committed files, renderers that never read blobs at runtime (A§1.7). The migration doesn't introduce a new operational model to the repo — it extends the one surface that already works to the surfaces that don't.

**Cutover discipline (uniform across P2–P5):**

```
per surface:
  1. seed        object(s) created via object_create from verbatim source content
  2. publish     through the canonical operation → derived JSON committed (site unchanged)
  3. cutover     one commit: renderer/layout reads loader instead of hardcoded source
  4. verify      built-HTML diff empty; deploy; observe
  5. cleanup     one commit: delete the old source (navigation.ts, inline arrays,
                 config.yaml…) — only after step 4 survives production
rollback at any point = revert step-3 (or step-5) commit; objects/JSON stay inert
```

Seeding is scripted (one-off `object_create` calls from parsed source), not hand-typed — the C§1 mapping tables are the script's spec. Where the mapping flagged unconfirmed content (contact `Features2`), the script does not guess; the phase schedules the source check first (P4).

**What this approach does *not* do:** it never runs two renderers for the same surface (the fork risk the audit flagged in the article preview, A§1.9, is not reproduced for pages); it never leaves a surface half-fed (a page reads either its old inline content or its Page object, never a mix — sections cut over as a page, not one section at a time, because the Page record is the locking/review unit, D§5.2); and it never deletes a fallback before production has proven the replacement.
