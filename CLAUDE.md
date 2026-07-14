# Dr-Lurie-Blog — CLAUDE.md

## Definition of "converted" — NO HALF MEASURES (Wolf, 2026-07-10, GOVERNING)

The entire project goal is: **agents can change objects on every page — add
permitted objects, edit them — through the MCP.** So "convert an object" means
exactly this and nothing less. An object counts as converted ONLY when **all five**
hold (full definition + recipe: [`docs/cms-architecture/conversion-playbook.md`](docs/cms-architecture/conversion-playbook.md)):

1. **Renders** in Astro from the object (the four build gates).
2. **Store-backed** — a real record in the **production object store**
   (`object_inventory` returns it), not merely a committed git export. _A rendered
   export with no store record is a **rendered stub, not a converted object.**_
3. **Round-trips** — an agent can perform **every permitted action** end-to-end via
   MCP (checkout → each patch op → publish → release → re-render), proven not assumed.
4. **Contract-complete** — every permitted action is in `object_contract` AND backed
   by an actual MCP server tool. **A permitted action with no tool/contract entry is
   itself part of the conversion** — build it; the object is not done without it.
5. **Recorded** — `object-inventory.md` row + `state-of-play.md` entry, same change.
   **No record = not converted.**

**Hard rules that follow:**

- **No half measures, no unfinished work.** A "convert X" task is done only when X
  passes all five. Rendering-only work is labelled "rendered, not converted."
- **After EVERY session, update the documentation.** An object does not count as
  converted without a written record of it (inventory row + session-log entry).
- Reality as of 2026-07-14: **forty-seven objects are converted** (the 37 below
  + the 3 W5 pages, credentialed run 2026-07-13 + the FIRST ARTICLE OBJECT,
  W7.9 run 2026-07-13 + the 5 SECTION TEMPLATES and the DEFAULT THEME,
  W8.4 run 2026-07-14) — the 3 nav
  objects, all 12 page objects (home + about + the 8 W1 interior/system pages +
  page_contact + page_thank_you), the 12 shared sections under home/about, the
  3 templates (tpl_interior/landing/legal), the `tax_drlurie` taxonomy
  registry (W3 — curated agent-editable vocabulary, 5 categories + 26 tags;
  `resolveTaxonomyTerm` is live), and the `site_drlurie` SITE SINGLETON (W4,
  credentialed run 2026-07-11: the layout renders brandTokens/logo/chrome/
  metadataDefaults/defaultNavigation from its export via `set_site_fields`;
  urls/blog carried, config.yaml stays authoritative for routing — Wolf B2).
  All proven by credentialed `--production --release` runs on 2026-07-11.
  **No page renders from an unbacked export anymore — the rendered-stub
  backlog is empty.** The section-type palette is fully generic (no bespoke
  per-page types: `about`/`contact` decomposed, `thank_you` →
  `form_confirmation`). W3 step 2 SHIPPED (2026-07-11): the bounded
  publish-article taxonomy-enforcement hook (the sanctioned additive exception
  — registry-gated, skips when no registry) + the one-time frontmatter
  normalization of all 93 posts + registry display labels in the blog
  renderer. The 28-invisible-posts caveat is CLOSED (2026-07-11: 10 junk posts
  deleted, 18 real ones stamped with `published_time`; 167 pages, topics hub
  live). **Agent-CREATED pages are live end-to-end (2026-07-11, B1 closed)**:
  the object-page catch-all (`src/pages/[...objectPage].astro` +
  `src/utils/object-page-routes.ts`) serves any published Page object whose
  route no file owns — create → publish → release → live, zero code.
  **Write-time guardrails (2026-07-11, traps 5+14 closed)**: `validateObject`
  now blocks, at patch/create/publish, content that would break the deploy
  (protected env values in any encoding; repo-file hotlink URLs) or the build
  (per-component rich-text vocabulary, checked with the real splitters) — an
  agent can no longer publish something that dead-ends the pipeline.
  **W6 CONVERTED (2026-07-12, credentialed run same day)**: the
  `listing`/`content_detail` PageTypes are defined law (all five implemented;
  content_detail publishes with zero sections via `minVisibleSections: 0`),
  and six page objects (page_library, page_topics_index, page_topic_detail,
  page_category, page_tag, page_article) make the listing surfaces'
  headings/copy/SEO agent-editable — first lede = the header block, extra
  sections render after the list/article, per-term objects carry `%term%`
  pattern copy — while the query machinery stays the audited build-time
  derivation. Byte-identical cutover; all six store-backed, round-tripped,
  published, released (store === seed === export). Hidden sections are now
  filtered at the resolver on every render path (never-render-private).
  W5 was RE-GROUNDED in the shop module
  (`docs/cms-architecture/06-shop-module-plan.md` — Stripe-only v1 plan;
  /pricing renders from product objects, /services awaits a copy-or-delete
  call; the shop build runs in its own session).
  **W7 CONVERTED (2026-07-13: W7.3 + W7.8 built; W7.9 credentialed run the
  same day via the session MCP connection — the type's five criteria all
  hold)**: `content_item` is the NINTH governed type — the
  annotated-node article model (every block carries `private.strategy`
  hook/agitation/…/resolution + `intent`, the original architecture's
  semantic layer, imported verbatim; envelope claims/sources/compliance/
  scores/lineage; `public.body` = plain text or `rich_text.v1`), six node
  ops with exact inverses, `create_variant` (+ MCP tool, `dry_run`),
  validation (one slug space with committed posts; the reader-projection
  leak scan; renderable rich-text grammar), materializer →
  `src/data/site/articles/`, and the render path: published article objects
  join `fetchPosts()` as first-class posts with per-node canvas chips
  (pencil + node-scoped Ask-AI) on the standard EditSession →
  `update_node` → publish/release path. **Wolf's 2026-07-13 ruling
  (SUPERSEDED same day): the 83 committed .md posts were "mostly junk … needs
  rewriting" — WIPED, not kept.** All 83 `src/data/post/*.md` deleted; the
  `post` collection is now permanently empty (a benign build-log warning; all
  articles are content_item OBJECTS). Replaced by a TEN-ARTICLE corpus (two
  per registry category — skin-health/skincare/skin-after-40/ingredients/
  reflections; `scripts/lib/articles-corpus-seed-data.mjs`) created via the
  credentialed run. The first-article W7.9 seed
  (`scripts/lib/articles-seed-data.mjs`) remains as the demo at
  `/object-model-demo`. Unpublish remains
  unsupported (OQ-2) — a released article stays live until edited. The W7.9
  run (2026-07-13): create → all six node ops drilled byte-identical →
  validate clean → `create_variant` dry-run → publish (export commit
  `60cd213`) → release (deploy ready) — the demo article is LIVE at
  `/object-model-demo` with per-node canvas chips; found+fixed en route: the
  seed's taxonomy terms didn't exist in the production registry (now
  `reflections`/`reflections`). **Wolf's 2026-07-13 ruling (supersedes
  OQ-W7-1): reverse support is NOT required** — the legacy article tools
  need no alias layer; MCP tools and functions may be updated, changed, or
  retired as the remaining W7 phases land, provided the functionality
  (drafting workflow, publish safety stack, admin editor) survives on the
  object substrate. Still open: W7.2 (sections onto rich text), W7.5
  (re-point internal surfaces; reduced — no aliases), W7.7 (admin editor +
  annotation panel + document-body canvas editing), OQ-W7-3 (strategy
  registry go/no-go).
  **W8 CONVERTED (2026-07-14: W8.1–W8.3b built + merged; W8.4 credentialed
  run same day via the session MCP connection)**: the RECIPE FAMILY —
  `section_template` (tenth governed type; stpl_hero_landing /
  stpl_audience_grid / stpl_related_articles / stpl_newsletter_cta /
  stpl_cta_banner) and `theme` (eleventh; thm_drlurie_default, the
  production palette verbatim — applying it is a no-op) — plus
  `object_instantiate_section_template` (stamp a section from a recipe,
  standalone or page mode), `site_apply_theme` (exact-replace token apply
  with stale-key nulls), template `blueprintRef` composition, CSS-token
  injection safety on theme AND site, and W8.3b's recipe metadata
  (description/whenToUse/scope REQUIRED TO PUBLISH), creation-policy seam
  (committed config; default open; humans always), and reuse-first
  surfacing (inventory recipe summaries + REUSE-FIRST contract workflow +
  editor.useWhen ×19). Step 0 backfilled the trio onto the 3 live tpl_*
  (published rev 20; exports content-identical to the W8.3b
  pre-materialization). All 9 objects: created/reconciled → every
  permitted patch op drilled with exact inverses → published → released
  (deploy ready 2026-07-14T16:23Z); store === seed === export verified.
  ONE OUTSTANDING PROOF ITEM: the application-verb production dry_runs
  (instantiate_section both modes; apply_theme dry_run + one real no-op
  default apply) — blocked ONLY by this session's frozen MCP tool
  snapshot (the tools deployed mid-session; a session's connector
  snapshot never refreshes); they are verb-level-tested in the merged
  suite and are the FIRST ACT of the next session. tpl_fieldtest (the
  2026-07-08 fieldtest leftover) still lacks the metadata trio — patching
  it 422s until backfilled or retired.

## Core structure — read [`docs/cms-architecture/core-structure.md`](docs/cms-architecture/core-structure.md) FIRST

The system standardizes on **Contentful's content model**: typed entry objects
(pages/sections — already built) + **Contentful Rich Text** JSON for all rich
content fields (replaces HTML strings). That doc has the canonical example for each
level and the ordered task list to finish the CMS. It is the entry point; everything
below elaborates it.

## Design north star — flexible objects, not a site replica (READ FIRST)

We are building a **flexible content backbone, not reproducing today's pages
one-for-one.** Prefer **reusable, agent-configurable components** (a `content_grid`
an agent can point at any content and set to N cells) over **bespoke per-page types**
(a section that renders exactly one page). Byte-identical cutover was migration
_safety_, not the goal — "an agent can now reconfigure this to play a different role"
is. **Litmus test:** if an agent can't repoint or reuse a thing without a code
change, it's a replica, not backbone — generalize it. Full rule + consequences:
[`docs/cms-architecture/design-principles.md`](docs/cms-architecture/design-principles.md).
This **governs** where the phased-plan's "faithful reproduction" / "new component
type per page" framing conflicts.

## CMS architecture project — mandatory pre-task reading

If the task you've been given relates to the agent-actionable CMS project (object store, Pages, Sections, Navigation, Taxonomy, Site config, Templates, or anything under `docs/cms-architecture/`), **read these files in full before writing any code, in this order**:

1. Your task's standalone brief: `docs/cms-architecture/cms-pipeline/T<phase>.<n>-*.md` (e.g. `T0.6-patch-grammar-inverses.md`). Its header carries the task's `depends_on`, `mode`, and recommended `model`/`effort`. **Check `depends_on` before starting anything — if a dependency isn't actually built and merged yet, stop and say so. Don't proceed on the assumption it exists.** (Phase 0 briefs are committed so far; later-phase briefs land in the same directory as they're written.)
2. `docs/cms-architecture/cms-pipeline/queue.tsv` — task ordering and per-task `mode`/model/effort; `docs/cms-architecture/cms-pipeline/README.md` explains the runner around it.
3. For the full per-task spec: `docs/cms-architecture/05-task-breakdown-and-open-questions.md`. `docs/cms-architecture/02-architecture-and-schema.md` and `docs/cms-architecture/03-mapping-and-agent-contract.md` have the full reasoning behind any schema or permission decision you're implementing. These numbered session docs (01–05) are the authoritative sources: a consolidated master reference (`cms-architecture-consolidated.md`) is named by some briefs but has not been committed to the repo — where anything conflicts, the source docs are ground truth.
4. `docs/cms-architecture/conversion-map.md` — the FULL tree of actual + potential objects (attributes, dependencies, dependents, Wolf's conversion priority). **Pick conversion targets and their boundaries from here.** Then `docs/cms-architecture/object-inventory.md` — the human-facing catalog of what content objects exist right now (each marked LIVE / SHELL / TODO), every object type's use + boundaries, and the MVP todo list. Read it to know what is already an editable object vs. still hardcoded. **It is hand-maintained and drifts easily: update the matching row in the SAME change whenever you cut over a surface or publish/retire an object.** For always-current machine truth, prefer the `object_contract` / `object_inventory` MCP tools over any doc.
5. **Converting a surface to an object? `docs/cms-architecture/conversion-playbook.md` is mandatory** — the exact lifecycle recipe, the call/response field names (do not guess them), and the trap table (deep-merge patch semantics, reference seeding, rich-text vocabularies, the expected sandbox publish block). Every trap in it was hit for real once; the playbook exists so it never costs a second fix-up pass.

Do not skip this because the task instructions in front of you look self-contained. They're deliberately terse and assume this context is already loaded.

## Hard constraints — every session, every task

- **`admin-workflow-lock.ts`, `publish-article.ts`, and the existing article MCP tools are off-limits** except for the explicitly bounded exceptions (T5.6, T5.7, and the W3 taxonomy-enforcement hook — Wolf-sanctioned 2026-07-11, shipped: a registry-gated insertion before `buildFrontmatter` that skips entirely when no taxonomy record exists) — and even those must be additive, isolated, single-purpose PRs with zero behavior change to existing tests.
- **Never open a PR unless the task brief explicitly says to.** Commit to the working branch and stop; ask before pushing further or opening a PR if it isn't specified.
- **Check the task's `mode` before starting any task** (the `mode` column in `docs/cms-architecture/cms-pipeline/queue.tsv`, repeated in each brief's header). `checkpoint` tasks do not start until Wolf has answered the open question in the brief — don't infer an answer and proceed. `human_gate` tasks can be prepared in full, but the task isn't done until the specified human action happens — don't attempt to complete that step yourself. (`notify` marks tasks run interactively and watched rather than by the headless runner.)
- **Every surface migration task (Phase 2 onward) follows the seed → publish → cutover → verify → cleanup template** and must produce an empty diff from `scripts/build-diff.mjs` (once T2.0 exists) before a cutover is considered done. Don't invent a different verification approach.
- **One task, one commit, minimal diff.** Don't bundle cleanup, refactoring, or "while I'm in here" changes into a task's commit — flag them separately instead.

## Known gotchas

- File-deletion tasks require verifying every importer first — never delete a file just because a task says to; confirm nothing else references it.
- The taxonomy source of truth is committed frontmatter, not the blob draft aggregation — using the wrong source reintroduces the exact drift the project exists to fix (see `docs/cms-architecture/02-architecture-and-schema.md` §5.5).
- `route`-kind navigation targets are a deliberate transitional type, not a bug — don't "fix" them to `page`-kind before the corresponding Page object actually exists.

## Project basics

- Astro static site, deployed via Netlify. Netlify Blobs is the source of truth for CMS-managed content; git-committed exports are derived.
- Test suite exists but wasn't run in CI until T0.10 — check whether that task has landed yet before assuming CI will catch a regression.
